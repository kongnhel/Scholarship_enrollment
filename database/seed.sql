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

INSERT INTO users (email, password, role, khmer_name, english_name, is_verified) VALUES
('admin@nmu.edu.kh', '$2a$12$.HCooHb.C/alwwreP4CAh.kCIFCAH/FJ0hW1RLjhyxT5jo0A3Ee76', 'admin', 'អ្នកគ្រប់គ្រង', 'Administrator', 1),
('committee@nmu.edu.kh', '$2a$12$c8yzzQgVxceYswLHQtF9OO/qbn2kF.tOyOIUkFyJZ.pU3hBg2l7hO', 'committee', 'គណៈកម្មការ', 'Committee Member', 1);

INSERT INTO settings (setting_key, setting_value, description) VALUES
('registration_open', '1', 'Enable or disable student registration'),
('registration_start', '2026-06-01 00:00:00', 'Registration start date and time'),
('registration_end', '2026-08-31 23:59:59', 'Registration end date and time');
