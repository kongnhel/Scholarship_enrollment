const crypto = require('crypto');

// Uniform digits via crypto.randomInt. The previous version took randomBytes % 10, and
// because 256 is not a multiple of 10 six of the ten digits were ~4% more likely to be
// drawn than the other four, costing about a fifth of a bit of entropy per digit.
const generateOTP = (length = 5) => {
  let otp = '';
  for (let i = 0; i < length; i++) {
    otp += String(crypto.randomInt(0, 10));
  }
  return otp;
};

// Constant-time comparison of two equal-length digit strings.
const codesMatch = (a, b) => {
  if (typeof a !== 'string' || typeof b !== 'string' || a.length !== b.length) return false;
  try {
    return crypto.timingSafeEqual(Buffer.from(a, 'utf8'), Buffer.from(b, 'utf8'));
  } catch (e) {
    return false;
  }
};

const storeOTP = async (db, userId, code) => {
  const expiryMinutes = parseInt(process.env.OTP_EXPIRY_MINUTES) || 10;
  const expiresAt = new Date(Date.now() + expiryMinutes * 60 * 1000);
  await db.query(
    'UPDATE users SET otp_code = ?, otp_expires_at = ?, otp_attempts = 0, otp_last_sent_at = NOW() WHERE id = ?',
    [code, expiresAt, userId]
  );
};

const verifyOTP = async (db, userId, code) => {
  const maxAttempts = parseInt(process.env.OTP_MAX_ATTEMPTS) || 5;
  const [users] = await db.query(
    'SELECT id, otp_code, otp_expires_at, otp_attempts, is_verified FROM users WHERE id = ?',
    [userId]
  );

  if (users.length === 0) {
    return { success: false, message: 'not_found', messageText: 'User not found' };
  }

  const user = users[0];

  if (user.is_verified) {
    return { success: true, message: 'already_verified', messageText: 'Already verified' };
  }

  if (!user.otp_code || !user.otp_expires_at) {
    return { success: false, message: 'no_code', messageText: 'No verification code found. Please request a new one.' };
  }

  if (new Date(user.otp_expires_at) < new Date()) {
    return { success: false, message: 'expired', messageText: 'Code has expired. Please request a new one.' };
  }

  if (user.otp_attempts >= maxAttempts) {
    return { success: false, message: 'max_attempts', messageText: 'Too many failed attempts. Please request a new code.' };
  }

  if (!codesMatch(user.otp_code, String(code || ''))) {
    await db.query('UPDATE users SET otp_attempts = otp_attempts + 1 WHERE id = ?', [userId]);
    const remaining = maxAttempts - (user.otp_attempts + 1);
    return { success: false, message: 'invalid', messageText: `Invalid code. ${remaining > 0 ? remaining + ' attempts remaining.' : 'No attempts remaining.'}` };
  }

  await db.query(
    'UPDATE users SET is_verified = 1, otp_code = NULL, otp_expires_at = NULL, otp_attempts = 0 WHERE id = ?',
    [userId]
  );
  return { success: true, message: 'verified', messageText: 'Verification successful' };
};

const canResend = async (db, userId) => {
  const cooldownSeconds = parseInt(process.env.OTP_RESEND_COOLDOWN) || 60;
  // The whole decision stays on the database clock. The first version read the
  // otp_last_sent_at string into JS and compared it against Date.now(), but that string
  // is written by NOW() (UTC on Aiven) and was parsed as LOCAL time -- on any server
  // whose local timezone is ahead of UTC every fresh timestamp already looked ~7h old,
  // so the cooldown silently never throttled anything.
  const [users] = await db.query(
    `SELECT (otp_last_sent_at IS NOT NULL AND otp_last_sent_at > DATE_SUB(NOW(), INTERVAL ? SECOND)) AS cooling,
            TIMESTAMPDIFF(SECOND, otp_last_sent_at, NOW()) AS elapsed
       FROM users WHERE id = ?`,
    [cooldownSeconds, userId]
  );
  if (users.length === 0) return { allowed: false, waitSeconds: 0 };
  if (!users[0].cooling) return { allowed: true, waitSeconds: 0 };
  const waitSeconds = Math.max(cooldownSeconds - (users[0].elapsed || 0), 1);
  return { allowed: false, waitSeconds };
};

const clearOTP = async (db, userId) => {
  await db.query(
    'UPDATE users SET otp_code = NULL, otp_expires_at = NULL, otp_attempts = 0 WHERE id = ?',
    [userId]
  );
};

module.exports = { generateOTP, storeOTP, verifyOTP, canResend, clearOTP };
