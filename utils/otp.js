const crypto = require('crypto');

const generateOTP = (length = 5) => {
  const digits = '0123456789';
  let otp = '';
  const bytes = crypto.randomBytes(length);
  for (let i = 0; i < length; i++) {
    otp += digits[bytes[i] % 10];
  }
  return otp;
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
    return { success: false, message: 'User not found' };
  }

  const user = users[0];

  if (user.is_verified) {
    return { success: true, message: 'Already verified' };
  }

  if (!user.otp_code || !user.otp_expires_at) {
    return { success: false, message: 'No verification code found. Please request a new one.' };
  }

  if (new Date(user.otp_expires_at) < new Date()) {
    return { success: false, message: 'expired', messageText: 'Code has expired. Please request a new one.' };
  }

  if (user.otp_attempts >= maxAttempts) {
    return { success: false, message: 'max_attempts', messageText: 'Too many failed attempts. Please request a new code.' };
  }

  if (user.otp_code !== code) {
    await db.query('UPDATE users SET otp_attempts = otp_attempts + 1 WHERE id = ?', [userId]);
    const remaining = maxAttempts - (user.otp_attempts + 1);
    return { success: false, message: 'invalid', messageText: `Invalid code. ${remaining > 0 ? remaining + ' attempts remaining.' : 'No attempts remaining.'}` };
  }

  await db.query(
    'UPDATE users SET is_verified = 1, otp_code = NULL, otp_expires_at = NULL, otp_attempts = 0 WHERE id = ?',
    [userId]
  );
  return { success: true, message: 'verified' };
};

const canResend = async (db, userId) => {
  const cooldownSeconds = parseInt(process.env.OTP_RESEND_COOLDOWN) || 60;
  const [users] = await db.query(
    'SELECT otp_last_sent_at FROM users WHERE id = ?',
    [userId]
  );
  if (users.length === 0) return { allowed: false, waitSeconds: 0 };

  const lastSent = users[0].otp_last_sent_at;
  if (!lastSent) return { allowed: true, waitSeconds: 0 };

  const elapsed = (Date.now() - new Date(lastSent).getTime()) / 1000;
  if (elapsed >= cooldownSeconds) {
    return { allowed: true, waitSeconds: 0 };
  }
  return { allowed: false, waitSeconds: Math.ceil(cooldownSeconds - elapsed) };
};

const clearOTP = async (db, userId) => {
  await db.query(
    'UPDATE users SET otp_code = NULL, otp_expires_at = NULL, otp_attempts = 0 WHERE id = ?',
    [userId]
  );
};

module.exports = { generateOTP, storeOTP, verifyOTP, canResend, clearOTP };
