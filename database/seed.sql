USE scholarship_system;

INSERT INTO provinces (name_kh, name_en) VALUES
('ភ្នំពេញ', 'Phnom Penh'),
('សៀមរាប', 'Siem Reap'),
('បាត់ដំបង', 'Battambang'),
('កំពង់ចាម', 'Kampong Cham'),
('កំពង់ឆ្នាំង', 'Kampong Chhnang'),
('កំពង់ស្ពឺ', 'Kampong Speu'),
('កំពង់ថម', 'Kampong Thom'),
('កំពត', 'Kampot'),
('កណ្តាល', 'Kandal'),
('កោះកុង', 'Koh Kong'),
('ក្រចេះ', 'Kratie'),
('មណ្ឌលគីរី', 'Mondulkiri'),
('ព្រះវិហារ', 'Preah Vihear'),
('ព្រៃវែង', 'Prey Veng'),
('ពោធិ៍សាត់', 'Pursat'),
('រតនគីរី', 'Ratanak Kiri'),
('ស្ទឹងត្រែង', 'Stung Treng'),
('ស្វាយរៀង', 'Svay Rieng'),
('តាកែវ', 'Takeo'),
('ត្បូងឃ្មុំ', 'Tboung Khmum'),
('ប៉ៃលិន', 'Pailin'),
('ព្រះសីហនុ', 'Sihanoukville');

INSERT INTO majors (name_kh, name_en, faculty_kh, faculty_en) VALUES
('វិទ្យាសាស្ត្រកុំព្យូទ័រ', 'Computer Science', 'សាកលវិទ្យាល័យវិទ្យាសាស្ត្រ និងបច្ចេកវិទ្យា', 'Faculty of Science and Technology'),
('វិស្វកម្មកុំព្យូទ័រ', 'Computer Engineering', 'សាកលវិទ្យាល័យវិទ្យាសាស្ត្រ និងបច្ចេកវិទ្យា', 'Faculty of Science and Technology'),
('រដ្ឋបាលធុរកិច្ច', 'Business Administration', 'សាកលវិទ្យាល័យធុរកិច្ច និងសេដ្ឋកិច្ច', 'Faculty of Business and Economics'),
('គណនេយ្យ', 'Accounting', 'សាកលវិទ្យាល័យធុរកិច្ច និងសេដ្ឋកិច្ច', 'Faculty of Business and Economics'),
('សេដ្ឋកិច្ច', 'Economics', 'សាកលវិទ្យាល័យធុរកិច្ច និងសេដ្ឋកិច្ច', 'Faculty of Business and Economics'),
('អក្សរសាស្ត្រអង់គ្លេស', 'English Literature', 'សាកលវិទ្យាល័យអក្សរសាស្ត្រ និងមនុស្សសាស្ត្រ', 'Faculty of Arts and Humanities'),
('អក្សរសាស្ត្រខ្មែរ', 'Khmer Literature', 'សាកលវិទ្យាល័យអក្សរសាស្ត្រ និងមនុស្សសាស្ត្រ', 'Faculty of Arts and Humanities'),
('អភិបាលកិច្ចសាធារណៈ', 'Public Administration', 'សាកលវិទ្យាល័យនយោបាយ និងរដ្ឋបាលសាធារណៈ', 'Faculty of Politics and Public Administration'),
('ច្បាប់', 'Law', 'សាកលវិទ្យាល័យនយោបាយ និងរដ្ឋបាលសាធារណៈ', 'Faculty of Politics and Public Administration'),
('គ្រប់គ្រងធនធានមនុស្ស', 'Human Resource Management', 'សាកលវិទ្យាល័យធុរកិច្ច និងសេដ្ឋកិច្ច', 'Faculty of Business and Economics'),
('ទំនាក់ទំនងអន្តរជាតិ', 'International Relations', 'សាកលវិទ្យាល័យនយោបាយ និងរដ្ឋបាលសាធារណៈ', 'Faculty of Politics and Public Administration'),
('អប់រំ', 'Education', 'សាកលវិទ្យាល័យអប់រំ', 'Faculty of Education');

INSERT INTO scholarship_categories (name_kh, name_en, description_kh, description_en) VALUES
('អាហារូបករណ៍ពេញ', 'Full Scholarship', 'ទទួលបានអាហារូបករណ៍ពេញដែលរួមបញ្ចូលថ្លៃសិក្សា និងថ្លៃផ្សេងៗ', 'Full scholarship covering tuition fees and other expenses'),
('អាហារូបករណ៍មួយចំនួន', 'Partial Scholarship', 'ទទួលបានអាហារូបករណ៍មួយចំនួនសម្រាប់ថ្លៃសិក្សា', 'Partial scholarship for tuition fees'),
('អាហារូបករណ៍សិស្សក្រីក្រ', 'Poor Family Scholarship (Financial Hardship)', 'សម្រាប់សិស្សដែលមានជីវភាពខ្វះខាត', 'For students from economically disadvantaged families'),
('អាហារូបករណ៍សមត្ថភាពសិក្សាល្អ', 'Outstanding Academic Achievement Scholarship', 'សម្រាប់សិស្សដែលមានលទ្ធផលសិក្សាល្អប្រសើរ', 'For students with excellent academic performance'),
('អាហារូបករណ៍សិស្សស្រី', 'Female Student Scholarship', 'សម្រាប់សិស្សស្រីដែលមានសមត្ថភាព', 'For female students with outstanding abilities'),
('អាហារូបករណ៍សិស្សពិការ', 'Scholarship for Students with Disabilities', 'សម្រាប់សិស្សដែលមានពិការភាព', 'For students with disabilities'),
('អាហារូបករណ៍ផ្សេងៗ', 'Other Categories', 'ប្រភេទអាហារូបករណ៍ផ្សេងៗដែលកំណត់ដោយសាកលវិទ្យាល័យ', 'Other scholarship categories as defined by the university');

-- Demo accounts were removed from this file.
--
-- It used to insert an admin and a committee account with bcrypt hashes of "admin123" and
-- "committee123". Those hashes were committed to this repository, so anyone who could read
-- the repo could log in as an administrator without cracking anything -- the password was a
-- dictionary word. Both accounts were also created with is_verified = 1, so there was no
-- email or OTP gate in front of them.
--
-- Create the first administrator deliberately instead, with a password that exists nowhere
-- else:
--
--   node -e "const b=require('bcryptjs'),m=require('mysql2/promise');
--     m.createConnection({host:process.env.DB_HOST,port:+process.env.DB_PORT,user:process.env.DB_USER,
--     password:process.env.DB_PASSWORD,database:process.env.DB_NAME}).then(async c=>{
--     await c.query('INSERT INTO users (email,username,password,role,khmer_name,english_name,is_verified) VALUES (?,?,?,?,?,?,1)',
--       ['you@nmu.edu.kh','admin',await b.hash(process.argv[1],12),'admin','x','x']);c.end();})" 'your-password'
--
-- database/auto_setup.js has the same demo data and will create it only when
-- SEED_DEMO_DATA=true is set explicitly.

INSERT INTO settings (setting_key, setting_value, description) VALUES
('registration_open', '1', 'Enable or disable student registration'),
('registration_start', '2026-06-01 00:00:00', 'Registration start date and time'),
('registration_end', '2026-08-31 23:59:59', 'Registration end date and time');
