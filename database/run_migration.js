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
    console.log('Connected to database. Running migration...');

    // Add Telegram and OTP columns
    await db.query("ALTER TABLE users ADD COLUMN telegram_chat_id VARCHAR(100) NULL AFTER phone");
    console.log('- Added telegram_chat_id column');

    await db.query("ALTER TABLE users ADD COLUMN otp_code VARCHAR(10) NULL AFTER telegram_chat_id");
    console.log('- Added otp_code column');

    await db.query("ALTER TABLE users ADD COLUMN otp_expires_at DATETIME NULL AFTER otp_code");
    console.log('- Added otp_expires_at column');

    await db.query("ALTER TABLE users ADD COLUMN otp_attempts INT DEFAULT 0 AFTER otp_expires_at");
    console.log('- Added otp_attempts column');

    await db.query("ALTER TABLE users ADD COLUMN otp_last_sent_at DATETIME NULL AFTER otp_attempts");
    console.log('- Added otp_last_sent_at column');

    // Create pending Telegram sessions table
    await db.query(`
      CREATE TABLE IF NOT EXISTS telegram_pending (
        id INT AUTO_INCREMENT PRIMARY KEY,
        phone VARCHAR(20) NOT NULL,
        chat_id VARCHAR(100) NOT NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        INDEX idx_telegram_pending_phone (phone)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
    `);
    console.log('- Created telegram_pending table');

    console.log('Migration completed successfully!');
  } catch (err) {
    console.error('Migration error:', err.message);
    // Some columns may already exist, which is fine
    console.log('Migration may have partially completed. Check errors above.');
  }

  await db.end();
  process.exit(0);
}

run();
