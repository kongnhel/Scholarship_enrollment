require('dotenv').config();
const mysql = require('mysql2/promise');

function pick(arr) { return arr[Math.floor(Math.random() * arr.length)]; }
function wr(items, wt) {
  const t = wt.reduce((a, b) => a + b, 0);
  let r = Math.random() * t;
  for (let i = 0; i < items.length; i++) { r -= wt[i]; if (r <= 0) return items[i]; }
  return items[items.length - 1];
}

async function insertApps() {
  const db = await mysql.createPool({
    host: process.env.DB_HOST || 'localhost',
    user: process.env.DB_USER || 'root',
    password: process.env.DB_PASSWORD || '',
    database: process.env.DB_NAME || 'scholarship_system',
    charset: 'utf8mb4'
  });

  const [users] = await db.query('SELECT id FROM users WHERE role = ? ORDER BY id LIMIT 10', ['student']);
  const statuses = ['pending', 'under_review', 'approved', 'rejected'];
  const w = [0.3, 0.3, 0.2, 0.2];
  const kF = ['សុខ','ចាន់','គង់','ប៉ុន','ម៉ៅ','រិទ្ធ','វិច្ឆិកា','ស្រី','លី','ថាច'];
  const kL = ['វណ្ណា','សុវណ្ណ','សុភ័ក្ត្រ','ចំរើន','គុយ','វ៉ាន់','ផល','សុខ','ចាន់','រ៉េន'];
  const eF = ['Sokha','Chantha','Kong','Pov','Mao','Rith','Vicheka','Srey','Ly','Chhay'];
  const eL = ['Vannak','Sovann','Sopheak','Chamroeun','Koeuy','Van','Pich','Sok','Chan','Rien'];
  const schools = ['វិទ្យាល័យព្រះសីហនុ','វិទ្យាល័យឥន្ទ្រពេជ្រ','វិទ្យាល័យស្វាយរៀង','វិទ្យាល័យបាត់ដំបង'];

  let c = 0;
  for (let i = 0; i < users.length; i++) {
    const u = users[i];
    const st = wr(statuses, w);
    const month = String(Math.floor(Math.random() * 12) + 1).padStart(2, '0');
    const day = String(Math.floor(Math.random() * 28) + 1).padStart(2, '0');
    const dob = (1998 + Math.floor(Math.random() * 7)) + '-' + month + '-' + day;
    const phone = '012' + String(Math.floor(100000 + Math.random() * 900000));
    const addr = 'ភូមិព្រៃទទឹង, ស្រុកកំពង់ត្របែក, ខេត្តព្រៃវែង';
    const subDate = new Date(2024, Math.floor(Math.random() * 12), Math.floor(Math.random() * 28) + 1);

    await db.query(
      `INSERT INTO applications (user_id, status, khmer_first_name, khmer_last_name, english_first_name, english_last_name,
        gender, date_of_birth, nationality, national_id, current_address, phone, email, school_name,
        graduation_year, major_first_choice_id, major_second_choice_id, scholarship_category_id, submitted_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [u.id, st, kF[i], kL[i], eF[i], eL[i],
        Math.random() > 0.5 ? 'male' : 'female', dob, 'Cambodian',
        String(Math.floor(10000000 + Math.random() * 90000000)), addr, phone,
        'student' + u.id + '@gmail.com', pick(schools), 2024,
        25 + Math.floor(Math.random() * 12), 25 + Math.floor(Math.random() * 12),
        15 + Math.floor(Math.random() * 7), subDate]
    );
    c++;
    console.log('App #' + c + ' for ' + eF[i] + ' ' + eL[i] + ' -> ' + st);
  }

  const [rows] = await db.query('SELECT a.id, a.status, a.khmer_first_name, a.khmer_last_name, a.english_first_name, a.english_last_name FROM applications a ORDER BY a.id DESC LIMIT 10');
  console.log('\nAll test applications:');
  rows.forEach(x => console.log('  #' + x.id + ' | ' + x.khmer_first_name + ' ' + x.khmer_last_name + ' (' + x.english_first_name + ' ' + x.english_last_name + ') | ' + x.status));

  await db.end();
  process.exit(0);
}

insertApps();
