require('dotenv').config();
const mysql = require('mysql2/promise');

const khmerFirstNames = ['សុខ', 'ចាន់', 'គង់', 'ប៉ុន', 'ម៉ៅ', 'រិទ្ធ', 'វិច្ឆិកា', 'ស្រី', 'លី', 'ថាច', 'សាវឿន', 'សុផល', 'កែវ', 'រ័ត្ន', 'ឈឿន', 'ហួរ', 'អ៊ុំ', 'ច័ន្ទ', 'ពិសិដ្ឋ', 'វីរៈ'];
const khmerLastNames = ['វណ្ណា', 'សុវណ្ណ', 'សុភ័ក្ត្រ', 'ចំរើន', 'គុយ', 'វ៉ាន់', 'ផល', 'សុខ', 'ចាន់', 'រ៉េន', 'ម៉ៅ', 'ថៃ', 'ជួន', 'សុឃីម', 'កែវ', 'ហេង', 'ភួន', 'ឃឿន', 'សាវឿន', 'លី'];
const englishFirstNames = ['Sokha', 'Chantha', 'Kong', 'Pov', 'Mao', 'Rith', 'Vicheka', 'Srey', 'Ly', 'Chhay', 'Savoeun', 'Sopheap', 'Kaev', 'Rothana', 'Chheun', 'Huor', 'Ung', 'Chantrea', 'Piseth', 'Viroth'];
const englishLastNames = ['Vannak', 'Sovann', 'Sopheak', 'Chamroeun', 'Koeuy', 'Van', 'Pich', 'Sok', 'Chan', 'Rien', 'Mao', 'Thai', 'Chhuon', 'Sokhim', 'Kaev', 'Heng', 'Phoum', 'Koeun', 'Savoeun', 'Ly'];
const genders = ['male', 'female'];
const provinces = [1, 3, 4];
const majors = [1, 2, 3];
const categories = [1, 2, 3];
const schoolNames = ['វិទ្យាល័យព្រះសីហនុ', 'វិទ្យាល័យឥន្ទ្រពេជ្រ', 'វិទ្យាល័យស្វាយរៀង', 'វិទ្យាល័យបាត់ដំបង', 'វិទ្យាល័យពោធិ៍សាត់', 'វិទ្យាល័យកំពង់ចាម', 'វិទ្យាល័យភ្នំពេញ', 'វិទ្យាល័យសៀមរាប'];
const statuses = ['pending', 'under_review', 'approved', 'rejected'];
const statusesWeights = [0.4, 0.3, 0.15, 0.15];

function pick(arr) { return arr[Math.floor(Math.random() * arr.length)]; }
function weightedRandom(items, weights) {
  const total = weights.reduce((a, b) => a + b, 0);
  let r = Math.random() * total;
  for (let i = 0; i < items.length; i++) { r -= weights[i]; if (r <= 0) return items[i]; }
  return items[items.length - 1];
}
function randomDate(start, end) {
  return new Date(start.getTime() + Math.random() * (end.getTime() - start.getTime()));
}
function randomPhone() {
  return pick(['012', '015', '016', '017', '069', '088', '089', '097', '098', '099']) + Math.floor(100000 + Math.random() * 900000);
}
function randomAddress() {
  return `ភូមិ${pick(['ព្រៃទទឹង', 'កំពង់ចម្លង', 'ស្រះពណ៌', 'អូរតាសេក', 'បុស្តិ៍រតនៈ'])}, ${pick(['ស្រុកកំពង់ត្របែក', 'ស្រុកព្រៃកប្បាស', 'ស្រុកត្បូងឃ្មុំ'])}, ${pick(['ខេត្តព្រៃវែង', 'ខេត្តត្បូងឃ្មុំ', 'ខេត្តកំពង់ចាម'])}`;
}

async function seed() {
  const db = await mysql.createPool({
    host: process.env.DB_HOST || 'localhost',
    user: process.env.DB_USER || 'root',
    password: process.env.DB_PASSWORD || '',
    database: process.env.DB_NAME || 'scholarship_system',
    waitForConnections: true, connectionLimit: 10, charset: 'utf8mb4'
  });

  try {
    const [existing] = await db.query('SELECT COUNT(*) as cnt FROM applications');
    console.log('Existing applications:', existing[0].cnt);

    const [users] = await db.query('SELECT id FROM users WHERE role = ? ORDER BY id', ['student']);
    console.log('Student users found:', users.length);

    let count = 0;
    for (const user of users) {
      const [exists] = await db.query('SELECT id FROM applications WHERE user_id = ?', [user.id]);
      if (exists.length > 0) continue;

      const year = 2024;
      const month = Math.floor(Math.random() * 12) + 1;
      const day = Math.floor(Math.random() * 28) + 1;
      const dob = `${1998 + Math.floor(Math.random() * 7)}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;

      const status = weightedRandom(statuses, statusesWeights);
      const kFirst = pick(khmerFirstNames);
      const kLast = pick(khmerLastNames);
      const eFirst = pick(englishFirstNames);
      const eLast = pick(englishLastNames);

      await db.query(
        `INSERT INTO applications (
          user_id, status, khmer_first_name, khmer_last_name, english_first_name, english_last_name,
          gender, date_of_birth, nationality, current_address,
          phone, telegram, email,
          parent_name, parent_phone, emergency_contact, emergency_phone,
          school_name, school_province_id, graduation_year, exam_result,
          major_first_choice_id, major_second_choice_id, scholarship_category_id,
          submitted_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          user.id, status,
          kFirst, kLast, eFirst, eLast,
          pick(genders), dob, 'Cambodian',
          randomAddress(),
          randomPhone(), `${eFirst.toLowerCase()}${user.id}`, `student${user.id}@gmail.com`,
          `${pick(khmerLastNames)} ${pick(khmerFirstNames)}`, randomPhone(),
          `${pick(khmerLastNames)} ${pick(khmerFirstNames)}`, randomPhone(),
          pick(schoolNames), pick(provinces), 2024,
          `${(Math.random() * 2 + 2).toFixed(2)}`,
          pick(majors), pick(majors), pick(categories),
          randomDate(new Date('2024-01-01'), new Date('2024-12-31'))
        ]
      );

      count++;
      if (count % 50 === 0) console.log(`  Created ${count} applications...`);
    }

    console.log(`\nDone! Created ${count} applications.`);
    const [total] = await db.query('SELECT COUNT(*) as cnt FROM applications');
    console.log('Total applications:', total[0].cnt);
  } catch (err) {
    console.error('Seed error:', err.message);
  }

  await db.end();
  process.exit(0);
}

seed();
