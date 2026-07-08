const mysql = require('mysql2/promise');

async function migrate() {
  const db = await mysql.createPool({ host: 'localhost', user: 'root', password: '', database: 'scholarship_system', charset: 'utf8mb4' });
  try {
    await db.query("INSERT INTO settings (setting_key, setting_value) VALUES ('enrollment_open', '0') ON DUPLICATE KEY UPDATE setting_value = setting_value");
    await db.query("INSERT INTO settings (setting_key, setting_value) VALUES ('enrollment_start', '') ON DUPLICATE KEY UPDATE setting_value = setting_value");
    await db.query("INSERT INTO settings (setting_key, setting_value) VALUES ('enrollment_end', '') ON DUPLICATE KEY UPDATE setting_value = setting_value");
    console.log('Migration done: enrollment settings added');
  } catch (err) {
    console.error('Migration error:', err.message);
  } finally {
    await db.end();
    process.exit(0);
  }
}

migrate();
