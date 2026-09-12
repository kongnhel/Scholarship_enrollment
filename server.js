require('dotenv').config();

const express = require('express');
const expressLayouts = require('express-ejs-layouts');
const session = require('express-session');
const flash = require('connect-flash');
const helmet = require('helmet');
const cors = require('cors');
const crypto = require('crypto');
const path = require('path');
const rateLimit = require('express-rate-limit');
const { initBot } = require('./config/telegram');

process.on('unhandledRejection', (err) => {
  if (err && err.message === 'TIMEOUT' && err.stack && err.stack.includes('updates.js')) {
    return;
  }
  console.error('Unhandled rejection:', err);
});

const app = express();

app.set('trust proxy', 1);
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));
app.use(expressLayouts);
app.set('layout', 'layouts/main.ejs');

app.use(express.urlencoded({ extended: true }));
app.use(express.json());

app.use(session({
  secret: process.env.SESSION_SECRET || 'fallback-secret-key-change-me',
  resave: false,
  saveUninitialized: false,
  cookie: {
    httpOnly: true,
    sameSite: 'lax',
    maxAge: 24 * 60 * 60 * 1000
  }
}));

app.use(flash());
app.use(helmet({
  contentSecurityPolicy: false,
  crossOriginEmbedderPolicy: false
}));
app.use(cors());

app.use(express.static(path.join(__dirname, 'public')));
const uploadsDir = path.join(__dirname, 'uploads');
if (!require('fs').existsSync(uploadsDir)) {
  require('fs').mkdirSync(uploadsDir, { recursive: true });
}
app.use('/uploads', express.static(uploadsDir));

const db = require('./config/database');

app.use((req, res, next) => {
  req.db = db;
  res.locals.user = req.session.user || null;
  res.locals.messages = {
    success: req.flash('success'),
    error: req.flash('error'),
    warning: req.flash('warning')
  };
  res.locals.currentLang = req.query.lang || req.session.lang || 'km';
  req.session.lang = res.locals.currentLang;
  if (!req.session.csrfToken) {
    req.session.csrfToken = crypto.randomBytes(32).toString('hex');
  }
  res.locals.csrfToken = req.session.csrfToken;
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
      return res.redirect('back');
    }
  }
  next();
});

const authRoutes = require('./routes/auth');
const studentRoutes = require('./routes/student');
const adminRoutes = require('./routes/admin');
const committeeRoutes = require('./routes/committee');

// Helper to extract clean IP (strips port added by IIS reverse proxy)
const getClientIp = (req) => {
  const ip = req.ip || req.headers['x-forwarded-for'] || '';
  return ip.split(':')[0] || ip;
};

const authLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 50,
    message: 'Too many requests, please try again later.',
    standardHeaders: true,
    legacyHeaders: false,
    keyGenerator: getClientIp,
    skip: (req) => {
        return req.method === 'GET';
    }
});

app.use('/auth', authLimiter, authRoutes);

const generalLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 200,
    standardHeaders: true,
    legacyHeaders: false,
    keyGenerator: getClientIp,
    skip: (req) => req.method === 'GET'
});

app.use('/student', generalLimiter, studentRoutes);
app.use('/admin', generalLimiter, adminRoutes);
app.use('/committee', generalLimiter, committeeRoutes);

app.get('/', async (req, res) => {
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

app.use((err, req, res, next) => {
  console.error('Server error:', err);
  req.flash('error', 'An internal server error occurred');
  res.redirect('back');
});

const PORT = process.env.PORT || 3000;
const autoSetup = require('./database/auto_setup');

autoSetup()
  .then(() => db.query('SELECT 1'))
  .then(() => {
    console.log('Database connected successfully');
    app.listen(PORT, () => {
      console.log(`Server running on port ${PORT}`);
    });
  })
  .catch((err) => {
    console.error('Startup failed:', err.message);
    process.exit(1);
  });

process.on('unhandledRejection', (reason, promise) => {
  console.error('Unhandled Rejection at:', promise, 'reason:', reason);
});