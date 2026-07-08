const mysql = require('mysql2/promise');

async function test() {
  const db = await mysql.createPool({
    host: 'localhost', user: 'root', password: '',
    database: 'scholarship_system', charset: 'utf8mb4'
  });

  // Check what the enroll form POST route expects vs what exists
  console.log('=== Checking enrollments table ===');
  const [cols] = await db.query('SHOW COLUMNS FROM enrollments');
  const colNames = cols.map(c => c.Field);
  console.log('Columns:', colNames.join(', '));

  console.log('\n=== Checking route INSERT columns ===');
  const insertCols = [
    'user_id', 'academic_year', 'semester', 'status',
    'khmer_first_name', 'khmer_last_name', 'english_first_name', 'english_last_name',
    'gender', 'date_of_birth', 'place_of_birth', 'phone',
    'current_address', 'province', 'district', 'commune',
    'parent_name', 'parent_phone', 'parent_relationship',
    'previous_school', 'previous_diploma', 'diploma_year', 'major', 'major_choice',
    'scholarship_category_id', 'bank_name', 'photo_path'
  ];
  
  const missing = insertCols.filter(c => !colNames.includes(c));
  if (missing.length > 0) {
    console.log('MISSING COLUMNS:', missing.join(', '));
  } else {
    console.log('All columns exist');
  }

  console.log('\n=== Testing INSERT ===');
  const [users] = await db.query('SELECT id FROM users WHERE role = ? LIMIT 1', ['student']);
  if (users.length === 0) {
    console.log('No student users found! Creating one...');
    const bcrypt = require('bcryptjs');
    const hash = await bcrypt.hash('password123', 12);
    const [r] = await db.query(
      'INSERT INTO users (email, password, role, khmer_name, english_name, is_verified, username, phone) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
      ['test@student.com', hash, 'student', 'សិស្សសាកល', 'Test Student', 1, 'teststudent', '012345678']
    );
    console.log('Created student user with id:', r.insertId);
    users.push({ id: r.insertId });
  }
  
  const uid = users[0].id;
  try {
    const [result] = await db.query(
      `INSERT INTO enrollments (
        user_id, academic_year, semester, status,
        khmer_first_name, khmer_last_name, english_first_name, english_last_name,
        gender, date_of_birth, place_of_birth, phone,
        current_address, province, district, commune,
        parent_name, parent_phone, parent_relationship,
        previous_school, previous_diploma, diploma_year, major, major_choice,
        scholarship_category_id, bank_name, photo_path
      ) VALUES (?, ?, ?, ?,
        ?, ?, ?, ?,
        ?, ?, ?, ?,
        ?, ?, ?, ?,
        ?, ?, ?,
        ?, ?, ?, ?, ?,
        ?, ?, ?)`,
      [
        uid, '2025-2026', '1', 'pending',
        'សិស្ស', 'សាកល', 'Test', 'Student',
        'male', '2000-01-01', 'ភ្នំពេញ', '012345678',
        'test address', 'Phnom Penh', 'test', 'test',
        'Parent Name', '098765432', 'Father',
        'Test School', 'Diploma', 2024, 'Computer Science', '13',
        1, 'ABA', null
      ]
    );
    console.log('SUCCESS! Insert id:', result.insertId);
    await db.query('DELETE FROM enrollments WHERE id = ?', [result.insertId]);
    console.log('Cleaned up test row');
  } catch (e) {
    console.error('FAILED:', e.message);
    console.error('SQL:', e.sql);
  }

  await db.end();
}

test().catch(e => { console.error(e); process.exit(1); });
