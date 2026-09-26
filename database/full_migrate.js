require('dotenv').config();
const mysql = require('mysql2/promise');
const fs = require('fs');
const path = require('path');

const dbConfig = {
  host: process.env.DB_HOST || 'localhost',
  user: process.env.DB_USER || 'root',
  password: process.env.DB_PASSWORD || '',
  charset: 'utf8mb4'
};

const dbName = process.env.DB_NAME || 'scholarship_system';

async function safeQuery(conn, sql) {
  try {
    await conn.query(sql);
  } catch (err) {
    if (err.code === 'ER_DUP_FIELDNAME' || err.code === 'ER_DUP_KEYNAME' || err.code === 'ER_CANT_DROP_FIELD_OR_KEY') {
      // skip
    } else if (err.code === 'ER_BAD_FIELD_ERROR' || err.code === 'ER_NO_SUCH_TABLE') {
      // skip
    } else {
      console.log('  WARN: ' + err.message.substring(0, 80));
    }
  }
}

async function migrate() {
  console.log('=== DATABASE MIGRATION & SEED ===\n');

  // 1. Drop and recreate database
  const conn = await mysql.createConnection(dbConfig);
  console.log('[1/6] Dropping and recreating database...');
  await conn.query('DROP DATABASE IF EXISTS ' + dbName);
  await conn.query('CREATE DATABASE ' + dbName + ' CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci');
  await conn.query('USE ' + dbName);
  await conn.query('SET NAMES utf8mb4');
  console.log('  Done.\n');

  // 2. Run schema.sql
  console.log('[2/6] Creating tables from schema.sql...');
  const schema = fs.readFileSync(path.join(__dirname, 'schema.sql'), 'utf8');
  const statements = schema.split(';').map(s => s.trim()).filter(s => s && !s.startsWith('--'));
  for (const stmt of statements) {
    if (stmt.toUpperCase().startsWith('USE ') || stmt.toUpperCase().startsWith('SET ')) {
      await conn.query(stmt);
    } else {
      try { await conn.query(stmt); } catch (e) {
        if (!e.message.includes('Duplicate')) console.log('  WARN: ' + e.message.substring(0, 80));
      }
    }
  }
  console.log('  Done.\n');

  // 3. Add migration columns (safe)
  console.log('[3/6] Running migrations...');
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
    // Scholarship types table
    `CREATE TABLE IF NOT EXISTS scholarship_types (
      id INT AUTO_INCREMENT PRIMARY KEY,
      name_kh VARCHAR(500) NOT NULL,
      name_en VARCHAR(500),
      coverage_percentage INT NOT NULL DEFAULT 0,
      duration_years INT NOT NULL DEFAULT 1,
      provider_name VARCHAR(500) NOT NULL,
      description TEXT,
      ministry_fee DECIMAL(10,2) DEFAULT 0,
      is_active TINYINT DEFAULT 1,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      INDEX idx_scholarship_types_active (is_active)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`,
    // Telegram pending table
    `CREATE TABLE IF NOT EXISTS telegram_pending (
      id INT AUTO_INCREMENT PRIMARY KEY,
      phone VARCHAR(20) NOT NULL,
      chat_id VARCHAR(100) NOT NULL,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      INDEX idx_telegram_pending_phone (phone)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`,
    // Scholarship type FK on applications
    "ALTER TABLE applications ADD COLUMN scholarship_type_id INT NULL AFTER scholarship_category_id",
  ];
  for (const sql of migrations) {
    await safeQuery(conn, sql);
  }
  console.log('  Done.\n');

  // 4. Seed data
  console.log('[4/6] Seeding provinces, majors, categories, scholarship_types...');

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
  console.log('  ' + provinces.length + ' provinces');

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
  console.log('  ' + majors.length + ' majors');

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
  console.log('  ' + categories.length + ' categories');

  const scholarshipTypes = [
    ['អាហារូបករណ៍ ៤០% សម្រាប់រយៈពេល ៤ ឆ្នាំ - សាកលវិទ្យាល័យជាតិមានជ័យ','40% Scholarship for 4 Years - National Meanchey University',40,4,'សាកលវិទ្យាល័យជាតិមានជ័យ','អាហារូបករណ៍ ៤០% សម្រាប់រយៈពេល ៤ ឆ្នាំ ផ្តល់ដោយសាកលវិទ្យាល័យជាតិមានជ័យ',0],
    ['អាហារូបករណ៍ ៥០% សម្រាប់រយៈពេល ២ ឆ្នាំ - សាកលវិទ្យាល័យជាតិមានជ័យ','50% Scholarship for 2 Years - National Meanchey University',50,2,'សាកលវិទ្យាល័យជាតិមានជ័យ','អាហារូបករណ៍ ៥០% សម្រាប់រយៈពេល ២ ឆ្នាំ ផ្តល់ដោយសាកលវិទ្យាល័យជាតិមានជ័យ',0],
    ['អាហារូបករណ៍ ១០០% សម្រាប់រយៈពេល ៤ ឆ្នាំ - សាកលវិទ្យាល័យជាតិមានជ័យ','100% Full Scholarship for 4 Years - National Meanchey University',100,4,'សាកលវិទ្យាល័យជាតិមានជ័យ','អាហារូបករណ៍ពេញ ១០០% សម្រាប់រយៈពេល ៤ ឆ្នាំ ផ្តល់ដោយសាកលវិទ្យាល័យជាតិមានជ័យ',0]
  ];
  for (const [nkh, nen, cov, dur, prov, desc, mfee] of scholarshipTypes) {
    await conn.query('INSERT INTO scholarship_types (name_kh, name_en, coverage_percentage, duration_years, provider_name, description, ministry_fee) VALUES (?, ?, ?, ?, ?, ?, ?)', [nkh, nen, cov, dur, prov, desc, mfee]);
  }
  console.log('  ' + scholarshipTypes.length + ' scholarship types');

  // 5. Seed users
  console.log('\n[5/6] Seeding users...');
  const bcrypt = require('bcryptjs');
  const adminHash = await bcrypt.hash('admin123', 12);
  const committeeHash = await bcrypt.hash('committee123', 12);
  const studentHash = await bcrypt.hash('123456', 12);

  await conn.query('INSERT INTO users (email, password, role, khmer_name, english_name, username, is_verified) VALUES (?, ?, ?, ?, ?, ?, ?)',
    ['admin@nmu.edu.kh', adminHash, 'admin', 'អ្នកគ្រប់គ្រង', 'Administrator', 'admin', 1]);
  await conn.query('INSERT INTO users (email, password, role, khmer_name, english_name, username, is_verified) VALUES (?, ?, ?, ?, ?, ?, ?)',
    ['committee@nmu.edu.kh', committeeHash, 'committee', 'គណៈកម្មការ', 'Committee Member', null, 1]);
  console.log('  admin@nmu.edu.kh (admin123)');
  console.log('  committee@nmu.edu.kh (committee123)');

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
  console.log('  ' + students.length + ' students (password: 123456)');

  // 6. Seed applications
  console.log('\n[6/6] Seeding applications...');
  const [users] = await conn.query('SELECT id FROM users WHERE role = ? ORDER BY id LIMIT 10', ['student']);
  const statuses = ['pending', 'under_review', 'approved', 'rejected'];
  const weights = [0.3, 0.3, 0.2, 0.2];
  const kF = ['សុខ','ចាន់','គង់','ប៉ុន','ម៉ៅ','រិទ្ធ','វិច្ឆិកា','ស្រី','លី','ថាច'];
  const kL = ['វណ្ណា','សុវណ្ណ','សុភ័ក្ត្រ','ចំរើន','គុយ','វ៉ាន់','ផល','សុខ','ចាន់','រ៉េន'];
  const eF = ['Sokha','Chantha','Kong','Pov','Mao','Rith','Vicheka','Srey','Ly','Chhay'];
  const eL = ['Vannak','Sovann','Sopheak','Chamroeun','Koeuy','Van','Pich','Sok','Chan','Rien'];
  const schoolNames = ['វិទ្យាល័យព្រះសីហនុ','វិទ្យាល័យឥន្ទ្រពេជ្រ','វិទ្យាល័យស្វាយរៀង','វិទ្យាល័យបាត់ដំបង'];

  function wr(items, wt) {
    const t = wt.reduce((a, b) => a + b, 0);
    let r = Math.random() * t;
    for (let i = 0; i < items.length; i++) { r -= wt[i]; if (r <= 0) return items[i]; }
    return items[items.length - 1];
  }
  function pick(arr) { return arr[Math.floor(Math.random() * arr.length)]; }

  // Get current max IDs for FK references
  const [majIds] = await conn.query('SELECT id FROM majors');
  const [catIds] = await conn.query('SELECT id FROM scholarship_categories');
  const [stIds] = await conn.query('SELECT id FROM scholarship_types');
  const majorIds = majIds.map(m => m.id);
  const catIdArr = catIds.map(c => c.id);
  const stIdArr = stIds.map(s => s.id);

  let appCount = 0;
  for (let i = 0; i < users.length; i++) {
    const u = users[i];
    const st = wr(statuses, weights);
    const month = String(Math.floor(Math.random() * 12) + 1).padStart(2, '0');
    const day = String(Math.floor(Math.random() * 28) + 1).padStart(2, '0');
    const dob = (1998 + Math.floor(Math.random() * 7)) + '-' + month + '-' + day;
    const phone = '012' + String(Math.floor(100000 + Math.random() * 900000));
    const addr = 'ភូមិព្រៃទទឹង, ស្រុកកំពង់ត្របែក, ខេត្តព្រៃវែង';
    const subDate = new Date(2024, Math.floor(Math.random() * 12), Math.floor(Math.random() * 28) + 1);

    await conn.query(
      `INSERT INTO applications (user_id, status, khmer_first_name, khmer_last_name, english_first_name, english_last_name,
        gender, date_of_birth, nationality, current_address, phone, email, school_name,
        graduation_year, major_first_choice_id, major_second_choice_id, scholarship_category_id, scholarship_type_id, submitted_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [u.id, st, kF[i], kL[i], eF[i], eL[i],
        Math.random() > 0.5 ? 'male' : 'female', dob, 'Cambodian',
        addr, phone,
        'student' + u.id + '@gmail.com', pick(schoolNames), 2024,
        pick(majorIds), pick(majorIds), pick(catIdArr), pick(stIdArr), subDate]
    );
    appCount++;
  }
  console.log('  ' + appCount + ' applications');

  // 7. Seed settings
  await conn.query("INSERT INTO settings (setting_key, setting_value, description) VALUES ('registration_open', '1', 'Enable or disable student registration')");
  await conn.query("INSERT INTO settings (setting_key, setting_value, description) VALUES ('registration_start', '2026-06-01 00:00:00', 'Registration start date and time')");
  await conn.query("INSERT INTO settings (setting_key, setting_value, description) VALUES ('registration_end', '2026-08-31 23:59:59', 'Registration end date and time')");

  // Verify
  console.log('\n=== VERIFICATION ===');
  const [counts] = await conn.query(`SELECT
    (SELECT COUNT(*) FROM users) as users,
    (SELECT COUNT(*) FROM applications) as applications,
    (SELECT COUNT(*) FROM provinces) as provinces,
    (SELECT COUNT(*) FROM majors) as majors,
    (SELECT COUNT(*) FROM scholarship_categories) as categories,
    (SELECT COUNT(*) FROM scholarship_types) as scholarship_types`);
  const c = counts[0];
  console.log('  Users:            ' + c.users);
  console.log('  Applications:     ' + c.applications);
  console.log('  Provinces:        ' + c.provinces);
  console.log('  Majors:           ' + c.majors);
  console.log('  Categories:       ' + c.categories);
  console.log('  Scholarship Types: ' + c.scholarship_types);

  // Verify Khmer
  const [st] = await conn.query('SELECT name_kh, coverage_percentage FROM scholarship_types LIMIT 1');
  console.log('\n  Khmer check: ' + st[0].name_kh + ' (' + st[0].coverage_percentage + '%)');

  console.log('\n=== DONE! ===');
  console.log('Admin login:     admin@nmu.edu.kh / admin123');
  console.log('Student login:   sok_vannak@test.com / 123456');

  await conn.end();
  process.exit(0);
}

migrate().catch(err => {
  console.error('FATAL:', err);
  process.exit(1);
});
