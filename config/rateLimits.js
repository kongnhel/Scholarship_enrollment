// Rate limiters for the auth endpoints that send mail.
//
// Two reasons these live in their own module rather than as route middleware:
//
// 1. They must run BEFORE the CSRF guard. In server.js the guard is global middleware and the
//    routers are mounted after it, so a request without a valid token is rejected before the
//    router is reached at all. A limiter attached inside routes/auth.js therefore never sees
//    the very traffic it exists to stop -- a brute-forcer never brings a token. Mounted here,
//    they count every request.
//
// 2. They must not share those routes with the coarse authLimiter. That is one 50-per-15min
//    bucket shared by every other /auth route, so stacking a second limiter on the same
//    endpoint would add no protection while stealing budget from login.
//
// ---------------------------------------------------------------------------
// TESTING: every cap below can be overridden from .env, and set to 0 to switch that
// limiter off entirely. The defaults are the production values, so a missing or misspelled
// variable can only ever fall back to something safe -- never to "unlimited".
//
//   RATE_LIMIT_REGISTER_ADDRESS=0     no per-address cap on registration
//   RATE_LIMIT_REGISTER_IP=0          no per-IP cap on registration
//   RATE_LIMIT_RESEND_ADDRESS=0       ditto resend-email
//   RATE_LIMIT_RESEND_IP=0
//   RATE_LIMIT_FORGOT_ADDRESS=0       ditto forgot-password
//   RATE_LIMIT_FORGOT_IP=0
//   AUTH_RATE_LIMIT=0                 the shared /auth bucket
//   GENERAL_RATE_LIMIT=0              the shared /student, /admin, /committee bucket
//
// Set them to 0 to register a lot of accounts at once, then put the real numbers back.
// A live portal should not leave these disabled: they are what stops one inbox being
// flooded and what keeps a bored attacker from spending your Resend quota.
// ---------------------------------------------------------------------------
const rateLimit = require('express-rate-limit');

/**
 * Read a cap from the environment.
 * @returns {{max:number, enabled:boolean}} `enabled:false` means "apply no limit".
 */
const cap = (name, fallback) => {
  const raw = process.env[name];
  if (raw === undefined || String(raw).trim() === '') return { max: fallback, enabled: true };
  const s = String(raw).trim();
  // Only a plain non-negative integer. parseInt would happily read "1e999" as 1, which turns
  // a typo into a limit of one request an hour instead of the intended default -- still safe,
  // but in the direction that silently breaks registration.
  if (!/^\d+$/.test(s)) return { max: fallback, enabled: true };
  const n = parseInt(s, 10);
  if (!Number.isSafeInteger(n)) return { max: fallback, enabled: true };
  return { max: n, enabled: n > 0 };
};

// The empty body on a GET makes addressKey resolve to '', so every anonymous page view would
// otherwise collapse into one shared bucket. Mounted with app.use(), these match every
// method, and at max 3/hour that meant a student who opened /auth/register a few times to
// read the form got 429 on the next visit and could not register at all, without ever
// submitting anything. Mail is only ever sent from a POST, so that is all these count.
const onlyPost = (req) => req.method !== 'POST';

const addressKey = (req) => String((req.body && req.body.email) || '').trim().toLowerCase();

// The per-address bucket is the one that protects the mail quota and a single inbox. The
// per-IP bucket only stops one machine spraying many different addresses, and is deliberately
// loose because scholarship season puts a whole campus behind one NAT address -- a tight cap
// there locks real applicants out on the day the portal opens.
const registerAddress = cap('RATE_LIMIT_REGISTER_ADDRESS', 3);
const registerIp = cap('RATE_LIMIT_REGISTER_IP', 30);
const resendAddress = cap('RATE_LIMIT_RESEND_ADDRESS', 3);
const resendIp = cap('RATE_LIMIT_RESEND_IP', 20);
const forgotAddress = cap('RATE_LIMIT_FORGOT_ADDRESS', 3);
const forgotIp = cap('RATE_LIMIT_FORGOT_IP', 5);

const registerByAddressLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  max: registerAddress.max,
  keyGenerator: addressKey,
  skip: (req) => onlyPost(req) || !registerAddress.enabled,
  message: 'Too many registration attempts for this email. Please try again later.',
  standardHeaders: true,
  legacyHeaders: false
});

const registerByIpLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  max: registerIp.max,
  skip: (req) => onlyPost(req) || !registerIp.enabled,
  message: 'Too many registration attempts. Please try again later.',
  standardHeaders: true,
  legacyHeaders: false
});

const resendVerificationByAddressLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  max: resendAddress.max,
  keyGenerator: addressKey,
  skip: (req) => onlyPost(req) || !resendAddress.enabled,
  message: 'Too many verification emails requested for this address. Please try again later.',
  standardHeaders: true,
  legacyHeaders: false
});

const resendVerificationByIpLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: resendIp.max,
  skip: (req) => onlyPost(req) || !resendIp.enabled,
  message: 'Too many verification email requests. Please try again later.',
  standardHeaders: true,
  legacyHeaders: false
});

const forgotPasswordByAddressLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  max: forgotAddress.max,
  keyGenerator: addressKey,
  skip: (req) => onlyPost(req) || !forgotAddress.enabled,
  message: 'Too many password reset requests for this address. Please try again later.',
  standardHeaders: true,
  legacyHeaders: false
});

const forgotPasswordByIpLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: forgotIp.max,
  skip: (req) => onlyPost(req) || !forgotIp.enabled,
  message: 'Too many password reset requests. Please try again later.',
  standardHeaders: true,
  legacyHeaders: false
});

module.exports = {
  registerByAddressLimiter,
  registerByIpLimiter,
  resendVerificationByAddressLimiter,
  resendVerificationByIpLimiter,
  forgotPasswordByAddressLimiter,
  forgotPasswordByIpLimiter,
  // Exported so server.js can give authLimiter and generalLimiter the same treatment.
  cap
};