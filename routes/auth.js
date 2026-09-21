const express = require('express');
const router = express.Router();
const bcrypt = require('bcryptjs');
const { sendEmail } = require('../config/mailer');
const { body, validationResult } = require('express-validator');
const { generateToken, escapeHtml } = require('../utils/helpers');
const { generateOTP, storeOTP, verifyOTP: verifyUserOTP, canResend, clearOTP } = require('../utils/otp');
const telegramOtp = require('../services/otpSender');
const { uploadToImageKit } = require('../utils/imagekit');
const appConfig = require('../config/app');

function t(req, km, en) {
  return req.session.lang === 'km' ? km : en;
}

// ==================== LOGIN ====================

router.get('/login', (req, res) => {
  const showResendPanel = req.query.unverified === '1';
  const resendEmail = req.query.email || '';
  res.render('auth/login', { title: 'Login', showResendPanel, resendEmail });
});

router.post('/login', [
  body('login_identifier').trim().notEmpty().withMessage('Email, username, or phone is required'),
  body('password').notEmpty().withMessage('Password is required'),
], async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      req.flash('error', t(req, 'អ៊ីមែល ឬពាក្យសម្ងាត់ ឬទូរស័ព្ទត្រូវបំពេញ', 'Email, username, or phone is required'));
      return res.redirect('/auth/login');
    }
    const { login_identifier, password } = req.body;
    const [users] = await req.db.query(
      'SELECT * FROM users WHERE email = ? OR username = ? OR phone = ?',
      [login_identifier, login_identifier, login_identifier]
    );
    if (users.length === 0) {
      req.flash('error', t(req, 'ព័ត៌មានចូលមិនត្រឹមត្រូវ', 'Invalid credentials'));
      return res.redirect('/auth/login');
    }
    const user = users[0];
    const isMatch = await bcrypt.compare(password, user.password);
    if (!isMatch) {
      req.flash('error', t(req, 'ព័ត៌មានចូលមិនត្រឹមត្រូវ', 'Invalid credentials'));
      return res.redirect('/auth/login');
    }
    if (!user.is_verified) {
      req.flash('error', t(req, 'សូមផ្ទៀងផ្ទាត់គណនីរបស់អ្នកមុនពេលចូល', 'Please verify your account before logging in'));
      return res.redirect('/auth/verify-otp?userId=' + user.id);
    }
    req.session.user = {
      id: user.id,
      email: user.email,
      phone: user.phone,
      role: user.role,
      khmer_name: user.khmer_name,
      english_name: user.english_name,
      national_id: user.national_id,
      gender: user.gender,
      date_of_birth: user.date_of_birth,
      place_of_birth: user.place_of_birth,
      address: user.address,
      profile_pic: user.profile_pic
    };
    if (user.role === 'admin') {
      return res.redirect('/admin/dashboard');
    } else if (user.role === 'committee') {
      return res.redirect('/committee/dashboard');
    }
    return res.redirect('/student/dashboard');
  } catch (error) {
    console.error('Login error:', error);
    req.flash('error', t(req, 'មានកំហុសក្នុងការចូល', 'An error occurred during login'));
    return res.redirect('/auth/login');
  }
});

// ==================== REGISTER ====================

router.get('/register', (req, res) => {
  res.render('auth/register', { title: 'Register' });
});

router.post('/register', [
  body('khmer_name').trim().notEmpty().withMessage('Khmer name is required'),
  body('english_name').trim().notEmpty().withMessage('Latin name is required'),
  body('email').isEmail().normalizeEmail().withMessage('Valid email is required'),
  body('phone').trim().notEmpty().withMessage('Phone number is required'),
  body('password').isLength({ min: 6 }).withMessage('Password must be at least 6 characters'),
  body('confirm_password').custom((value, { req }) => value === req.body.password).withMessage('Passwords do not match'),
  body('verify_method').isIn(['email', 'telegram']).withMessage('Invalid verification method'),
], async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      req.flash('error', t(req, 'សូមបំពេញព័ត៌មានទាំងអស់ឱ្យបានត្រឹមត្រូវ', 'Please fill in all fields correctly'));
      return res.redirect('/auth/register');
    }
    const [settingsRows] = await req.db.query('SELECT * FROM settings');
    const settings = {};
    settingsRows.forEach(row => { settings[row.setting_key] = row.setting_value; });
    if (settings.registration_open === '0') {
      req.flash('error', t(req, 'ការចុះឈ្មោះបច្ចុប្បន្នបិទ។ សូមព្យាយាមនៅពេលក្រោយ។', 'Registration is currently closed. Please check back later.'));
      return res.redirect('/auth/register');
    }
    const now = new Date();
    if (settings.registration_start && new Date(settings.registration_start) > now) {
      req.flash('error', t(req, 'ការចុះឈ្មោះមិនទាន់ចាប់ផ្តើមនៅឡើយទេ។ សូមព្យាយាមនៅពេលក្រោយ។', 'Registration has not opened yet. Please check back later.'));
      return res.redirect('/auth/register');
    }
    if (settings.registration_end && new Date(settings.registration_end) < now) {
      req.flash('error', t(req, 'ការចុះឈ្មោះបានបិទ។ សូមព្យាយាមនៅពេលក្រោយ។', 'Registration has closed. Please check back later.'));
      return res.redirect('/auth/register');
    }
    const { khmer_name, english_name, national_id, gender, date_of_birth, place_of_birth, address, email, phone, password, verify_method } = req.body;

    const [existingEmail] = await req.db.query('SELECT id FROM users WHERE email = ?', [email]);
    if (existingEmail.length > 0) {
      req.flash('error', t(req, 'អ៊ីមែលនេះត្រូវបានចុះឈ្មោះរួចហើយ', 'Email already registered'));
      return res.redirect('/auth/register');
    }
    const [existingPhone] = await req.db.query('SELECT id FROM users WHERE phone = ?', [phone]);
    if (existingPhone.length > 0) {
      req.flash('error', t(req, 'លេខទូរស័ព្ទនេះត្រូវបានចុះឈ្មោះរួចហើយ', 'Phone number already registered'));
      return res.redirect('/auth/register');
    }
    const [existingNationalId] = await req.db.query('SELECT id FROM users WHERE national_id = ?', [national_id]);
    if (existingNationalId.length > 0) {
      req.flash('error', t(req, 'លេខអត្តសញ្ញាណប័ណ្ណនេះត្រូវបានចុះឈ្មោះរួចហើយ', 'National ID already registered'));
      return res.redirect('/auth/register');
    }

    const hashedPassword = await bcrypt.hash(password, 12);

    if (verify_method === 'email') {
      const token = generateToken();
      const expires = new Date(Date.now() + 3600000);
      const [result] = await req.db.query(
        'INSERT INTO users (khmer_name, english_name, national_id, gender, date_of_birth, place_of_birth, address, email, phone, password, role, is_verified, verification_token, token_expires_at, verify_method) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
        [khmer_name, english_name, national_id, gender, date_of_birth, place_of_birth, address, email, phone, hashedPassword, 'student', 0, token, expires, 'email']
      );
      const verificationUrl = `${appConfig.baseUrl}/auth/verify-email/${token}`;
      const emailSent = await sendEmail(email, 'Verify Your Scholarship Application', `
        <p>Hello ${escapeHtml(khmer_name || english_name)},</p>
        <p>Thank you for registering with our scholarship system.</p>
        <p>Please click the link below to verify your email address:</p>
        <a href="${verificationUrl}">${verificationUrl}</a>
        <p>This link will expire in 1 hour.</p>
        <p>If you did not create an account, please ignore this email.</p>
      `);
      if (emailSent) {
        req.flash('success', t(req, 'ការចុះឈ្មោះជោគជ័យ! សូមពិនិត្យមើលអ៊ីមែលរបស់អ្នកដើម្បីផ្ទៀងផ្ទាត់។', 'Registration successful! Please check your email to verify your account.'));
      } else {
        req.flash('error', t(req, 'ការចុះឈ្មោះជោគជ័យ ប៉ុន្តែមិនអាចផ្ញើអ៊ីមែលផ្ទៀងផ្ទាត់បានទេ។', 'Registration successful but failed to send verification email.'));
      }
      return res.redirect('/auth/login');
    } else {
      const [result] = await req.db.query(
        'INSERT INTO users (khmer_name, english_name, national_id, gender, date_of_birth, place_of_birth, address, email, phone, password, role, is_verified, verify_method) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
        [khmer_name, english_name, national_id, gender, date_of_birth, place_of_birth, address, email, phone, hashedPassword, 'student', 0, 'telegram']
      );
      const userId = result.insertId;

      try {
        await telegramOtp.sendOTP(phone);
        req.flash('success', t(req, 'ការចុះឈ្មោះជោគជ័យ! សូមបញ្ចូលលេខកូដ OTP ដែលបានផ្ញើទៅ Telegram របស់អ្នក។', 'Registration successful! Please enter the OTP code sent to your Telegram.'));
        return res.redirect('/auth/verify-otp?userId=' + userId);
      } catch (otpError) {
        console.error('Telegram OTP send error:', otpError);
        req.flash('error', t(req, 'ការចុះឈ្មោះជោគជ័យ ប៉ុន្តែមិនអាចផ្ញើ OTP បានទេ។ សូមព្យាយាមផ្ញើឡើងវិញ។', 'Registration successful but failed to send OTP. Please try to resend from verification page.'));
        return res.redirect('/auth/verify-otp?userId=' + userId);
      }
    }
  } catch (error) {
    console.error('Registration error:', error);
    req.flash('error', t(req, 'មានកំហុសក្នុងការចុះឈ្មោះ', 'An error occurred during registration'));
    return res.redirect('/auth/register');
  }
});

// ==================== EMAIL VERIFICATION ====================

router.get('/verify-email/:token', async (req, res) => {
  try {
    const { token } = req.params;
    const [users] = await req.db.query(
      'SELECT * FROM users WHERE verification_token = ? AND token_expires_at > NOW()',
      [token]
    );
    if (users.length === 0) {
      req.flash('error', t(req, 'តំណផ្ទៀងផ្ទាត់មិនត្រឹមត្រូវឬផុតកំណត់', 'Invalid or expired verification token'));
      return res.redirect('/auth/login');
    }
    const user = users[0];
    await req.db.query(
      'UPDATE users SET is_verified = 1, verification_token = NULL, token_expires_at = NULL WHERE id = ?',
      [user.id]
    );
    req.flash('success', t(req, 'ផ្ទៀងផ្ទាត់អ៊ីមែលជោគជ័យ! អ្នកអាចចូលបានឥឡូវនេះ។', 'Email verified successfully! You can now login.'));
    return res.redirect('/auth/login');
  } catch (error) {
    console.error('Email verification error:', error);
    req.flash('error', t(req, 'មានកំហុសក្នុងការផ្ទៀងផ្ទាត់', 'An error occurred during verification'));
    return res.redirect('/auth/login');
  }
});

router.post('/resend-email', [
  body('email').isEmail().normalizeEmail().withMessage('Valid email is required'),
], async (req, res) => {
  try {
    const { email } = req.body;
    const [users] = await req.db.query('SELECT * FROM users WHERE email = ? AND is_verified = 0', [email]);
    if (users.length === 0) {
      req.flash('error', t(req, 'រកមិនឃើញការចុះឈ្មោះដែលរង់ចាំសម្រាប់អ៊ីមែលនេះទេ', 'No pending registration found for this email'));
      return res.redirect('/auth/login');
    }
    const user = users[0];
    const token = generateToken();
    const expires = new Date(Date.now() + 3600000);
    await req.db.query(
      'UPDATE users SET verification_token = ?, token_expires_at = ? WHERE id = ?',
      [token, expires, user.id]
    );
    const verificationUrl = `${appConfig.baseUrl}/auth/verify-email/${token}`;
    await sendEmail(email, 'Resend Verification Link', `
      <p>Hello ${escapeHtml(user.khmer_name || user.english_name)},</p>
      <p>Here is your verification link:</p>
      <a href="${verificationUrl}">${verificationUrl}</a>
      <p>This link will expire in 1 hour.</p>
    `);
    req.flash('success', t(req, 'បានផ្ញើអ៊ីមែលផ្ទៀងផ្ទាត់ហើយ។ សូមពិនិត្យមើលប្រអប់សំបុត្ររបស់អ្នក។', 'Verification email sent. Please check your inbox.'));
    return res.redirect('/auth/login?unverified=1&email=' + encodeURIComponent(email));
  } catch (error) {
    console.error('Resend email error:', error);
    req.flash('error', t(req, 'មានកំហុស។ សូមព្យាយាមម្តងទៀត។', 'An error occurred. Please try again.'));
    return res.redirect('/auth/login');
  }
});

// ==================== TELEGRAM OTP VERIFICATION ====================

router.get('/verify-otp', async (req, res) => {
  const userId = req.query.userId;
  if (!userId) return res.redirect('/auth/login');

  try {
    const [users] = await req.db.query('SELECT id, phone, is_verified, verify_method FROM users WHERE id = ?', [userId]);
    if (users.length === 0) return res.redirect('/auth/login');
    const user = users[0];
    if (user.is_verified) {
      req.flash('success', t(req, 'គណនីត្រូវបានផ្ទៀងផ្ទាត់រួចហើយ។ អ្នកអាចចូលបាន។', 'Account already verified. You can login.'));
      return res.redirect('/auth/login');
    }

    const resend = await canResend(req.db, userId);
    const maskedPhone = user.phone ? user.phone.substring(0, 5) + '***' + user.phone.substring(user.phone.length - 3) : '***';

    res.render('auth/verify-otp', {
      title: 'Verify Account',
      userId: user.id,
      maskedPhone,
      canResend: resend.allowed,
      waitSeconds: resend.waitSeconds,
      verifyMethod: user.verify_method || 'telegram',
      error: null,
      success: null
    });
  } catch (error) {
    console.error('Verify OTP page error:', error);
    req.flash('error', t(req, 'មានកំហុស', 'An error occurred'));
    return res.redirect('/auth/login');
  }
});

router.post('/verify-otp', [
  body('otpCode').isLength({ min: 5, max: 5 }).withMessage('Please enter a 5-digit code'),
], async (req, res) => {
  try {
    const errors = validationResult(req);
    const { userId, otpCode, verify_method } = req.body;

    const [users] = await req.db.query('SELECT id, phone, is_verified, verify_method FROM users WHERE id = ?', [userId]);
    if (users.length === 0) return res.redirect('/auth/login');
    const user = users[0];
    if (user.is_verified) {
      req.flash('success', t(req, 'ផ្ទៀងផ្ទាត់រួចហើយ', 'Already verified'));
      return res.redirect('/auth/login');
    }

    const method = verify_method || user.verify_method || 'telegram';
    const resend = await canResend(req.db, userId);
    const maskedPhone = user.phone ? user.phone.substring(0, 5) + '***' + user.phone.substring(user.phone.length - 3) : '***';

    if (!errors.isEmpty()) {
      return res.render('auth/verify-otp', {
        title: 'Verify Account',
        userId,
        maskedPhone,
        canResend: resend.allowed,
        waitSeconds: resend.waitSeconds,
        verifyMethod: method,
        error: errors.array()[0].msg,
        success: null
      });
    }

    if (method === 'telegram') {
      try {
        await telegramOtp.verifyOTP(user.phone, otpCode);
        await req.db.query(
          'UPDATE users SET is_verified = 1, otp_code = NULL, otp_expires_at = NULL, otp_attempts = 0 WHERE id = ?',
          [userId]
        );
        req.flash('success', t(req, 'ផ្ទៀងផ្ទាត់ទូរស័ព្ទជោគជ័យ! អ្នកអាចចូលបានឥឡូវនេះ។', 'Phone verified successfully! You can now login.'));
        return res.redirect('/auth/login');
      } catch (verifyError) {
        return res.render('auth/verify-otp', {
          title: 'Verify Account',
          userId,
          maskedPhone,
          canResend: resend.allowed,
          waitSeconds: resend.waitSeconds,
          verifyMethod: method,
          error: verifyError.message,
          success: null
        });
      }
    } else {
      const result = await verifyUserOTP(req.db, userId, otpCode);
      if (result.success) {
        req.flash('success', t(req, 'ផ្ទៀងផ្ទាត់អ៊ីមែលជោគជ័យ! អ្នកអាចចូលបានឥឡូវនេះ។', 'Email verified successfully! You can now login.'));
        return res.redirect('/auth/login');
      } else {
        return res.render('auth/verify-otp', {
          title: 'Verify Account',
          userId,
          maskedPhone,
          canResend: resend.allowed,
          waitSeconds: resend.waitSeconds,
          verifyMethod: method,
          error: result.messageText || result.message,
          success: null
        });
      }
    }
  } catch (error) {
    console.error('Verify OTP error:', error);
    req.flash('error', t(req, 'មានកំហុសក្នុងការផ្ទៀងផ្ទាត់', 'An error occurred during verification'));
    return res.redirect('/auth/login');
  }
});

router.post('/resend-otp', async (req, res) => {
  try {
    const { userId } = req.body;
    const [users] = await req.db.query('SELECT id, phone, verify_method FROM users WHERE id = ? AND is_verified = 0', [userId]);
    if (users.length === 0) {
      req.flash('error', t(req, 'រកមិនឃើញការផ្ទៀងផ្ទាត់ដែលរង់ចាំទេ', 'No pending verification found'));
      return res.redirect('/auth/login');
    }
    const user = users[0];
    const method = user.verify_method || 'telegram';

    const resendCheck = await canResend(req.db, userId);
    if (!resendCheck.allowed) {
      req.flash('error', t(req, 'សូមរង់ចាំមុនពេលផ្ញើឡើងវិញ', 'Please wait before resending'));
      return res.redirect('/auth/verify-otp?userId=' + userId);
    }

    if (method === 'telegram') {
      try {
        await telegramOtp.sendOTP(user.phone);
        req.flash('success', t(req, 'បានផ្ញើ OTP ថ្មីទៅ Telegram របស់អ្នក។', 'New OTP sent to your Telegram.'));
      } catch (otpError) {
        console.error('Telegram resend error:', otpError);
        req.flash('error', t(req, 'មិនអាចផ្ញើ OTP ឡើងវិញបានទេ។ សូមព្យាយាមម្តងទៀត។', 'Failed to resend OTP. Please try again.'));
      }
    } else {
      const code = generateOTP();
      await storeOTP(req.db, userId, code);
      const [emailUser] = await req.db.query('SELECT email FROM users WHERE id = ?', [userId]);
      if (emailUser.length > 0) {
        await sendEmail(emailUser[0].email, 'Your Verification Code', `
          <p>Your verification code is: <strong>${code}</strong></p>
          <p>This code expires in ${process.env.OTP_EXPIRY_MINUTES || 10} minutes.</p>
        `);
      }
      req.flash('success', t(req, 'បានផ្ញើកូដផ្ទៀងផ្ទាត់ថ្មីទៅអ៊ីមែលរបស់អ្នក។', 'New verification code sent to your email.'));
    }
    return res.redirect('/auth/verify-otp?userId=' + userId);
  } catch (error) {
    console.error('Resend OTP error:', error);
    req.flash('error', t(req, 'មានកំហុស', 'An error occurred'));
    return res.redirect('/auth/login');
  }
});

// ==================== LOGOUT ====================

router.get('/logout', (req, res) => {
  req.session.destroy((err) => {
    if (err) {
      console.error('Logout error:', err);
    }
    return res.redirect('/');
  });
});

// ==================== VERIFY ACCOUNT (lookup by email/phone) ====================

router.get('/verify-account', (req, res) => {
  res.render('auth/verify-account', { title: 'Verify Account' });
});

router.post('/verify-account', [
  body('identifier').trim().notEmpty().withMessage('Email or phone number is required'),
], async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      req.flash('error', t(req, 'សូមបំពេញអ៊ីមែលឬលេខទូរស័ព្ទ', 'Email or phone number is required'));
      return res.redirect('/auth/verify-account');
    }
    const { identifier } = req.body;
    const [users] = await req.db.query(
      'SELECT id, email, phone, is_verified, verify_method FROM users WHERE email = ? OR phone = ?',
      [identifier, identifier]
    );
    if (users.length === 0) {
      req.flash('error', t(req, 'រកមិនឃើញគណនីដែលមានអ៊ីមែលឬលេខទូរស័ព្ទនេះទេ', 'No account found with that email or phone number'));
      return res.redirect('/auth/verify-account');
    }
    const user = users[0];
    if (user.is_verified) {
      req.flash('success', t(req, 'គណនីត្រូវបានផ្ទៀងផ្ទាត់រួចហើយ។ អ្នកអាចចូលបាន។', 'Account is already verified. You can login.'));
      return res.redirect('/auth/login');
    }
    return res.redirect('/auth/verify-otp?userId=' + user.id);
  } catch (error) {
    console.error('Verify account lookup error:', error);
    req.flash('error', t(req, 'មានកំហុស', 'An error occurred'));
    return res.redirect('/auth/verify-account');
  }
});

// ==================== FORGOT PASSWORD ====================

router.get('/forgot-password', (req, res) => {
  res.render('auth/forgot-password', { title: 'Forgot Password' });
});

router.post('/forgot-password', async (req, res) => {
  try {
    const { email } = req.body;
    if (!email) {
      req.flash('error', t(req, 'សូមបំពេញអ៊ីមែលរបស់អ្នក', 'Please provide your email'));
      return res.redirect('/auth/forgot-password');
    }
    const [users] = await req.db.query('SELECT * FROM users WHERE email = ?', [email]);
    if (users.length === 0) {
      req.flash('success', t(req, 'ប្រសិនបើអ៊ីមែលមាន តំណកំណត់ឡើងវិញត្រូវបានផ្ញើហើយ', 'If the email exists, a reset link has been sent'));
      return res.redirect('/auth/forgot-password');
    }
    const user = users[0];
    const token = generateToken();
    const expires = new Date(Date.now() + 3600000);
    await req.db.query(
      'UPDATE users SET reset_token = ?, reset_token_expires = ? WHERE id = ?',
      [token, expires, user.id]
    );
    const resetUrl = `${appConfig.baseUrl}/auth/reset-password/${token}`;
    await sendEmail(user.email, 'Password Reset Request', `
      <p>Click the link below to reset your password:</p>
      <a href="${resetUrl}">${resetUrl}</a>
      <p>This link expires in 1 hour.</p>
    `);
    req.flash('success', t(req, 'ប្រសិនបើអ៊ីមែលមាន តំណកំណត់ឡើងវិញត្រូវបានផ្ញើហើយ', 'If the email exists, a reset link has been sent'));
    return res.redirect('/auth/forgot-password');
  } catch (error) {
    console.error('Forgot password error:', error);
    req.flash('error', t(req, 'មានកំហុស', 'An error occurred'));
    return res.redirect('/auth/forgot-password');
  }
});

router.get('/reset-password/:token', async (req, res) => {
  try {
    const { token } = req.params;
    const [users] = await req.db.query(
      'SELECT * FROM users WHERE reset_token = ? AND reset_token_expires > NOW()',
      [token]
    );
    if (users.length === 0) {
      req.flash('error', t(req, 'តំណកំណត់មិនត្រឹមត្រូវឬផុតកំណត់', 'Invalid or expired reset token'));
      return res.redirect('/auth/login');
    }
    res.render('auth/reset-password', { title: 'Reset Password', token });
  } catch (error) {
    console.error('Reset password page error:', error);
    req.flash('error', t(req, 'មានកំហុស', 'An error occurred'));
    return res.redirect('/auth/login');
  }
});

router.post('/reset-password/:token', async (req, res) => {
  try {
    const { token } = req.params;
    const { password, confirm_password } = req.body;
    if (!password || !confirm_password) {
      req.flash('error', t(req, 'សូមបំពេញពាក្យសម្ងាត់ថ្មី', 'Please provide new password'));
      return res.redirect(`/auth/reset-password/${token}`);
    }
    if (password !== confirm_password) {
      req.flash('error', t(req, 'ពាក្យសម្ងាត់មិនផ្គូរផ្គង់ទេ', 'Passwords do not match'));
      return res.redirect(`/auth/reset-password/${token}`);
    }
    if (password.length < 6) {
      req.flash('error', t(req, 'ពាក្យសម្ងាត់ត្រូវមានយ៉ាងហោចណាស់ ៦ តួអក្សរ', 'Password must be at least 6 characters'));
      return res.redirect(`/auth/reset-password/${token}`);
    }
    const [users] = await req.db.query(
      'SELECT * FROM users WHERE reset_token = ? AND reset_token_expires > NOW()',
      [token]
    );
    if (users.length === 0) {
      req.flash('error', t(req, 'តំណកំណត់មិនត្រឹមត្រូវឬផុតកំណត់', 'Invalid or expired reset token'));
      return res.redirect('/auth/login');
    }
    const hashedPassword = await bcrypt.hash(password, 12);
    await req.db.query(
      'UPDATE users SET password = ?, reset_token = NULL, reset_token_expires = NULL WHERE id = ?',
      [hashedPassword, users[0].id]
    );
    req.flash('success', t(req, 'កំណត់ពាក្យសម្ងាត់ឡើងវិញជោគជ័យ។ សូមចូល។', 'Password reset successful. Please login.'));
    return res.redirect('/auth/login');
  } catch (error) {
    console.error('Reset password error:', error);
    req.flash('error', t(req, 'មានកំហុស', 'An error occurred'));
    return res.redirect('/auth/login');
  }
});

// ==================== PROFILE ====================

const { uploadPhoto } = require('../middleware/upload');

router.get('/profile', async (req, res) => {
  if (!req.session.user) return res.redirect('/auth/login');
  try {
    const [users] = await req.db.query('SELECT * FROM users WHERE id = ?', [req.session.user.id]);
    res.render('auth/profile', { title: 'Profile', profile: users[0] });
  } catch (error) {
    console.error(error);
    req.flash('error', t(req, 'មានកំហុសក្នុងការផ្ទុកប្រវត្តិរូប', 'Error loading profile'));
    res.redirect('back');
  }
});

router.post('/profile', uploadPhoto, async (req, res) => {
  if (!req.session.user) return res.redirect('/auth/login');
  if (!req.body._csrf || req.body._csrf !== req.session.csrfToken) {
    req.flash('error', t(req, 'តិតុក្កត់ CSRF មិនត្រឹមត្រូវ។ សូមព្យាយាមម្តងទៀត។', 'Invalid or missing CSRF token. Please try again.'));
    return res.redirect('/auth/profile');
  }
  try {
    const { khmer_name, english_name, national_id, gender, date_of_birth, place_of_birth, address, email, phone } = req.body;
    const dob = date_of_birth || null;
    const nid = national_id || null;
    const pob = place_of_birth || null;
    const addr = address || null;
    const gen = gender || null;
    let profilePic = null;
    if (req.file) {
      const r = await uploadToImageKit(req.file, 'profile');
      profilePic = r.url;
    }
    
    if (profilePic) {
      await req.db.query(
        'UPDATE users SET khmer_name = ?, english_name = ?, national_id = ?, gender = ?, date_of_birth = ?, place_of_birth = ?, address = ?, email = ?, phone = ?, profile_pic = ? WHERE id = ?',
        [khmer_name, english_name, nid, gen, dob, pob, addr, email, phone, profilePic, req.session.user.id]
      );
    } else {
      await req.db.query(
        'UPDATE users SET khmer_name = ?, english_name = ?, national_id = ?, gender = ?, date_of_birth = ?, place_of_birth = ?, address = ?, email = ?, phone = ? WHERE id = ?',
        [khmer_name, english_name, nid, gen, dob, pob, addr, email, phone, req.session.user.id]
      );
    }
    
    req.session.user.khmer_name = khmer_name;
    req.session.user.english_name = english_name;
    req.session.user.national_id = nid;
    req.session.user.gender = gen;
    req.session.user.date_of_birth = dob;
    req.session.user.place_of_birth = pob;
    req.session.user.address = addr;
    req.session.user.email = email;
    if (profilePic) req.session.user.profile_pic = profilePic;
    
    req.flash('success', t(req, 'ប្រវត្តិរូបត្រូវបានកែប្រែជោគជ័យ', 'Profile updated successfully'));
    res.redirect('/auth/profile');
  } catch (error) {
    console.error(error);
    req.flash('error', t(req, 'មានកំហុសក្នុងការកែប្រែប្រវត្តិរូប', 'Error updating profile'));
    res.redirect('/auth/profile');
  }
});

router.post('/profile/password', async (req, res) => {
  if (!req.session.user) return res.redirect('/auth/login');
  try {
    const { current_password, new_password, confirm_password } = req.body;
    
    if (new_password !== confirm_password) {
      req.flash('error', t(req, 'ពាក្យសម្ងាត់មិនផ្គូរផ្គង់ទេ', 'Passwords do not match'));
      return res.redirect('/auth/profile');
    }
    
    if (new_password.length < 6) {
      req.flash('error', t(req, 'ពាក្យសម្ងាត់ត្រូវមានយ៉ាងហោចណាស់ ៦ តួអក្សរ', 'Password must be at least 6 characters'));
      return res.redirect('/auth/profile');
    }
    
    const [users] = await req.db.query('SELECT password FROM users WHERE id = ?', [req.session.user.id]);
    const isMatch = await bcrypt.compare(current_password, users[0].password);
    
    if (!isMatch) {
      req.flash('error', t(req, 'ពាក្យសម្ងាត់បច្ចុប្បន្នមិនត្រឹមត្រូវទេ', 'Current password is incorrect'));
      return res.redirect('/auth/profile');
    }
    
    const hashedPassword = await bcrypt.hash(new_password, 12);
    await req.db.query('UPDATE users SET password = ? WHERE id = ?', [hashedPassword, req.session.user.id]);
    
    req.flash('success', t(req, 'ប្តូរពាក្យសម្ងាត់ជោគជ័យ', 'Password changed successfully'));
    res.redirect('/auth/profile');
  } catch (error) {
    console.error(error);
    req.flash('error', t(req, 'មានកំហុសក្នុងការប្តូរពាក្យសម្ងាត់', 'Error changing password'));
    res.redirect('/auth/profile');
  }
});

module.exports = router;
