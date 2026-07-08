require('dotenv').config();
const mysql = require('mysql2/promise');

async function run() {
  const db = await mysql.createPool({
    host: process.env.DB_HOST || 'localhost',
    user: process.env.DB_USER || 'root',
    password: process.env.DB_PASSWORD || '',
    database: process.env.DB_NAME || 'scholarship_system',
    waitForConnections: true,
    connectionLimit: 1,
    queueLimit: 0
  });

  try {
    console.log('Connected to database. Reverting to email verification...');

    // Remove Telegram columns
    try { await db.query("ALTER TABLE users DROP COLUMN telegram_chat_id"); console.log('- Dropped telegram_chat_id'); } catch(e) {}
    try { await db.query("ALTER TABLE users DROP COLUMN otp_code"); console.log('- Dropped otp_code'); } catch(e) {}
    try { await db.query("ALTER TABLE users DROP COLUMN otp_expires_at"); console.log('- Dropped otp_expires_at'); } catch(e) {}
    try { await db.query("ALTER TABLE users DROP COLUMN otp_attempts"); console.log('- Dropped otp_attempts'); } catch(e) {}
    try { await db.query("ALTER TABLE users DROP COLUMN otp_last_sent_at"); console.log('- Dropped otp_last_sent_at'); } catch(e) {}

    // Restore verification_token and token_expires_at if they don't exist
    try { await db.query("ALTER TABLE users ADD COLUMN verification_token VARCHAR(255) NULL"); console.log('- Added verification_token'); } catch(e) {}
    try { await db.query("ALTER TABLE users ADD COLUMN token_expires_at DATETIME NULL"); console.log('- Added token_expires_at'); } catch(e) {}

    // Drop telegram_pending table
    try { await db.query("DROP TABLE IF EXISTS telegram_pending"); console.log('- Dropped telegram_pending table'); } catch(e) {}

    console.log('Reverted to email verification successfully!');
  } catch (err) {
    console.error('Migration error:', err.message);
  }

  await db.end();
  process.exit(0);
}

run();
