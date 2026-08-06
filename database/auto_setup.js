require('dotenv').config();
const mysql = require('mysql2/promise');
const fs = require('fs');
const path = require('path');
const bcrypt = require('bcryptjs');

const dbConfig = {
  host: process.env.DB_HOST || 'localhost',
  port: parseInt(process.env.DB_PORT || '3306'),
  user: process.env.DB_USER || 'root',
  password: process.env.DB_PASSWORD || '',
  charset: 'utf8mb4'
};

const dbName = process.env.DB_NAME || 'scholarship_system';

async function safeQuery(conn, sql, params) {
  try {
    await conn.query(sql, params);
  } catch (err) {
    if ([
      'ER_DUP_FIELDNAME', 'ER_DUP_KEYNAME', 'ER_CANT_DROP_FIELD_OR_KEY',
      'ER_DUP_ENTRY', 'ER_BAD_FIELD_ERROR', 'ER_NO_SUCH_TABLE',
      'ER_TABLE_EXISTS_ERROR', 'ER_DUP_UNIQUE'
    ].includes(err.code)) {
      // safe to ignore
    } else {
      console.log('  WARN: ' + err.message.substring(0, 100));
    }
  }
}

async function tableExists(conn, tableName) {
  const [rows] = await conn.query(
    'SELECT COUNT(*) as cnt FROM information_schema.tables WHERE table_schema = ? AND table_name = ?',
    [dbName, tableName]
  );
  return rows[0].cnt > 0;
}

async function isTableEmpty(conn, tableName) {
  try {
    const [rows] = await conn.query(`SELECT COUNT(*) as cnt FROM ${tableName}`);
    return rows[0].cnt === 0;
  } catch {
    return true;
  }
}

async function autoSetup() {
  console.log('\n=== AUTO SETUP ===\n');

  // Step 1: Connect to MySQL (no database)
  let conn;
  try {
    conn = await mysql.createConnection(dbConfig);
    console.log('[1/4] Connected to MySQL');
  } catch (err) {
    console.error('ERROR: Cannot connect to MySQL. Is it running?');
    console.error('  ' + err.message);
    throw err;
  }

  // Step 2: Create database if not exists
  console.log('[2/4] Checking database...');
  const [dbs] = await conn.query('SHOW DATABASES LIKE ?', [dbName]);
  if (dbs.length === 0) {
    console.log('  Database "' + dbName + '" not found. Creating...');
    await conn.query(`CREATE DATABASE ${dbName} CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`);
    console.log('  Database created.');
  } else {
    console.log('  Database "' + dbName + '" exists.');
  }
  await conn.query('USE ' + dbName);
  await conn.query('SET NAMES utf8mb4');

  // Step 3: Check if tables exist
  console.log('[3/4] Checking tables...');
  const hasUsersTable = await tableExists(conn, 'users');

  if (hasUsersTable) {
    console.log('  Tables already exist. Checking for missing tables and migrations...');

    // Create missing tables from migration_enrollment_payment.sql
    await safeQuery(conn, `CREATE TABLE IF NOT EXISTS fee_types (
      id INT AUTO_INCREMENT PRIMARY KEY,
      name_kh VARCHAR(255) NOT NULL,
      name_en VARCHAR(255),
      amount DECIMAL(10,2) NOT NULL DEFAULT 0,
      description TEXT,
      is_active TINYINT DEFAULT 1,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      INDEX idx_fee_types_active (is_active)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`);

    await safeQuery(conn, `CREATE TABLE IF NOT EXISTS enrollments (
      id INT AUTO_INCREMENT PRIMARY KEY,
      user_id INT NOT NULL,
      application_id INT,
      academic_year VARCHAR(20) NOT NULL,
      semester VARCHAR(20) NOT NULL,
      status ENUM('pending','approved','rejected') DEFAULT 'pending',
      admin_notes TEXT,
      enrolled_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
      FOREIGN KEY (application_id) REFERENCES applications(id) ON DELETE SET NULL,
      INDEX idx_enrollments_user (user_id),
      INDEX idx_enrollments_status (status)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`);

    await safeQuery(conn, `CREATE TABLE IF NOT EXISTS payments (
      id INT AUTO_INCREMENT PRIMARY KEY,
      enrollment_id INT NOT NULL,
      user_id INT NOT NULL,
      fee_type_id INT NOT NULL,
      amount DECIMAL(10,2) NOT NULL,
      payment_method ENUM('bank_transfer','aba','acleda','wing','cash') DEFAULT 'bank_transfer',
      transaction_ref VARCHAR(255),
      proof_path VARCHAR(500),
      khqr_md5 VARCHAR(255),
      khqr_string TEXT,
      status ENUM('pending','verified','rejected') DEFAULT 'pending',
      admin_notes TEXT,
      verified_by INT,
      verified_at DATETIME,
      paid_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (enrollment_id) REFERENCES enrollments(id) ON DELETE CASCADE,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
      FOREIGN KEY (fee_type_id) REFERENCES fee_types(id) ON DELETE CASCADE,
      FOREIGN KEY (verified_by) REFERENCES users(id) ON DELETE SET NULL,
      INDEX idx_payments_user (user_id),
      INDEX idx_payments_enrollment (enrollment_id),
      INDEX idx_payments_status (status),
      INDEX idx_payments_khqr_md5 (khqr_md5)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`);

    await safeQuery(conn, `CREATE TABLE IF NOT EXISTS major_tuition (
      id INT AUTO_INCREMENT PRIMARY KEY,
      major_id INT NOT NULL,
      academic_year VARCHAR(20) NOT NULL,
      tuition_per_year DECIMAL(10,2) NOT NULL DEFAULT 0,
      is_active TINYINT DEFAULT 1,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      FOREIGN KEY (major_id) REFERENCES majors(id) ON DELETE CASCADE,
      UNIQUE KEY unique_major_year (major_id, academic_year),
      INDEX idx_major_tuition_active (is_active)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`);

    await safeQuery(conn, `CREATE TABLE IF NOT EXISTS telegram_pending (
      id INT AUTO_INCREMENT PRIMARY KEY,
      phone VARCHAR(20) NOT NULL,
      chat_id VARCHAR(100) NOT NULL,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      INDEX idx_telegram_pending_phone (phone)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`);

    // Run ALTER TABLE migrations for existing databases
    const existingDbMigrations = [
      // Username + OTP
      "ALTER TABLE users ADD COLUMN username VARCHAR(50) NULL AFTER english_name",
      "ALTER TABLE users ADD UNIQUE INDEX idx_users_username (username)",
      "ALTER TABLE users ADD COLUMN otp_code VARCHAR(10) NULL AFTER phone",
      "ALTER TABLE users ADD COLUMN otp_expires_at DATETIME NULL AFTER otp_code",
      "ALTER TABLE users ADD COLUMN otp_attempts INT DEFAULT 0 AFTER otp_expires_at",
      "ALTER TABLE users ADD COLUMN otp_last_sent_at DATETIME NULL AFTER otp_attempts",
      "ALTER TABLE users ADD COLUMN verify_method ENUM('email','telegram') DEFAULT 'email' AFTER otp_last_sent_at",
      "ALTER TABLE users ADD COLUMN telegram_chat_id VARCHAR(100) NULL AFTER phone",
      "ALTER TABLE users ADD COLUMN token_expires_at DATETIME AFTER verification_token",
      // Enrollment details columns
      "ALTER TABLE enrollments ADD COLUMN khmer_first_name VARCHAR(255) AFTER semester",
      "ALTER TABLE enrollments ADD COLUMN khmer_last_name VARCHAR(255) AFTER khmer_first_name",
      "ALTER TABLE enrollments ADD COLUMN english_first_name VARCHAR(255) AFTER khmer_last_name",
      "ALTER TABLE enrollments ADD COLUMN english_last_name VARCHAR(255) AFTER english_first_name",
      "ALTER TABLE enrollments ADD COLUMN gender ENUM('male','female') AFTER english_last_name",
      "ALTER TABLE enrollments ADD COLUMN date_of_birth DATE AFTER gender",
      "ALTER TABLE enrollments ADD COLUMN place_of_birth VARCHAR(255) AFTER date_of_birth",
      "ALTER TABLE enrollments ADD COLUMN phone VARCHAR(20) AFTER place_of_birth",
      "ALTER TABLE enrollments ADD COLUMN current_address TEXT AFTER phone",
      "ALTER TABLE enrollments ADD COLUMN province VARCHAR(100) AFTER current_address",
      "ALTER TABLE enrollments ADD COLUMN district VARCHAR(100) AFTER province",
      "ALTER TABLE enrollments ADD COLUMN commune VARCHAR(100) AFTER district",
      "ALTER TABLE enrollments ADD COLUMN parent_name VARCHAR(255) AFTER commune",
      "ALTER TABLE enrollments ADD COLUMN parent_phone VARCHAR(20) AFTER parent_name",
      "ALTER TABLE enrollments ADD COLUMN parent_relationship VARCHAR(50) AFTER parent_phone",
      "ALTER TABLE enrollments ADD COLUMN previous_school VARCHAR(255) AFTER parent_relationship",
      "ALTER TABLE enrollments ADD COLUMN previous_diploma VARCHAR(255) AFTER previous_school",
      "ALTER TABLE enrollments ADD COLUMN diploma_year INT AFTER previous_diploma",
      "ALTER TABLE enrollments ADD COLUMN major VARCHAR(255) AFTER diploma_year",
      "ALTER TABLE enrollments ADD COLUMN major_choice VARCHAR(255) AFTER major",
      "ALTER TABLE enrollments ADD COLUMN bank_name VARCHAR(100) AFTER major_choice",
      "ALTER TABLE enrollments ADD COLUMN bank_account_number VARCHAR(100) AFTER bank_name",
      "ALTER TABLE enrollments ADD COLUMN bank_account_name VARCHAR(255) AFTER bank_account_number",
      "ALTER TABLE enrollments ADD COLUMN photo_path VARCHAR(500) AFTER bank_account_name",
      "ALTER TABLE enrollments ADD COLUMN student_signature_date DATE AFTER photo_path",
      "ALTER TABLE enrollments ADD COLUMN parent_signature_date DATE AFTER student_signature_date",
      // Enrollment settings
      "ALTER TABLE settings ADD COLUMN enrollment_open VARCHAR(1) DEFAULT '0' AFTER registration_end",
      "ALTER TABLE settings ADD COLUMN enrollment_start DATETIME DEFAULT NULL AFTER enrollment_open",
      "ALTER TABLE settings ADD COLUMN enrollment_end DATETIME DEFAULT NULL AFTER enrollment_start",
      // Bakong KHQR columns (on payments)
      "ALTER TABLE payments ADD COLUMN khqr_md5 VARCHAR(255) AFTER proof_path",
      "ALTER TABLE payments ADD COLUMN khqr_string TEXT AFTER khqr_md5",
      "ALTER TABLE payments MODIFY COLUMN payment_method ENUM('bank_transfer','aba','acleda','wing','cash','bakong_khqr') DEFAULT 'bakong_khqr'",
    ];
    for (const sql of existingDbMigrations) {
      await safeQuery(conn, sql);
    }

    console.log('  All missing tables and migrations applied.');

    // Seed fee types if empty
    if (await isTableEmpty(conn, 'fee_types')) {
      const feeTypes = [
        ['ថ្លៃសៀវភៅសិក្សា', 'Study Book Fee', 5000, 'ថ្លៃសៀវភៅសិក្សា (សៀវភៅកត់ត្រា)', 1],
        ['ថ្លៃប័ណ្ណសម្គាល់អត្តសញ្ញាណ ឬសំបុត្រកំណើត', 'ID Card or Birth Certificate Fee', 5000, 'ថ្លៃសម្គាល់អត្តសញ្ញាណប័ណ្ណ ឬសំបុត្រកំណើត', 1],
        ['ថ្លៃរូបថត', 'Photo Fee', 5000, 'ថ្លៃរូបថត ៤×៦', 1],
        ['ថ្លៃការងារស្រាវជ្រាវ', 'Research Work Fee', 5000, 'ថ្លៃការងារស្រាវជ្រាវសិក្សា', 1],
        ['ថ្លៃប័ណ្ណសម្គាល់សិស្ស ឆ្នាំទី ១', 'Student ID Card Fee (Year 1)', 5000, 'ថ្លៃប័ណ្ណសម្គាល់សិស្ស (ឆ្នាំទី ១ សាលាក្រុង សាលាខេត្ត)', 1],
        ['ថ្លៃប័ណ្ណសម្គាល់សិស្ស ឆ្នាំទី ២', 'Student ID Card Fee (Year 2)', 5000, 'ថ្លៃប័ណ្ណសម្គាល់សិស្ស (ឆ្នាំទី ២ សាលាខេត្ត សាលាខេត្ត)', 1],
        ['ថ្លៃសិក្សា', 'Tuition Fee', 500000, 'ថ្លៃសិក្សាមួយឆ្នាំសម្រាប់និស្សិតអាហារូបករណ៍', 1]
      ];
      for (const [nkh, nen, amt, desc, active] of feeTypes) {
        await safeQuery(conn, 'INSERT IGNORE INTO fee_types (name_kh, name_en, amount, description, is_active) VALUES (?, ?, ?, ?, ?)', [nkh, nen, amt, desc, active]);
      }
      console.log('    Seeded ' + feeTypes.length + ' fee types');
    }

    await conn.end();
    console.log('=== SETUP COMPLETE (already configured) ===\n');
    return;
  }

  console.log('  No tables found. Running full setup...\n');

  // Step 4: Full setup
  console.log('[4/4] Setting up database...');

  // 4a. Run schema.sql
  console.log('  [a] Creating tables from schema.sql...');
  const schema = fs.readFileSync(path.join(__dirname, 'schema.sql'), 'utf8');
  // Remove the CREATE DATABASE and USE lines (we already handled those)
  const cleanedSchema = schema
    .replace(/CREATE DATABASE[^;]+;/gi, '')
    .replace(/USE [^;]+;/gi, '');
  const statements = cleanedSchema.split(';').map(s => s.trim()).filter(s => s && !s.startsWith('--'));
  for (const stmt of statements) {
    if (!stmt) continue;
    try {
      await conn.query(stmt);
    } catch (e) {
      if (!e.message.includes('Duplicate') && !e.message.includes('already exists')) {
        console.log('    WARN: ' + e.message.substring(0, 80));
      }
    }
  }
  console.log('    Tables created.');

  // 4b. Run migrations
  console.log('  [b] Running migrations...');
  const migrations = [
    // Username + OTP
    "ALTER TABLE users ADD COLUMN username VARCHAR(50) NULL AFTER english_name",
    "ALTER TABLE users ADD UNIQUE INDEX idx_users_username (username)",
    "ALTER TABLE users ADD COLUMN otp_code VARCHAR(10) NULL AFTER phone",
    "ALTER TABLE users ADD COLUMN otp_expires_at DATETIME NULL AFTER otp_code",
    "ALTER TABLE users ADD COLUMN otp_attempts INT DEFAULT 0 AFTER otp_expires_at",
    "ALTER TABLE users ADD COLUMN otp_last_sent_at DATETIME NULL AFTER otp_attempts",
    "ALTER TABLE users ADD COLUMN verify_method ENUM('email','telegram') DEFAULT 'email' AFTER otp_last_sent_at",
    // Telegram
    "ALTER TABLE users ADD COLUMN telegram_chat_id VARCHAR(100) NULL AFTER phone",
    // Token expires
    "ALTER TABLE users ADD COLUMN token_expires_at DATETIME AFTER verification_token",
    // Telegram pending table
    `CREATE TABLE IF NOT EXISTS telegram_pending (
      id INT AUTO_INCREMENT PRIMARY KEY,
      phone VARCHAR(20) NOT NULL,
      chat_id VARCHAR(100) NOT NULL,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      INDEX idx_telegram_pending_phone (phone)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`,
    // Enrollment details columns
    "ALTER TABLE enrollments ADD COLUMN khmer_first_name VARCHAR(255) AFTER semester",
    "ALTER TABLE enrollments ADD COLUMN khmer_last_name VARCHAR(255) AFTER khmer_first_name",
    "ALTER TABLE enrollments ADD COLUMN english_first_name VARCHAR(255) AFTER khmer_last_name",
    "ALTER TABLE enrollments ADD COLUMN english_last_name VARCHAR(255) AFTER english_first_name",
    "ALTER TABLE enrollments ADD COLUMN gender ENUM('male','female') AFTER english_last_name",
    "ALTER TABLE enrollments ADD COLUMN date_of_birth DATE AFTER gender",
    "ALTER TABLE enrollments ADD COLUMN place_of_birth VARCHAR(255) AFTER date_of_birth",
    "ALTER TABLE enrollments ADD COLUMN phone VARCHAR(20) AFTER place_of_birth",
    "ALTER TABLE enrollments ADD COLUMN current_address TEXT AFTER phone",
    "ALTER TABLE enrollments ADD COLUMN province VARCHAR(100) AFTER current_address",
    "ALTER TABLE enrollments ADD COLUMN district VARCHAR(100) AFTER province",
    "ALTER TABLE enrollments ADD COLUMN commune VARCHAR(100) AFTER district",
    "ALTER TABLE enrollments ADD COLUMN parent_name VARCHAR(255) AFTER commune",
    "ALTER TABLE enrollments ADD COLUMN parent_phone VARCHAR(20) AFTER parent_name",
    "ALTER TABLE enrollments ADD COLUMN parent_relationship VARCHAR(50) AFTER parent_phone",
    "ALTER TABLE enrollments ADD COLUMN previous_school VARCHAR(255) AFTER parent_relationship",
    "ALTER TABLE enrollments ADD COLUMN previous_diploma VARCHAR(255) AFTER previous_school",
    "ALTER TABLE enrollments ADD COLUMN diploma_year INT AFTER previous_diploma",
    "ALTER TABLE enrollments ADD COLUMN major VARCHAR(255) AFTER diploma_year",
    "ALTER TABLE enrollments ADD COLUMN major_choice VARCHAR(255) AFTER major",
    "ALTER TABLE enrollments ADD COLUMN bank_name VARCHAR(100) AFTER major_choice",
    "ALTER TABLE enrollments ADD COLUMN bank_account_number VARCHAR(100) AFTER bank_name",
    "ALTER TABLE enrollments ADD COLUMN bank_account_name VARCHAR(255) AFTER bank_account_number",
    "ALTER TABLE enrollments ADD COLUMN photo_path VARCHAR(500) AFTER bank_account_name",
    "ALTER TABLE enrollments ADD COLUMN student_signature_date DATE AFTER photo_path",
    "ALTER TABLE enrollments ADD COLUMN parent_signature_date DATE AFTER student_signature_date",
    // Enrollment settings
    "ALTER TABLE settings ADD COLUMN enrollment_open VARCHAR(1) DEFAULT '0' AFTER registration_end",
    "ALTER TABLE settings ADD COLUMN enrollment_start DATETIME DEFAULT NULL AFTER enrollment_open",
    "ALTER TABLE settings ADD COLUMN enrollment_end DATETIME DEFAULT NULL AFTER enrollment_start",
    // Bakong KHQR columns
    "ALTER TABLE payments ADD COLUMN khqr_md5 VARCHAR(255) AFTER proof_path",
    "ALTER TABLE payments ADD COLUMN khqr_string TEXT AFTER khqr_md5",
    "ALTER TABLE payments MODIFY COLUMN payment_method ENUM('bank_transfer','aba','acleda','wing','cash','bakong_khqr') DEFAULT 'bakong_khqr'",
    "CREATE INDEX idx_payments_khqr_md5 ON payments(khqr_md5)",
    // Major tuition table
    `CREATE TABLE IF NOT EXISTS major_tuition (
      id INT AUTO_INCREMENT PRIMARY KEY,
      major_id INT NOT NULL,
      academic_year VARCHAR(20) NOT NULL,
      tuition_per_year DECIMAL(10,2) NOT NULL DEFAULT 0,
      is_active TINYINT DEFAULT 1,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      FOREIGN KEY (major_id) REFERENCES majors(id) ON DELETE CASCADE,
      UNIQUE KEY unique_major_year (major_id, academic_year),
      INDEX idx_major_tuition_active (is_active)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`,
  ];
  for (const sql of migrations) {
    await safeQuery(conn, sql);
  }
  console.log('    Migrations complete.');

  // 4c. Seed data
  console.log('  [c] Seeding data...');

  // Seed provinces
  if (await isTableEmpty(conn, 'provinces')) {
    const provinces = [
      ['ភ្នំពេញ','Phnom Penh'],['សៀមរាប','Siem Reap'],['បាត់ដំបង','Battambang'],
      ['កំពង់ចាម','Kampong Cham'],['កំពង់ឆ្នាំង','Kampong Chhnang'],['កំពង់ស្ពឺ','Kampong Speu'],
      ['កំពង់ថម','Kampong Thom'],['កំពត','Kampot'],['កណ្តាល','Kandal'],['កោះកុង','Koh Kong'],
      ['ក្រចេះ','Kratie'],['មណ្ឌលគីរី','Mondulkiri'],['ឧត្តរមានជ័យ','Oddar Meanchey'],
      ['ព្រះវិហារ','Preah Vihear'],['ព្រះសីហនុ','Preah Sihanouk'],['ព្រៃវែង','Prey Veng'],
      ['ពោធិ៍សាត់','Pursat'],['រតនគីរី','Ratanak Kiri'],['ស្ទឹងត្រែង','Stung Treng'],
      ['ស្វាយរៀង','Svay Rieng'],['តាកែវ','Takeo'],['ត្បូងឃ្មុំ','Tboung Khmum']
    ];
    for (const [kh, en] of provinces) {
      await conn.query('INSERT INTO provinces (name_kh, name_en) VALUES (?, ?)', [kh, en]);
    }
    console.log('    ' + provinces.length + ' provinces');
  }

  // Seed majors
  if (await isTableEmpty(conn, 'majors')) {
    const majors = [
      ['វិទ្យាសាស្ត្រកុំព្យូទ័រ','Computer Science','សាកលវិទ្យាល័យវិទ្យាសាស្ត្រ និងបច្ចេកវិទ្យា','Faculty of Science and Technology'],
      ['វិស្វកម្មកុំព្យូទ័រ','Computer Engineering','សាកលវិទ្យាល័យវិទ្យាសាស្ត្រ និងបច្ចេកវិទ្យា','Faculty of Science and Technology'],
      ['រដ្ឋបាលធុរកិច្ច','Business Administration','សាកលវិទ្យាល័យធុរកិច្ច និងសេដ្ឋកិច្ច','Faculty of Business and Economics'],
      ['គណនេយ្យ','Accounting','សាកលវិទ្យាល័យធុរកិច្ច និងសេដ្ឋកិច្ច','Faculty of Business and Economics'],
      ['សេដ្ឋកិច្ច','Economics','សាកលវិទ្យាល័យធុរកិច្ច និងសេដ្ឋកិច្ច','Faculty of Business and Economics'],
      ['អក្សរសាស្ត្រអង់គ្លេស','English Literature','សាកលវិទ្យាល័យអក្សរសាស្ត្រ និងមនុស្សសាស្ត្រ','Faculty of Arts and Humanities'],
      ['អក្សរសាស្ត្រខ្មែរ','Khmer Literature','សាកលវិទ្យាល័យអក្សរសាស្ត្រ និងមនុស្សសាស្ត្រ','Faculty of Arts and Humanities'],
      ['អភិបាលកិច្ចសាធារណៈ','Public Administration','សាកលវិទ្យាល័យនយោបាយ និងរដ្ឋបាលសាធារណៈ','Faculty of Politics and Public Administration'],
      ['ច្បាប់','Law','សាកលវិទ្យាល័យនយោបាយ និងរដ្ឋបាលសាធារណៈ','Faculty of Politics and Public Administration'],
      ['គ្រប់គ្រងធនធានមនុស្ស','Human Resource Management','សាកលវិទ្យាល័យធុរកិច្ច និងសេដ្ឋកិច្ច','Faculty of Business and Economics'],
      ['ទំនាក់ទំនងអន្តរជាតិ','International Relations','សាកលវិទ្យាល័យនយោបាយ និងរដ្ឋបាលសាធារណៈ','Faculty of Politics and Public Administration'],
      ['អប់រំ','Education','សាកលវិទ្យាល័យអប់រំ','Faculty of Education']
    ];
    for (const [nkh, nen, fkh, fen] of majors) {
      await conn.query('INSERT INTO majors (name_kh, name_en, faculty_kh, faculty_en) VALUES (?, ?, ?, ?)', [nkh, nen, fkh, fen]);
    }
    console.log('    ' + majors.length + ' majors');
  }

  // Seed scholarship categories
  if (await isTableEmpty(conn, 'scholarship_categories')) {
    const categories = [
      ['អាហារូបករណ៍ពេញ','Full Scholarship','ទទួលបានអាហារូបករណ៍ពេញដែលរួមបញ្ចូលថ្លៃសិក្សា និងថ្លៃផ្សេងៗ','Full scholarship covering tuition fees and other expenses'],
      ['អាហារូបករណ៍មួយចំនួន','Partial Scholarship','ទទួលបានអាហារូបករណ៍មួយចំនួនសម្រាប់ថ្លៃសិក្សា','Partial scholarship for tuition fees'],
      ['អាហារូបករណ៍សិស្សក្រីក្រ','Poor Family Scholarship (Financial Hardship)','សម្រាប់សិស្សដែលមានជីវភាពខ្វះខាត','For students from economically disadvantaged families'],
      ['អាហារូបករណ៍សមត្ថភាពសិក្សាល្អ','Outstanding Academic Achievement Scholarship','សម្រាប់សិស្សដែលមានលទ្ធផលសិក្សាល្អប្រសើរ','For students with excellent academic performance'],
      ['អាហារូបករណ៍សិស្សស្រី','Female Student Scholarship','សម្រាប់សិស្សស្រីដែលមានសមត្ថភាព','For female students with outstanding abilities'],
      ['អាហារូបករណ៍សិស្សពិការ','Scholarship for Students with Disabilities','សម្រាប់សិស្សដែលមានពិការភាព','For students with disabilities'],
      ['អាហារូបករណ៍ផ្សេងៗ','Other Categories','ប្រភេទអាហារូបករណ៍ផ្សេងៗដែលកំណត់ដោយសាកលវិទ្យាល័យ','Other scholarship categories as defined by the university']
    ];
    for (const [nkh, nen, dkh, den] of categories) {
      await conn.query('INSERT INTO scholarship_categories (name_kh, name_en, description_kh, description_en) VALUES (?, ?, ?, ?)', [nkh, nen, dkh, den]);
    }
    console.log('    ' + categories.length + ' scholarship categories');
  }

  // Seed scholarship types
  if (await isTableEmpty(conn, 'scholarship_types')) {
    const scholarshipTypes = [
      ['អាហារូបករណ៍៤០% សិក្សារយៈពេល៤ឆ្នាំ របស់អង្គការកុមារមេគង្គកម្ពុជា','40% Scholarship for 4 Years - Mekong Child Organization',40,4,'អង្គការកុមារមេគង្គកម្ពុជា','អាហារូបករណ៍៤០% សម្រាប់សិស្សដែលមានលទ្ធផលសិក្សាល្អ',0],
      ['អាហារូបករណ៍៥០% សិក្សារយៈពេល២ឆ្នាំ របស់សាកលវិទ្យាល័យជាតិមានជ័យ','50% Scholarship for 2 Years - NMU',50,2,'សាកលវិទ្យាល័យជាតិមានជ័យ','អាហារូបករណ៍៥០% សម្រាប់និស្សិតសាកលវិទ្យាល័យជាតិមានជ័យ',0],
      ['អាហារូបករណ៍១០០% សិក្សារយៈពេល៤ឆ្នាំ របស់រដ្ឋាភិបាល','100% Full Scholarship for 4 Years - Government',100,4,'រដ្ឋាភិបាលកម្ពុជា','អាហារូបករណ៍ពេញ១០០% សម្រាប់សិស្សពូកែ',0]
    ];
    for (const [nkh, nen, cov, dur, prov, desc, mfee] of scholarshipTypes) {
      await conn.query('INSERT INTO scholarship_types (name_kh, name_en, coverage_percentage, duration_years, provider_name, description, ministry_fee) VALUES (?, ?, ?, ?, ?, ?, ?)', [nkh, nen, cov, dur, prov, desc, mfee]);
    }
    console.log('    ' + scholarshipTypes.length + ' scholarship types');
  }

  // Seed fee types
  if (await isTableEmpty(conn, 'fee_types')) {
    const feeTypes = [
      ['ថ្លៃសៀវភៅសិក្សា', 'Study Book Fee', 5000, 'ថ្លៃសៀវភៅសិក្សា (សៀវភៅកត់ត្រា)', 1],
      ['ថ្លៃប័ណ្ណសម្គាល់អត្តសញ្ញាណ ឬសំបុត្រកំណើត', 'ID Card or Birth Certificate Fee', 5000, 'ថ្លៃសម្គាល់អត្តសញ្ញាណប័ណ្ណ ឬសំបុត្រកំណើត', 1],
      ['ថ្លៃរូបថត', 'Photo Fee', 5000, 'ថ្លៃរូបថត ៤×៦', 1],
      ['ថ្លៃការងារស្រាវជ្រាវ', 'Research Work Fee', 5000, 'ថ្លៃការងារស្រាវជ្រាវសិក្សា', 1],
      ['ថ្លៃប័ណ្ណសម្គាល់សិស្ស ឆ្នាំទី ១', 'Student ID Card Fee (Year 1)', 5000, 'ថ្លៃប័ណ្ណសម្គាល់សិស្ស (ឆ្នាំទី ១ សាលាក្រុង សាលាខេត្ត)', 1],
      ['ថ្លៃប័ណ្ណសម្គាល់សិស្ស ឆ្នាំទី ២', 'Student ID Card Fee (Year 2)', 5000, 'ថ្លៃប័ណ្ណសម្គាល់សិស្ស (ឆ្នាំទី ២ សាលាខេត្ត សាលាខេត្ត)', 1],
      ['ថ្លៃសិក្សា', 'Tuition Fee', 500000, 'ថ្លៃសិក្សាមួយឆ្នាំសម្រាប់និស្សិតអាហារូបករណ៍', 1]
    ];
    for (const [nkh, nen, amt, desc, active] of feeTypes) {
      await conn.query('INSERT INTO fee_types (name_kh, name_en, amount, description, is_active) VALUES (?, ?, ?, ?, ?)', [nkh, nen, amt, desc, active]);
    }
    console.log('    ' + feeTypes.length + ' fee types');
  }

  // Seed users (admin + committee + students)
  if (await isTableEmpty(conn, 'users')) {
    const adminHash = await bcrypt.hash('admin123', 12);
    const committeeHash = await bcrypt.hash('committee123', 12);
    const studentHash = await bcrypt.hash('123456', 12);

    await conn.query('INSERT INTO users (email, password, role, khmer_name, english_name, username, is_verified) VALUES (?, ?, ?, ?, ?, ?, ?)',
      ['admin@nmu.edu.kh', adminHash, 'admin', 'អ្នកគ្រប់គ្រង', 'Administrator', 'admin', 1]);
    await conn.query('INSERT INTO users (email, password, role, khmer_name, english_name, username, is_verified) VALUES (?, ?, ?, ?, ?, ?, ?)',
      ['committee@nmu.edu.kh', committeeHash, 'committee', 'គណៈកម្មការ', 'Committee Member', null, 1]);

    const students = [
      {kh:'សុខ វណ្ណា',en:'Sok Vannak',un:'sok_vannak',ph:'012345001'},
      {kh:'ចាន់ សុវណ្ណ',en:'Chan Sovann',un:'chan_sovann',ph:'012345002'},
      {kh:'គង់ សុភ័ក្ត្រ',en:'Kong Sopheak',un:'kong_sopheak',ph:'012345003'},
      {kh:'ប៉ុន ចំរើន',en:'Pov Chamroeun',un:'pov_chamroeun',ph:'012345004'},
      {kh:'ម៉ៅ គុយ',en:'Mao Koeuy',un:'mao_koeuy',ph:'012345005'},
      {kh:'រិទ្ធ វ៉ាន់',en:'Rith Van',un:'rith_van',ph:'012345006'},
      {kh:'វិច្ឆិកា ផល',en:'Vicheka Pich',un:'vicheka_pich',ph:'012345007'},
      {kh:'ស្រី សុខ',en:'Srey Sok',un:'srey_sok',ph:'012345008'},
      {kh:'លី ចាន់',en:'Ly Chan',un:'ly_chan',ph:'012345009'},
      {kh:'ថាច រ៉េន',en:'Chhay Rien',un:'chhay_rien',ph:'012345010'}
    ];
    for (const s of students) {
      await conn.query('INSERT INTO users (khmer_name, english_name, username, email, phone, password, role, is_verified) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
        [s.kh, s.en, s.un, s.un + '@test.com', s.ph, studentHash, 'student', 1]);
    }
    console.log('    2 admin/committee users + ' + students.length + ' students');
  }

  // Seed settings
  if (await isTableEmpty(conn, 'settings')) {
    await conn.query("INSERT INTO settings (setting_key, setting_value, description) VALUES ('registration_open', '1', 'Enable or disable student registration')");
    await conn.query("INSERT INTO settings (setting_key, setting_value, description) VALUES ('registration_start', '2026-06-01 00:00:00', 'Registration start date and time')");
    await conn.query("INSERT INTO settings (setting_key, setting_value, description) VALUES ('registration_end', '2026-08-31 23:59:59', 'Registration end date and time')");
    await conn.query("INSERT INTO settings (setting_key, setting_value, description) VALUES ('enrollment_open', '1', 'Enable or disable student enrollment')");
    await conn.query("INSERT INTO settings (setting_key, setting_value, description) VALUES ('scholarship_open', '1', 'Enable or disable scholarship applications')");
    console.log('    Default settings');
  }

  await conn.end();
  console.log('\n=== SETUP COMPLETE ===');
  console.log('Admin login:     admin@nmu.edu.kh / admin123');
  console.log('Student login:   sok_vannak@test.com / 123456');
  console.log('');
}

module.exports = autoSetup;
