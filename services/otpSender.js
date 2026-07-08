const { TelegramClient } = require('telegram');
const { StringSession } = require('telegram/sessions');
const { Api } = require('telegram/tl');

const crypto = require('crypto');

const apiId = parseInt(process.env.TELEGRAM_API_ID) || 0;
const apiHash = process.env.TELEGRAM_API_HASH || '';

const generateOTP = () => {
  return crypto.randomInt(10000, 99999).toString();
};

const pendingSessions = new Map();

setInterval(() => {
  const now = Date.now();
  for (const [phone, session] of pendingSessions) {
    if (now - session.createdAt > 10 * 60 * 1000) {
      session.client.disconnect().catch(() => {});
      pendingSessions.delete(phone);
    }
  }
}, 5 * 60 * 1000);

const normalizePhone = (phoneNumber) => {
  let phone = phoneNumber.trim().replace(/\s+/g, '');
  if (!phone.startsWith('+')) {
    if (phone.startsWith('0')) {
      phone = '+855' + phone.substring(1);
    } else {
      phone = '+' + phone;
    }
  }
  return phone;
};

const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));

const sendOTP = async (phoneNumber) => {
  if (!apiId || !apiHash) {
    throw new Error('Telegram API credentials not configured. Please set TELEGRAM_API_ID and TELEGRAM_API_HASH in .env');
  }

  const normalizedPhone = normalizePhone(phoneNumber);

  const existing = pendingSessions.get(normalizedPhone);
  if (existing) {
    try { await existing.client.disconnect(); } catch (e) {}
    pendingSessions.delete(normalizedPhone);
  }

  const client = new TelegramClient(new StringSession(''), apiId, apiHash, {
    connectionRetries: 2,
    timeout: 30,
    autoReconnect: false,
  });

  const connectTimeout = new Promise((_, reject) => {
    setTimeout(() => reject(new Error('Connection timeout')), 15000);
  });

  try {
    await Promise.race([client.connect(), connectTimeout]);
  } catch (e) {
    console.error('Telegram connect error:', e.message);
    throw new Error('Cannot connect to Telegram servers. Please try again later.');
  }

  try {
    const result = await client.invoke(
      new Api.auth.SendCode({
        phoneNumber: normalizedPhone,
        apiId,
        apiHash,
        settings: new Api.CodeSettings({
          allowFlashcall: false,
          currentNumber: false,
          allowAppHash: false,
        }),
      })
    );

    pendingSessions.set(normalizedPhone, {
      client,
      phoneCodeHash: result.phoneCodeHash,
      createdAt: Date.now(),
    });

    return { success: true, message: 'OTP sent via Telegram.' };
  } catch (error) {
    try { await client.disconnect(); } catch (e) {}

    const errMsg = error.message || '';
    if (errMsg.includes('PHONE_NUMBER_INVALID')) {
      throw new Error('Invalid phone number format. Please include country code (e.g., +855...)');
    }
    if (errMsg.includes('PHONE_NUMBER_FLOOD')) {
      throw new Error('Too many requests. Please wait a few minutes before trying again.');
    }
    console.error('Telegram SendCode error:', errMsg);
    throw new Error('Failed to send OTP via Telegram. Please try again later.');
  }
};

const verifyOTP = async (phoneNumber, code) => {
  const normalizedPhone = normalizePhone(phoneNumber);

  const session = pendingSessions.get(normalizedPhone);
  if (!session) {
    throw new Error('Session expired. Please request a new OTP.');
  }

  const { client, phoneCodeHash } = session;

  if (!client.connected) {
    const connectTimeout = new Promise((_, reject) => {
      setTimeout(() => reject(new Error('Connection timeout')), 15000);
    });
    try {
      await Promise.race([client.connect(), connectTimeout]);
    } catch (e) {
      pendingSessions.delete(normalizedPhone);
      throw new Error('Connection lost. Please request a new OTP.');
    }
  }

  try {
    const result = await client.invoke(
      new Api.auth.SignIn({
        phoneNumber: normalizedPhone,
        phoneCodeHash,
        phoneCode: code,
      })
    );

    pendingSessions.delete(normalizedPhone);
    await client.disconnect().catch(() => {});

    return { success: true, message: 'Phone verified successfully.' };
  } catch (error) {
    const errMsg = error.message || '';
    console.error('Telegram SignIn error:', errMsg);

    if (errMsg.includes('PHONE_CODE_INVALID') || errMsg.includes('PHONE_CODE_EMPTY')) {
      throw new Error('Invalid code. Please try again.');
    }
    if (errMsg.includes('PHONE_CODE_EXPIRED')) {
      pendingSessions.delete(normalizedPhone);
      try { await client.disconnect(); } catch (e) {}
      throw new Error('Code expired. Please request a new OTP.');
    }
    if (errMsg.includes('SESSION_PASSWORD_NEEDED')) {
      pendingSessions.delete(normalizedPhone);
      try { await client.disconnect(); } catch (e) {}
      return { success: true, message: 'Phone verified successfully (2FA account).' };
    }
    if (errMsg.includes('SESSION_REVOKE_NEEDED') || errMsg.includes('USER_DEACTIVATED')) {
      throw new Error('This phone number is no longer active on Telegram.');
    }
    throw new Error('Verification failed: ' + errMsg.substring(0, 100));
  }
};

const hasPendingSession = (phoneNumber) => {
  const normalizedPhone = normalizePhone(phoneNumber);
  return pendingSessions.has(normalizedPhone);
};

module.exports = { sendOTP, verifyOTP, hasPendingSession, normalizePhone, generateOTP };
