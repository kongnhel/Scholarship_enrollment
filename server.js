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
const {
  registerByAddressLimiter,
  registerByIpLimiter,
  resendVerificationByAddressLimiter,
  resendVerificationByIpLimiter,
  forgotPasswordByAddressLimiter,
  forgotPasswordByIpLimiter,
  cap
} = require('./config/rateLimits');
const { safeBackPath, dashboardPathFor, formatDateTime, formatDateOnly, cambodiaDateParts } = require('./utils/helpers');

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
// Held so shutdown() can stop accepting connections before the pools close.
let server = null;

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

// A missing SESSION_SECRET used to fall through to a value that is published in this
// repository. On a production host that silently means every session cookie is signed with
// a key an attacker already has, so anyone can forge a cookie for any account. Refuse to
// start in production instead; development keeps the fallback so a fresh clone still runs.
const SESSION_SECRET = process.env.SESSION_SECRET;
if (!SESSION_SECRET || SESSION_SECRET === 'fallback-secret-key-change-me') {
  if (process.env.NODE_ENV === 'production') {
    console.error('FATAL: SESSION_SECRET is not set (or is the repository default).');
    console.error('Set a long random value in .env before starting in production.');
    process.exit(1);
  }
  console.warn('WARNING: SESSION_SECRET is unset - using the development fallback. Never do this in production.');
}

app.use(session({
  store: sessionStore,
  secret: SESSION_SECRET || 'fallback-secret-key-change-me',
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

// ==================== DURABLE FLASH ====================
//
// connect-flash keeps messages in req.session, and express-session persists that session
// ASYNCHRONOUSLY when the response ends. res.redirect() does not wait for the write, so the
// sequence was a genuine race:
//
//   1. route calls req.flash('error', ...) then res.redirect(...)
//   2. Express emits the 302 immediately; the `UPDATE sessions ...` is still in flight
//   3. the browser follows the redirect and reads the session
//   4. if the write has not landed yet -> empty flash -> the page renders no message
//   5. the write completes a moment later, so a reload finally shows it
//
// That is why the alert appeared only after a manual refresh, and only sometimes: it is a
// race, won more often on a local store and lost more often against a remote database, where
// persisting a session is an internet round trip. The config here makes it unavoidable:
// `resave: false` and `saveUninitialized: false` (server.js) over an express-mysql-session
// store pointed at Aiven.
//
// Wrapping res.redirect is deliberate rather than adding `await saveSession(req)` to each
// call site: there are roughly 240 flash-then-redirect sites across routes/auth.js,
// routes/student.js, routes/admin.js and routes/committee.js, and a fix that has to be
// remembered at every new call site is one that will be forgotten. Mounted after session()
// and flash() so req.session.flash exists, and well before the routers (mounted later in
// this file), so it covers every page.
//
// Three properties keep this safe:
//  - it only intervenes when a flash is genuinely pending, so ordinary redirects keep their
//    current behaviour and add no latency;
//  - `go` makes the redirect fire exactly once, whichever of callback/timeout arrives first;
//  - the 2s timeout guarantees a stalled or unreachable session store degrades to today's
//    behaviour (redirect anyway) instead of leaving the user on a blank response.
app.use((req, res, next) => {
  const originalRedirect = res.redirect.bind(res);
  res.redirect = function(...args) {
    const flash = req.session && req.session.flash;
    const pending = flash && Object.keys(flash).some(
      (k) => Array.isArray(flash[k]) && flash[k].length > 0
    );
    if (!pending || typeof req.session.save !== 'function') {
      return originalRedirect(...args);
    }
    let sent = false;
    const go = () => {
      if (sent) return;
      sent = true;
      originalRedirect(...args);
    };
    try {
      req.session.save(go);
    } catch (err) {
      console.error('Session save before redirect failed:', err.message);
      return go();
    }
    // A store that never calls back must not strand the response.
    setTimeout(go, 2000).unref();
    return undefined;
  };
  next();
});

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
// register, resend-email and forgot-password are deliberately NOT counted here. Each already
// owns a limiter built for it (see config/rateLimits.js): per-IP plus per-ADDRESS, where the
// per-address bucket is 3/hour. That pair is stricter than this coarse one for exactly the
// thing that matters there -- stopping one address being mailed repeatedly -- and stacking two
// limiters over the same endpoint only makes it ambiguous which one fired when a request is
// refused. Excluding them here also keeps their traffic off this shared bucket, which is the
// same 50 window that every other /auth route shares.
// Caps are overridable from .env and 0 disables the limiter, so a test run that logs in and
// registers dozens of accounts does not have to keep restarting the app to clear the counter.
// The defaults are unchanged; see the block at the top of config/rateLimits.js.
const authCap = cap('AUTH_RATE_LIMIT', 50);
const generalCap = cap('GENERAL_RATE_LIMIT', 200);

const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: authCap.max,
  message: 'Too many requests, please try again later.',
  standardHeaders: true,
  legacyHeaders: false,
  skip: (req) => !authCap.enabled
    || req.method === 'GET'
    || req.path === '/register'
    || req.path === '/resend-email'
    || req.path === '/forgot-password'
});

const generalLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: generalCap.max,
  standardHeaders: true,
  legacyHeaders: false,
  skip: (req) => !generalCap.enabled || req.method === 'GET'
});

app.use('/auth', authLimiter);
app.use('/student', generalLimiter);
app.use('/admin', generalLimiter);
app.use('/committee', generalLimiter);

// The three endpoints that send mail have their own per-address and per-IP limiters, defined
// in config/rateLimits.js. They are mounted here, on the same side of the CSRF guard as the
// limiters above and for the same reason: the guard answers a token-less POST with a redirect
// and never calls next(), so a limiter attached inside routes/auth.js would never see the
// traffic it exists to stop. authLimiter skips these three paths (see below) so that each is
// limited once, by these, rather than twice.
//
// /auth/forgot-password used to be the odd one out, with its limiters still declared inside
// routes/auth.js. That put them behind the guard, where the only thing standing between a
// spammer and someone's inbox was authLimiter's coarse 50-per-15min bucket -- the same 50
// that every login in the app shares.
app.use('/auth/register', registerByIpLimiter, registerByAddressLimiter);
app.use('/auth/resend-email', resendVerificationByIpLimiter, resendVerificationByAddressLimiter);
app.use('/auth/forgot-password', forgotPasswordByIpLimiter, forgotPasswordByAddressLimiter);

// The verify-account lookup and resend-otp also mint and send codes (email code or
// Telegram message) on every POST. Until now they drew only from the coarse 50-per-15min
// /auth bucket, so one machine could fire fifty code-sends into someone else's recovery
// flow. The address-keyed resend limiters need req.body.email, which verify-account does
// not carry (it may be a phone), so only the per-IP POST-only limiter mounts here -- 20
// code-sends per 15 minutes per machine, plenty for a human, useless for a flood. GETs are
// skipped, so the pages themselves stay unlimited like the rest of the portal.
app.use('/auth/verify-account', resendVerificationByIpLimiter);
app.use('/auth/resend-otp', resendVerificationByIpLimiter);

app.use(async (req, res, next) => {
  req.db = db;
  res.locals.user = req.session.user || null;
  // Timestamps come out of MySQL as naive UTC; these render them in Cambodia time.
  res.locals.formatDateTime = formatDateTime;
  res.locals.formatDateOnly = formatDateOnly;
  res.locals.cambodiaDateParts = cambodiaDateParts;
  res.locals.messages = {
    success: req.flash('success'),
    error: req.flash('error'),
    warning: req.flash('warning')
  };
// ?lang= arrives from the URL, so it is attacker-controlled. Taking it verbatim meant any
// string could be written into req.session, which both dirties the session (forcing a row
// write on a MySQL-backed store) and interpolated into an inline <script> in the layout.
// Two supported languages, so it is matched against exactly those and anything else is
// ignored rather than stored.
//
// The write-back matters more than it looks. `GET /` sits outside /auth, /student, /admin
// and /committee, so none of the four limiters apply, and both authLimiter and
// generalLimiter skip GET. Any unauthenticated request carrying ?lang= therefore created a
// brand-new session row of attacker-chosen length with a 24h TTL, with nothing to rate it.
// Now an unrecognised value falls through without touching the session, so the only
// remaining way to grow the table is the CSRF token below, which is a fixed 64 characters.
const SUPPORTED_LANGS = ['km', 'en'];
const requestedLang = SUPPORTED_LANGS.indexOf(req.query.lang) !== -1 ? req.query.lang : null;
res.locals.currentLang = requestedLang || req.session.lang || 'km';
// Only write when the language actually changes. Assigning unconditionally marks the
// session dirty on every request, which with a database-backed store means a write
// per page view - including for anonymous visitors who never log in.
if (requestedLang && req.session.lang !== requestedLang) {
  req.session.lang = requestedLang;
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
  // Public contact details for the footer, editable at /admin/contact. Fetched for every
  // request because the footer appears on every page, but kept to one indexed lookup and
  // allowed to fail silently: a footer is not worth failing a page over, and the view
  // carries literal defaults for exactly that case.
  res.locals.contactInfo = {};
  try {
    const [contactRows] = await db.query(
      "SELECT setting_key, setting_value FROM settings WHERE setting_key LIKE 'contact\\_%'");
    const info = {};
    contactRows.forEach(r => { info[r.setting_key.replace(/^contact_/, '')] = r.setting_value; });
    res.locals.contactInfo = info;
  } catch (err) {
    console.error('Contact settings lookup failed:', err.message);
  }

  // Unread count for the sidebar bell. A failure here must not take the page down, and an
  // anonymous visitor has no inbox, so both cases fall through to 0.
  res.locals.unreadNotifications = 0;
  if (req.session.user && req.session.user.id) {
    try {
      const [unread] = await db.query(
        'SELECT COUNT(*) AS n FROM notifications WHERE user_id = ? AND is_read = 0',
        [req.session.user.id]
      );
      res.locals.unreadNotifications = unread && unread[0] ? Number(unread[0].n) || 0 : 0;
    } catch (err) {
      console.error('Unread notification count failed:', err.message);
    }
  }
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

// Readiness probe for IIS/ARR and any external monitor. It answers "can this process
// actually serve?", so it checks the database rather than just returning 200 -- a process
// that booted but lost its pool is not healthy, and reporting otherwise causes ARR to
// keep a broken site in rotation.
//
// Registered BEFORE the 404 catch-all below: Express stops at the first matching handler,
// so a route added after `app.use((req, res) => ... 404)` is unreachable.
app.get('/health', async (req, res) => {
  const started = Date.now();
  try {
    await db.query('SELECT 1');
    res.json({
      status: 'ok',
      uptimeSeconds: Math.round(process.uptime()),
      dbLatencyMs: Date.now() - started,
      env: process.env.NODE_ENV || 'development'
    });
  } catch (err) {
    res.status(503).json({ status: 'degraded', error: 'database unavailable' });
  }
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
    // Same guard as the generic branch below: this handler also serves requests that
    // failed before the flash middleware was mounted, where req.flash does not exist.
    if (typeof req.flash === 'function') {
      req.flash('error', km ? uploadMsg.km : uploadMsg.en);
      return res.redirect(safeBackPath(req));
    }
    if (res.headersSent) return res.end();
    return res.status(400).send(
      '<!doctype html><meta charset="utf-8"><title>Upload rejected</title>' +
      '<h1>That file could not be accepted</h1><p>Please check the file and try again.</p>'
    );
  }

  // A template that fails to compile throws here, and the generic branch below redirected
  // the visitor with no explanation. That is how /terms served a 302 to the home page for
  // as long as the bug existed: the page looked "redirected" rather than broken, so nothing
  // in the logs said a template could not be parsed. A render failure is a server fault and
  // must say so with a 500.
  const isRenderFailure = err && /while compiling ejs|Failed to lookup view|is not defined|unexpected token/i.test(String(err.message || ''));
  if (isRenderFailure) {
    console.error('TEMPLATE RENDER FAILURE on ' + req.method + ' ' + req.originalUrl + ':', err);
    return res.status(500).send(
      '<!doctype html><meta charset="utf-8"><title>Server error</title>' +
      '<h1>Something went wrong on our side</h1>' +
      '<p>This page could not be displayed. The problem has been logged.</p>'
    );
  }

  console.error('Server error:', err);

  // The error handler runs for failures raised BEFORE the flash middleware too -- most
  // often the database-backed session store losing its connection (read ECONNRESET on a
  // transient network blip). req.flash did not exist on those requests, so the handler
  // itself threw "req.flash is not a function" and the TypeError killed the whole process
  // instead of returning a 500. A transient database hiccup therefore took the whole site
  // down with no explanation in the log. Degrade instead: flash when we can, plain 500 when
  // we cannot, and never throw out of the error handler.
  if (typeof req.flash === 'function') {
    try {
      req.flash('error', 'An internal server error occurred');
      return res.redirect(safeBackPath(req));
    } catch (flashErr) {
      console.error('Error handler could not flash:', flashErr);
    }
  }
  if (res.headersSent) return res.end();
  return res.status(500).send(
    '<!doctype html><meta charset="utf-8"><title>Server error</title>' +
    '<h1>Something went wrong on our side</h1>' +
    '<p>This page could not be displayed. The problem has been logged.</p>'
  );
});

const PORT = process.env.PORT || 5000;
// Bind to 127.0.0.1 so only IIS/ARR can reach Node — not exposed directly on the network
const HOST = process.env.HOST || '127.0.0.1';
const autoSetup = require('./database/auto_setup');

autoSetup()
  .then(() => db.query('SELECT 1'))
  .then(() => {
    console.log('Database connected successfully');
    server = app.listen(PORT, HOST, () => {
      console.log(`Server running on http://${HOST}:${PORT} [${process.env.NODE_ENV || 'development'}]`);
    });
    server.on('error', (err) => {
      // Without this, a port clash produced an unhandled 'error' event and a bare crash
      // with no indication of which port failed.
      if (err.code === 'EADDRINUSE') {
        console.error(`FATAL: ${HOST}:${PORT} is already in use. Stop the other process (or the stale IIS node worker) and restart.`);
      } else {
        console.error('HTTP server error:', err);
      }
      process.exit(1);
    });
  })
  .catch((err) => {
    console.error('Startup failed:', err.message);
    process.exit(1);
  });

// Graceful shutdown. IIS recycles the application pool and nodemon restarts on save by
// sending SIGTERM/SIGINT; without a handler the process died mid-request and the MySQL
// pool plus the session store were torn down with open sockets, which shows up later as
// "connection lost" errors and stale sessions.
let shuttingDown = false;
function shutdown(signal) {
  if (shuttingDown) return;
  shuttingDown = true;
  console.log(`\n${signal} received - shutting down gracefully...`);

  const force = setTimeout(() => {
    console.error('Shutdown timed out after 10s - forcing exit.');
    process.exit(1);
  }, 10000);
  force.unref();

  const finish = async () => {
    try {
      if (server) await new Promise(resolve => server.close(resolve));
      console.log('HTTP server closed.');
    } catch (err) {
      console.error('Error closing HTTP server:', err.message);
    }
    try {
      if (sessionStore && typeof sessionStore.close === 'function') {
        await new Promise(resolve => sessionStore.close(resolve));
        console.log('Session store closed.');
      }
    } catch (err) {
      console.error('Error closing session store:', err.message);
    }
    try {
      await db.end();
      console.log('Database pool closed.');
    } catch (err) {
      console.error('Error closing database pool:', err.message);
    }
    clearTimeout(force);
    console.log('Shutdown complete.');
    process.exit(0);
  };

  finish();
}
process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));

process.on('unhandledRejection', (reason, promise) => {
  console.error('Unhandled Rejection at:', promise, 'reason:', reason);
});