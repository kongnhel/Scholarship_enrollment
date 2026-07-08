const express = require('express');
const router = express.Router();
const bcrypt = require('bcryptjs');
const nodemailer = require('nodemailer');
const { sendEmail } = require('../config/mailer');
const { body, validationResult } = require('express-validator');
const { generateToken } = require('../utils/helpers');
const { generateOTP, storeOTP, verifyOTP: verifyUserOTP, canResend, clearOTP } = require('../utils/otp');
const telegramOtp = require('../services/otpSender');
const { uploadToImageKit } = require('../utils/imagekit');

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
      req.flash('error', errors.array().map(e => e.msg).join('. '));
      return res.redirect('/auth/login');
    }
    const { login_identifier, password } = req.body;
    const [users] = await req.db.query(
      'SELECT * FROM users WHERE email = ? OR username = ? OR phone = ?',
      [login_identifier, login_identifier, login_identifier]
    );
    if (users.length === 0) {
      req.flash('error', 'Invalid credentials');
      return res.redirect('/auth/login');
    }
    const user = users[0];
    const isMatch = await bcrypt.compare(password, user.password);
    if (!isMatch) {
      req.flash('error', 'Invalid credentials');
      return res.redirect('/auth/login');
    }
    if (!user.is_verified) {
      req.flash('error', 'Please verify your account before logging in');
      return res.redirect('/auth/verify-otp?userId=' + user.id);
    }
    req.session.user = {
      id: user.id,
      email: user.email,
      phone: user.phone,
      role: user.role,
      khmer_name: user.khmer_name,
      english_name: user.english_name,
      username: user.username,
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
    req.flash('error', 'An error occurred during login');
    return res.redirect('/auth/login');
  }
});

// ==================== REGISTER ====================

router.get('/register', (req, res) => {
  res.render('auth/register', { title: 'Register' });
});

router.post('/register', [
  body('khmer_name').trim().notEmpty().withMessage('Khmer name is required'),
  body('english_name').trim().notEmpty().withMessage('English name is required'),
  body('username').trim().matches(/^[a-zA-Z0-9_]{3,50}$/).withMessage('Username must be 3-50 characters (letters, numbers, _)'),
  body('email').isEmail().normalizeEmail().withMessage('Valid email is required'),
  body('phone').trim().notEmpty().withMessage('Phone number is required'),
  body('password').isLength({ min: 6 }).withMessage('Password must be at least 6 characters'),
  body('confirm_password').custom((value, { req }) => value === req.body.password).withMessage('Passwords do not match'),
  body('verify_method').isIn(['email', 'telegram']).withMessage('Invalid verification method'),
], async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      req.flash('error', errors.array().map(e => e.msg).join('. '));
      return res.redirect('/auth/register');
    }
    const [settingsRows] = await req.db.query('SELECT * FROM settings');
    const settings = {};
    settingsRows.forEach(row => { settings[row.setting_key] = row.setting_value; });
    if (settings.registration_open === '0') {
      req.flash('error', 'Registration is currently closed. Please check back later.');
      return res.redirect('/auth/register');
    }
    const now = new Date();
    if (settings.registration_start && new Date(settings.registration_start) > now) {
      req.flash('error', 'Registration has not opened yet. Please check back later.');
      return res.redirect('/auth/register');
    }
    if (settings.registration_end && new Date(settings.registration_end) < now) {
      req.flash('error', 'Registration has closed. Please check back later.');
      return res.redirect('/auth/register');
    }
    const { khmer_name, english_name, username, email, phone, password, verify_method } = req.body;

    const [existingUsername] = await req.db.query('SELECT id FROM users WHERE username = ?', [username]);
    if (existingUsername.length > 0) {
      req.flash('error', 'Username already taken');
      return res.redirect('/auth/register');
    }
    const [existingEmail] = await req.db.query('SELECT id FROM users WHERE email = ?', [email]);
    if (existingEmail.length > 0) {
      req.flash('error', 'Email already registered');
      return res.redirect('/auth/register');
    }
    const [existingPhone] = await req.db.query('SELECT id FROM users WHERE phone = ?', [phone]);
    if (existingPhone.length > 0) {
      req.flash('error', 'Phone number already registered');
      return res.redirect('/auth/register');
    }

    const hashedPassword = await bcrypt.hash(password, 12);

    if (verify_method === 'email') {
      const token = generateToken();
      const expires = new Date(Date.now() + 3600000);
      const [result] = await req.db.query(
        'INSERT INTO users (khmer_name, english_name, username, email, phone, password, role, is_verified, verification_token, token_expires_at, verify_method) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
        [khmer_name, english_name, username, email, phone, hashedPassword, 'student', 0, token, expires, 'email']
      );
      const verificationUrl = `${req.protocol}://${req.get('host')}/auth/verify-email/${token}`;
      const emailSent = await sendEmail(email, 'Verify Your Scholarship Application', `
        <p>Hello ${khmer_name || english_name},</p>
        <p>Thank you for registering with our scholarship system.</p>
        <p>Please click the link below to verify your email address:</p>
        <a href="${verificationUrl}">${verificationUrl}</a>
        <p>This link will expire in 1 hour.</p>
        <p>If you did not create an account, please ignore this email.</p>
      `);
      if (emailSent) {
        req.flash('success', 'Registration successful! Please check your email to verify your account.');
      } else {
        req.flash('error', 'Registration successful but failed to send verification email.');
      }
      return res.redirect('/auth/login');
    } else {
      const [result] = await req.db.query(
        'INSERT INTO users (khmer_name, english_name, username, email, phone, password, role, is_verified, verify_method) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
        [khmer_name, english_name, username, email, phone, hashedPassword, 'student', 0, 'telegram']
      );
      const userId = result.insertId;

      try {
        await telegramOtp.sendOTP(phone);
        req.flash('success', 'Registration successful! Please enter the OTP code sent to your Telegram.');
        return res.redirect('/auth/verify-otp?userId=' + userId);
      } catch (otpError) {
        console.error('Telegram OTP send error:', otpError);
        req.flash('error', 'Registration successful but failed to send OTP. Please try to resend from verification page.');
        return res.redirect('/auth/verify-otp?userId=' + userId);
      }
    }
  } catch (error) {
    console.error('Registration error:', error);
    req.flash('error', 'An error occurred during registration');
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
      req.flash('error', 'Invalid or expired verification token');
      return res.redirect('/auth/login');
    }
    const user = users[0];
    await req.db.query(
      'UPDATE users SET is_verified = 1, verification_token = NULL, token_expires_at = NULL WHERE id = ?',
      [user.id]
    );
    req.flash('success', 'Email verified successfully! You can now login.');
    return res.redirect('/auth/login');
  } catch (error) {
    console.error('Email verification error:', error);
    req.flash('error', 'An error occurred during verification');
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
      req.flash('error', 'No pending registration found for this email');
      return res.redirect('/auth/login');
    }
    const user = users[0];
    const token = generateToken();
    const expires = new Date(Date.now() + 3600000);
    await req.db.query(
      'UPDATE users SET verification_token = ?, token_expires_at = ? WHERE id = ?',
      [token, expires, user.id]
    );
    const verificationUrl = `${req.protocol}://${req.get('host')}/auth/verify-email/${token}`;
    await sendEmail(email, 'Resend Verification Link', `
      <p>Hello ${user.khmer_name || user.english_name},</p>
      <p>Here is your verification link:</p>
      <a href="${verificationUrl}">${verificationUrl}</a>
      <p>This link will expire in 1 hour.</p>
    `);
    req.flash('success', 'Verification email sent. Please check your inbox.');
    return res.redirect('/auth/login?unverified=1&email=' + encodeURIComponent(email));
  } catch (error) {
    console.error('Resend email error:', error);
    req.flash('error', 'An error occurred. Please try again.');
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
      req.flash('success', 'Account already verified. You can login.');
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
    req.flash('error', 'An error occurred');
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
      req.flash('success', 'Already verified');
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
        req.flash('success', 'Phone verified successfully! You can now login.');
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
        req.flash('success', 'Email verified successfully! You can now login.');
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
    req.flash('error', 'An error occurred during verification');
    return res.redirect('/auth/login');
  }
});

router.post('/resend-otp', async (req, res) => {
  try {
    const { userId } = req.body;
    const [users] = await req.db.query('SELECT id, phone, verify_method FROM users WHERE id = ? AND is_verified = 0', [userId]);
    if (users.length === 0) {
      req.flash('error', 'No pending verification found');
      return res.redirect('/auth/login');
    }
    const user = users[0];
    const method = user.verify_method || 'telegram';

    const resendCheck = await canResend(req.db, userId);
    if (!resendCheck.allowed) {
      req.flash('error', 'Please wait before resending');
      return res.redirect('/auth/verify-otp?userId=' + userId);
    }

    if (method === 'telegram') {
      try {
        await telegramOtp.sendOTP(user.phone);
        const code = telegramOtp.generateOTP();
        await storeOTP(req.db, userId, code);
        req.flash('success', 'New OTP sent to your Telegram.');
      } catch (otpError) {
        console.error('Telegram resend error:', otpError);
        req.flash('error', 'Failed to resend OTP. Please try again.');
      }
    } else {
      const code = generateOTP();
      await storeOTP(req.db, userId, code);
      const emailUser = await req.db.query('SELECT email FROM users WHERE id = ?', [userId]);
      if (emailUser.length > 0) {
        await sendEmail(emailUser[0].email, 'Your Verification Code', `
          <p>Your verification code is: <strong>${code}</strong></p>
          <p>This code expires in ${process.env.OTP_EXPIRY_MINUTES || 10} minutes.</p>
        `);
      }
      req.flash('success', 'New verification code sent to your email.');
    }
    return res.redirect('/auth/verify-otp?userId=' + userId);
  } catch (error) {
    console.error('Resend OTP error:', error);
    req.flash('error', 'An error occurred');
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
      req.flash('error', errors.array()[0].msg);
      return res.redirect('/auth/verify-account');
    }
    const { identifier } = req.body;
    const [users] = await req.db.query(
      'SELECT id, email, phone, is_verified, verify_method FROM users WHERE email = ? OR phone = ?',
      [identifier, identifier]
    );
    if (users.length === 0) {
      req.flash('error', 'No account found with that email or phone number');
      return res.redirect('/auth/verify-account');
    }
    const user = users[0];
    if (user.is_verified) {
      req.flash('success', 'Account is already verified. You can login.');
      return res.redirect('/auth/login');
    }
    return res.redirect('/auth/verify-otp?userId=' + user.id);
  } catch (error) {
    console.error('Verify account lookup error:', error);
    req.flash('error', 'An error occurred');
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
      req.flash('error', 'Please provide your email');
      return res.redirect('/auth/forgot-password');
    }
    const [users] = await req.db.query('SELECT * FROM users WHERE email = ?', [email]);
    if (users.length === 0) {
      req.flash('success', 'If the email exists, a reset link has been sent');
      return res.redirect('/auth/forgot-password');
    }
    const user = users[0];
    const token = generateToken();
    const expires = new Date(Date.now() + 3600000);
    await req.db.query(
      'UPDATE users SET reset_token = ?, reset_token_expires = ? WHERE id = ?',
      [token, expires, user.id]
    );
    const transporter = nodemailer.createTransport({
      host: process.env.EMAIL_HOST,
      port: process.env.EMAIL_PORT,
      secure: false,
      auth: {
        user: process.env.EMAIL_USER,
        pass: process.env.EMAIL_PASS
      }
    });
    const resetUrl = `${req.protocol}://${req.get('host')}/auth/reset-password/${token}`;
    await transporter.sendMail({
      from: process.env.EMAIL_USER,
      to: user.email,
      subject: 'Password Reset Request',
      html: `<p>Click the link below to reset your password:</p><a href="${resetUrl}">${resetUrl}</a><p>This link expires in 1 hour.</p>`
    });
    req.flash('success', 'If the email exists, a reset link has been sent');
    return res.redirect('/auth/forgot-password');
  } catch (error) {
    console.error('Forgot password error:', error);
    req.flash('error', 'An error occurred');
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
      req.flash('error', 'Invalid or expired reset token');
      return res.redirect('/auth/login');
    }
    res.render('auth/reset-password', { title: 'Reset Password', token });
  } catch (error) {
    console.error('Reset password page error:', error);
    req.flash('error', 'An error occurred');
    return res.redirect('/auth/login');
  }
});

router.post('/reset-password/:token', async (req, res) => {
  try {
    const { token } = req.params;
    const { password, confirm_password } = req.body;
    if (!password || !confirm_password) {
      req.flash('error', 'Please provide new password');
      return res.redirect(`/auth/reset-password/${token}`);
    }
    if (password !== confirm_password) {
      req.flash('error', 'Passwords do not match');
      return res.redirect(`/auth/reset-password/${token}`);
    }
    if (password.length < 6) {
      req.flash('error', 'Password must be at least 6 characters');
      return res.redirect(`/auth/reset-password/${token}`);
    }
    const [users] = await req.db.query(
      'SELECT * FROM users WHERE reset_token = ? AND reset_token_expires > NOW()',
      [token]
    );
    if (users.length === 0) {
      req.flash('error', 'Invalid or expired reset token');
      return res.redirect('/auth/login');
    }
    const hashedPassword = await bcrypt.hash(password, 12);
    await req.db.query(
      'UPDATE users SET password = ?, reset_token = NULL, reset_token_expires = NULL WHERE id = ?',
      [hashedPassword, users[0].id]
    );
    req.flash('success', 'Password reset successful. Please login.');
    return res.redirect('/auth/login');
  } catch (error) {
    console.error('Reset password error:', error);
    req.flash('error', 'An error occurred');
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
    req.flash('error', 'Error loading profile');
    res.redirect('back');
  }
});

router.post('/profile', uploadPhoto, async (req, res) => {
  if (!req.session.user) return res.redirect('/auth/login');
  if (!req.body._csrf || req.body._csrf !== req.session.csrfToken) {
    req.flash('error', 'Invalid or missing CSRF token. Please try again.');
    return res.redirect('/auth/profile');
  }
  try {
    const { khmer_name, english_name, email, phone } = req.body;
    let profilePic = null;
    if (req.file) {
      const r = await uploadToImageKit(req.file, 'profile');
      profilePic = r.url;
    }
    
    if (profilePic) {
      await req.db.query(
        'UPDATE users SET khmer_name = ?, english_name = ?, email = ?, phone = ?, profile_pic = ? WHERE id = ?',
        [khmer_name, english_name, email, phone, profilePic, req.session.user.id]
      );
    } else {
      await req.db.query(
        'UPDATE users SET khmer_name = ?, english_name = ?, email = ?, phone = ? WHERE id = ?',
        [khmer_name, english_name, email, phone, req.session.user.id]
      );
    }
    
    req.session.user.khmer_name = khmer_name;
    req.session.user.english_name = english_name;
    req.session.user.email = email;
    if (profilePic) req.session.user.profile_pic = profilePic;
    
    req.flash('success', 'Profile updated successfully');
    res.redirect('/auth/profile');
  } catch (error) {
    console.error(error);
    req.flash('error', 'Error updating profile');
    res.redirect('/auth/profile');
  }
});

router.post('/profile/password', async (req, res) => {
  if (!req.session.user) return res.redirect('/auth/login');
  try {
    const { current_password, new_password, confirm_password } = req.body;
    
    if (new_password !== confirm_password) {
      req.flash('error', 'Passwords do not match');
      return res.redirect('/auth/profile');
    }
    
    if (new_password.length < 6) {
      req.flash('error', 'Password must be at least 6 characters');
      return res.redirect('/auth/profile');
    }
    
    const [users] = await req.db.query('SELECT password FROM users WHERE id = ?', [req.session.user.id]);
    const isMatch = await bcrypt.compare(current_password, users[0].password);
    
    if (!isMatch) {
      req.flash('error', 'Current password is incorrect');
      return res.redirect('/auth/profile');
    }
    
    const hashedPassword = await bcrypt.hash(new_password, 12);
    await req.db.query('UPDATE users SET password = ? WHERE id = ?', [hashedPassword, req.session.user.id]);
    
    req.flash('success', 'Password changed successfully');
    res.redirect('/auth/profile');
  } catch (error) {
    console.error(error);
    req.flash('error', 'Error changing password');
    res.redirect('/auth/profile');
  }
});

module.exports = router;
