require('dotenv').config();

const express = require('express');
const expressLayouts = require('express-ejs-layouts');
const session = require('express-session');
const flash = require('connect-flash');
const helmet = require('helmet');
const crypto = require('crypto');
const path = require('path');
const rateLimit = require('express-rate-limit');
const MySQLStoreFactory = require('express-mysql-session');
const db = require('./config/database');
const { ENROLLMENT_ENABLED } = require('./config/features');
const { safeBackPath, dashboardPathFor } = require('./utils/helpers');

// A single listener for the whole process. There used to be two identical
// unhandledRejection handlers, so every rejection was logged twice.
process.on('unhandledRejection', (err) => {
  if (err && err.message === 'TIMEOUT' && err.stack && err.stack.includes('updates.js')) {
    return;
  }
  console.error('Unhandled rejection:', err);
});

// An uncaught exception leaves the process in an undefined state. Log it and let the
// host (IIS app pool / nodemon / PM2) restart us rather than serving broken responses.
process.on('uncaughtException', (err) => {
  console.error('Uncaught exception:', err);
  process.exit(1);
});

const app = express();

app.set('trust proxy', 1);
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));
app.use(expressLayouts);
app.set('layout', 'layouts/main.ejs');

app.use(express.urlencoded({ extended: true }));
app.use(express.json());

// Sessions live in MySQL rather than process memory. The default in-memory store
// loses every login on restart/deploy, grows without bound, and breaks entirely when
// the host runs more than one worker process (IIS/ARR or Passenger) because each
// process would have its own isolated copy. Reuses the existing pool from
// config/database.js so the credentials stay defined in exactly one place.
const SESSION_TTL_MS = 24 * 60 * 60 * 1000;
const sessionStore = new (MySQLStoreFactory(session))({
  expiration: SESSION_TTL_MS,
  createDatabaseTable: true,
  clearExpired: true,
  checkExpirationInterval: 15 * 60 * 1000,
  endConnectionOnClose: false
}, db);

// Surface store problems instead of letting logins fail silently. createDatabaseTable
// needs CREATE rights on the database; without them the app still boots and the reason
// ends up here rather than in a generic "invalid session" error much later.
sessionStore.onReady()
  .then(() => console.log('Session store ready (MySQL)'))
  .catch((err) => console.error('Session store FAILED to initialise:', err.message));

app.use(session({
  store: sessionStore,
  secret: process.env.SESSION_SECRET || 'fallback-secret-key-change-me',
  resave: false,
  saveUninitialized: false,
  cookie: {
    httpOnly: true,
    sameSite: 'lax',
    // Secure cookies in production (requires HTTPS)
    secure: process.env.NODE_ENV === 'production',
    maxAge: SESSION_TTL_MS
  }
}));

app.use(flash());
app.use(helmet({
  contentSecurityPolicy: false,
  crossOriginEmbedderPolicy: false
}));

// No CORS middleware on purpose: every page and API call is served same-origin, so
// cross-origin headers are unnecessary. The old `cors({ origin: '*', credentials: true })`
// granted nothing useful (browsers reject wildcard origins on credentialed requests)
// while advertising the site to any origin. If a cross-origin client is ever added,
// mount cors() here with an explicit allow-list, e.g.
//   const cors = require('cors');
//   app.use(cors({ origin: process.env.ALLOWED_ORIGINS.split(','), credentials: true }));

app.use(express.static(path.join(__dirname, 'public')));
const uploadsDir = path.join(__dirname, 'uploads');
if (!require('fs').existsSync(uploadsDir)) {
  require('fs').mkdirSync(uploadsDir, { recursive: true });
}
app.use('/uploads', express.static(uploadsDir));

// NOTE: rate limiters below use the default key (req.ip). `app.set('trust proxy', 1)`
// makes Express resolve the real client IP through the IIS/ARR hop, so the client IP
// cannot be spoofed by sending its own X-Forwarded-For header.
//
// ORDERING (security-critical): these limiters are mounted BEFORE the global CSRF
// guard below. The CSRF guard answers a bad-token POST with a redirect and never calls
// next(), so if it ran first, a request that simply omits `_csrf` would skip the limiter
// entirely -- which is exactly what an attacker brute-forcing /auth/login would do.
// Mounting here means every state-changing request is counted, valid token or not.
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 50,
  message: 'Too many requests, please try again later.',
  standardHeaders: true,
  legacyHeaders: false,
  skip: (req) => req.method === 'GET'
});

const generalLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 200,
  standardHeaders: true,
  legacyHeaders: false,
  skip: (req) => req.method === 'GET'
});

app.use('/auth', authLimiter);
app.use('/student', generalLimiter);
app.use('/admin', generalLimiter);
app.use('/committee', generalLimiter);

app.use((req, res, next) => {
  req.db = db;
  res.locals.user = req.session.user || null;
  res.locals.messages = {
    success: req.flash('success'),
    error: req.flash('error'),
    warning: req.flash('warning')
  };
  res.locals.currentLang = req.query.lang || req.session.lang || 'km';
  // Only write when the language actually changes. Assigning unconditionally marks the
  // session dirty on every request, which with a database-backed store means a write
  // per page view - including for anonymous visitors who never log in.
  if (req.session.lang !== res.locals.currentLang) {
    req.session.lang = res.locals.currentLang;
  }
  if (!req.session.csrfToken) {
    req.session.csrfToken = crypto.randomBytes(32).toString('hex');
  }
  res.locals.csrfToken = req.session.csrfToken;
  // Expose the enrollment feature flag to templates. The routes already read it through
  // the enrollmentPaused* middleware, but the student sidebar and the public home page
  // used to hide their Enrollment / Payments links behind hand-edited HTML comments.
  // That meant flipping the flag opened the routes while leaving every link to them
  // commented out, so nothing was reachable. Driving the UI from the same flag keeps the
  // two from drifting apart again.
  res.locals.enrollmentEnabled = ENROLLMENT_ENABLED;
  next();
});

app.use((req, res, next) => {
  if (['POST', 'PUT', 'DELETE', 'PATCH'].includes(req.method)) {
    if (req.is('multipart/form-data')) {
      return next();
    }
    const token = req.body._csrf || req.headers['x-csrf-token'];
    if (!token || token !== req.session.csrfToken) {
      req.flash('error', 'Invalid or missing CSRF token. Please try again.');
      return res.redirect(safeBackPath(req));
    }
  }
  next();
});

const authRoutes = require('./routes/auth');
const studentRoutes = require('./routes/student');
const adminRoutes = require('./routes/admin');
const committeeRoutes = require('./routes/committee');

app.use('/auth', authRoutes);
app.use('/student', studentRoutes);
app.use('/admin', adminRoutes);
app.use('/committee', committeeRoutes);

app.get('/', async (req, res) => {
    // The home page is public marketing content. A signed-in user has no reason to be on
    // it, and several error paths and role guards used to redirect here, which made it
    // look like the session had been dropped. Sending a signed-in visitor straight to
    // their own dashboard means that can never be mistaken for a logout.
    if (req.session && req.session.user) {
      return res.redirect(dashboardPathFor(req));
    }
    try {
    const [majors] = await db.query('SELECT * FROM majors WHERE is_active = 1 ORDER BY name_en');
    const [categories] = await db.query('SELECT * FROM scholarship_categories WHERE is_active = 1 ORDER BY name_en');
    const [scholarshipTypes] = await db.query('SELECT id, name_kh, name_en, coverage_percentage, duration_years FROM scholarship_types WHERE is_active = 1 ORDER BY coverage_percentage ASC');
    const [provinces] = await db.query('SELECT * FROM provinces ORDER BY name_en');
    res.render('index', { title: 'Home', majors, categories, scholarshipTypes, provinces });
  } catch (err) {
    console.error(err);
    res.render('index', { title: 'Home', majors: [], categories: [], scholarshipTypes: [], provinces: [] });
  }
});

app.get('/faq', (req, res) => {
  res.render('faq', { title: 'FAQ' });
});

app.get('/terms', (req, res) => {
  res.render('terms', { title: 'Terms & Conditions' });
});

app.use((req, res) => {
  res.status(404).render('404', { title: 'Page Not Found' });
});

// Multer rejects oversized / disallowed files by calling next(err), which never reaches
// the route handler - so before this the user saw "An internal server error occurred"
// instead of "file too large". Translate the failure into something actionable.
function uploadErrorMessage(err) {
  if (err && err.code === 'LIMIT_FILE_SIZE') {
    const mb = Math.round((parseInt(process.env.MAX_FILE_SIZE) || 5 * 1024 * 1024) / 1024 / 1024);
    return { km: 'ឯកសារធំពេកទៅតូចជាង ' + mb + 'MB។', en: 'Each file must be smaller than ' + mb + 'MB.' };
  }
  if (err && err.code === 'LIMIT_FILE_COUNT') {
    return { km: 'បានផ្ញើឯកសារច្រើនពេក។ សូមផ្ញើតគ្រប់ក្នុងមួយដង។', en: 'Too many files were sent. Please upload fewer files at a time.' };
  }
  // Deliberately NOT worded as "too many files". The enrollment form has exactly 4 file
  // inputs, all required, so a student who trips the part ceiling uploaded nothing
  // wrong and cannot reduce anything -- telling them to send fewer files sent them
  // looking in the wrong place. This ceiling is about total field + file count, and the
  // only thing a student can do about it is reload and resubmit.
  if (err && err.code === 'LIMIT_PART_COUNT') {
    return { km: 'ទិន្នន័យដែលបានផ្ញើមកច្រើនពេក។ សូមផ្ទុកទំព័រឡើងវិញ ហើយសាកល្បងម្តងទៀត។', en: 'The form contained too many entries. Please reload the page and submit again.' };
  }
  if (err && typeof err.message === 'string' && /Invalid file type/i.test(err.message)) {
    return { km: 'ប្រភេទឯកសារមិនត្រូវបានអនុម័ត។ អនុញ្ញាត៖ JPG, PNG, PDF។', en: 'That file type is not allowed. Use JPG, PNG or PDF.' };
  }
  return null;
}

app.use((err, req, res, next) => {
  // A redirect cannot be sent once the response has started, and attempting it throws
  // ERR_HTTP_HEADERS_SENT, which hides the original problem behind a second error.
  if (res.headersSent) {
    return next(err);
  }

  const uploadMsg = uploadErrorMessage(err);
  if (uploadMsg) {
    // An upload the CLIENT got wrong is not a server fault. Logging it through
    // console.error with a full stack buried real problems under noise, and printed no
    // method or path, so the log could not even say which endpoint had failed. One warn
    // line with the route is enough to diagnose it.
    console.warn(`[upload-rejected] ${req.method} ${req.originalUrl} -> ${err.code || err.message}`);
    const km = req.session && req.session.lang === 'km';
    req.flash('error', km ? uploadMsg.km : uploadMsg.en);
    return res.redirect(safeBackPath(req));
  }

  console.error('Server error:', err);
  req.flash('error', 'An internal server error occurred');
  res.redirect(safeBackPath(req));
});

const PORT = process.env.PORT || 5000;
// Bind to 127.0.0.1 so only IIS/ARR can reach Node — not exposed directly on the network
const HOST = process.env.HOST || '127.0.0.1';
const autoSetup = require('./database/auto_setup');

autoSetup()
  .then(() => db.query('SELECT 1'))
  .then(() => {
    console.log('Database connected successfully');
    app.listen(PORT, HOST, () => {
      console.log(`Server running on http://${HOST}:${PORT} [${process.env.NODE_ENV || 'development'}]`);
    });
  })
  .catch((err) => {
    console.error('Startup failed:', err.message);
    process.exit(1);
  });

process.on('unhandledRejection', (reason, promise) => {
  console.error('Unhandled Rejection at:', promise, 'reason:', reason);
});