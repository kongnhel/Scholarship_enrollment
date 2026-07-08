require('dotenv').config();
const mysql = require('mysql2/promise');

const provinces = [
  { name_kh: 'រាជធានីភ្នំពេញ', name_en: 'Phnom Penh' },
  { name_kh: 'ខេត្តបន្ទាយមានជ័យ', name_en: 'Banteay Meanchey' },
  { name_kh: 'ខេត្តបាត់ដំបង', name_en: 'Battambang' },
  { name_kh: 'ខេត្តកំពង់ចាម', name_en: 'Kampong Cham' },
  { name_kh: 'ខេត្តកំពង់ឆ្នាំង', name_en: 'Kampong Chhnang' },
  { name_kh: 'ខេត្តកំពង់ស្ពឺ', name_en: 'Kampong Speu' },
  { name_kh: 'ខេត្តកំពង់ធាង', name_en: 'Kampong Thom' },
  { name_kh: 'ខេត្តកំពត', name_en: 'Kampot' },
  { name_kh: 'ខេត្តកណ្តាល', name_en: 'Kandal' },
  { name_kh: 'ខេត្តកោះកុង', name_en: 'Koh Kong' },
  { name_kh: 'ខេត្តក្រចេះ', name_en: 'Kratie' },
  { name_kh: 'ខេត្តមណ្ឌលគីរី', name_en: 'Mondulkiri' },
  { name_kh: 'ខេត្តឧត្តរមានជ័យ', name_en: 'Oddar Meanchey' },
  { name_kh: 'ខេត្តព្រះវិហារ', name_en: 'Preah Vihear' },
  { name_kh: 'ខេត្តព្រះសីហនុ', name_en: 'Preah Sihanouk' },
  { name_kh: 'ខេត្តព្រៃវែង', name_en: 'Prey Veng' },
  { name_kh: 'ខេត្តពោធិ៍សាត់', name_en: 'Pursat' },
  { name_kh: 'ខេត្តរតនគីរី', name_en: 'Ratanakiri' },
  { name_kh: 'ខេត្តសៀមរាប', name_en: 'Siem Reap' },
  { name_kh: 'ខេត្តស្ទឹងត្រែង', name_en: 'Stung Treng' },
  { name_kh: 'ខេត្តស្វាយរៀង', name_en: 'Svay Rieng' },
  { name_kh: 'ខេត្តតាកែវ', name_en: 'Takeo' },
  { name_kh: 'ខេត្តត្បូងឃ្មុំ', name_en: 'Tboung Khmum' },
];

async function seed() {
  const db = await mysql.createPool({
    host: process.env.DB_HOST || 'localhost',
    user: process.env.DB_USER || 'root',
    password: process.env.DB_PASSWORD || '',
    database: process.env.DB_NAME || 'scholarship_system',
    waitForConnections: true,
    connectionLimit: 1,
    charset: 'utf8mb4'
  });

  try {
    await db.query('DELETE FROM provinces');
    console.log('Cleared existing provinces');

    for (const p of provinces) {
      await db.query('INSERT INTO provinces (name_kh, name_en) VALUES (?, ?)', [p.name_kh, p.name_en]);
    }
    console.log(`Inserted ${provinces.length} provinces`);

    const [rows] = await db.query('SELECT id, name_kh, name_en FROM provinces ORDER BY id');
    console.log('\nAll provinces:');
    rows.forEach(r => console.log(`  ${r.id}. ${r.name_kh} (${r.name_en})`));
  } catch (err) {
    console.error('Error:', err.message);
  }

  await db.end();
  process.exit(0);
}

seed();
