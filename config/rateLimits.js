// Rate limiters for the two auth endpoints that send mail.
//
// These live in their own module, and in their own right, rather than as route middleware,
// for two reasons.
//
// 1. They must run BEFORE the CSRF guard. In server.js the guard is global middleware and the
//    routers are mounted after it, so a request that does not present a valid token is
//    rejected before the router is reached at all. A limiter attached inside routes/auth.js
//    therefore never sees the very traffic it exists to stop -- a brute-forcer never brings a
//    token. Mounted here instead, they count every request.
//
// 2. They must not share /auth/register and /auth/resend-email with the coarse authLimiter.
//    That limiter is a single 50-per-15min bucket for the whole /auth prefix, and every other
//    auth route draws on it. Stacking a second, more specific limiter on top of it would add
//    no protection (the per-address bucket below is stricter for the thing that matters) while
//    stealing budget from login.
//
// Both endpoints get a per-address bucket and a per-IP bucket. The per-address bucket is the
// one that protects the mail quota and a single inbox; the per-IP bucket only stops one
// machine spraying many different addresses. The per-IP ceilings are deliberately loose for
// register, because scholarship season puts a whole campus behind one NAT address and a tight
// cap there would lock real applicants out on the day the portal opens.
const rateLimit = require('express-rate-limit');

const addressKey = (req) => String((req.body && req.body.email) || '').trim().toLowerCase();

const registerByAddressLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  max: 3,
  keyGenerator: addressKey,
  message: 'Too many registration attempts for this email. Please try again later.',
  standardHeaders: true,
  legacyHeaders: false
});

const registerByIpLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  max: 30,
  message: 'Too many registration attempts. Please try again later.',
  standardHeaders: true,
  legacyHeaders: false
});

const resendVerificationByAddressLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  max: 3,
  keyGenerator: addressKey,
  message: 'Too many verification emails requested for this address. Please try again later.',
  standardHeaders: true,
  legacyHeaders: false
});

const resendVerificationByIpLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  // Much looser than the per-address cap above. Every student behind one campus NAT shares
  // this bucket, so a tight limit here would have students blocking each other's resends.
  // The per-address cap is what protects a single inbox and the mail quota; this ceiling
  // exists only to stop one machine spraying many addresses.
  max: 20,
  message: 'Too many verification email requests. Please try again later.',
  standardHeaders: true,
  legacyHeaders: false
});

module.exports = {
  registerByAddressLimiter,
  registerByIpLimiter,
  resendVerificationByAddressLimiter,
  resendVerificationByIpLimiter
};
