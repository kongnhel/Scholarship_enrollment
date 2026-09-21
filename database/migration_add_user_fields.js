const mysql = require('mysql2/promise');
require('dotenv').config();

async function migrate() {
  const connection = await mysql.createConnection({
    host: process.env.DB_HOST,
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    database: process.env.DB_NAME,
    port: process.env.DB_PORT || 3306,
    ssl: process.env.DB_SSL === 'true' ? { rejectUnauthorized: false } : false
  });

  try {
    console.log('Starting migration: Add user fields...');

    const addColumn = async (col, def) => {
      try {
        await connection.query(`ALTER TABLE users ADD COLUMN ${col} ${def}`);
        console.log(`Added ${col}`);
      } catch (e) {
        if (e.code === 'ER_DUP_FIELDNAME') console.log(`${col} already exists, skipping`);
        else throw e;
      }
    };

    await addColumn('national_id', "VARCHAR(100) AFTER english_name");
    await addColumn('gender', "ENUM('male', 'female') AFTER national_id");
    await addColumn('date_of_birth', "DATE AFTER gender");
    await addColumn('place_of_birth', "VARCHAR(255) AFTER date_of_birth");
    await addColumn('address', "TEXT AFTER place_of_birth");

    try {
      await connection.query('ALTER TABLE users ADD INDEX idx_users_national_id (national_id)');
      console.log('Added national_id index');
    } catch (e) {
      if (e.code === 'ER_DUP_KEYNAME') console.log('national_id index already exists, skipping');
      else throw e;
    }

    console.log('Migration completed successfully!');
  } catch (error) {
    console.error('Migration failed:', error.message);
    process.exit(1);
  } finally {
    await connection.end();
  }
}

migrate();
