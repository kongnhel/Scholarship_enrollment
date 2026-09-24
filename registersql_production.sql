-- ============================================================
-- Scholarship System - Production Database Schema
-- Prepared: 2026-09-21
-- ============================================================
-- WARNING: Review carefully before importing to production.
-- This file creates all tables and inserts reference/config data.
-- User accounts and test data have been removed.
-- ============================================================

SET NAMES utf8mb4;
SET FOREIGN_KEY_CHECKS = 0;
SET SQL_MODE = 'STRICT_TRANS_TABLES,NO_ZERO_DATE,NO_ZERO_IN_DATE,ERROR_FOR_DIVISION_BY_ZERO,NO_ENGINE_SUBSTITUTION';

-- -----------------------------------------------------------
-- Create Database (uncomment and edit if needed)
-- -----------------------------------------------------------
-- CREATE DATABASE IF NOT EXISTS `defaultdb`
--   CHARACTER SET utf8mb4
--   COLLATE utf8mb4_unicode_ci;
-- USE `defaultdb`;

-- ===========================================================
-- TABLE: users
-- ===========================================================
DROP TABLE IF EXISTS `application_status_history`;
DROP TABLE IF EXISTS `payments`;
DROP TABLE IF EXISTS `enrollments`;
DROP TABLE IF EXISTS `applications`;
DROP TABLE IF EXISTS `telegram_pending`;
DROP TABLE IF EXISTS `notifications`;
DROP TABLE IF EXISTS `major_tuition`;
DROP TABLE IF EXISTS `majors`;
DROP TABLE IF EXISTS `fee_types`;
DROP TABLE IF EXISTS `scholarship_types`;
DROP TABLE IF EXISTS `scholarship_categories`;
DROP TABLE IF EXISTS `provinces`;
DROP TABLE IF EXISTS `settings`;
DROP TABLE IF EXISTS `users`;

CREATE TABLE `users` (
  `id` int NOT NULL AUTO_INCREMENT,
  `email` varchar(255) COLLATE utf8mb4_unicode_ci NOT NULL,
  `password` varchar(255) COLLATE utf8mb4_unicode_ci NOT NULL,
  `role` enum('student','admin','committee') COLLATE utf8mb4_unicode_ci DEFAULT 'student',
  `khmer_name` varchar(255) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `english_name` varchar(255) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `gender` enum('male','female') COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `date_of_birth` date DEFAULT NULL,
  `place_of_birth` varchar(255) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `address` text COLLATE utf8mb4_unicode_ci,
  `phone` varchar(20) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `telegram_chat_id` varchar(100) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `profile_pic` varchar(500) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `is_verified` tinyint DEFAULT '0',
  `verification_token` varchar(255) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `token_expires_at` datetime DEFAULT NULL,
  `reset_token` varchar(255) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `reset_token_expires` datetime DEFAULT NULL,
  `created_at` timestamp NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` timestamp NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  `username` varchar(255) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `verify_method` varchar(50) COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT 'email',
  `otp_last_sent_at` datetime DEFAULT NULL,
  `otp_code` varchar(10) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `otp_expires_at` datetime DEFAULT NULL,
  `otp_attempts` int DEFAULT '0',
  PRIMARY KEY (`id`),
  UNIQUE KEY `email` (`email`),
  UNIQUE KEY `idx_users_username` (`username`),
  KEY `idx_users_email` (`email`),
  KEY `idx_users_role` (`role`),
  KEY `idx_users_verification_token` (`verification_token`),
  KEY `idx_users_reset_token` (`reset_token`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ===========================================================
-- TABLE: provinces
-- ===========================================================
CREATE TABLE `provinces` (
  `id` int NOT NULL AUTO_INCREMENT,
  `name_kh` varchar(255) COLLATE utf8mb4_unicode_ci NOT NULL,
  `name_en` varchar(255) COLLATE utf8mb4_unicode_ci NOT NULL,
  PRIMARY KEY (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

INSERT INTO `provinces` (`name_kh`, `name_en`) VALUES
('ភ្នំពេញ','Phnom Penh'),
('សៀមរាប','Siem Reap'),
('បាត់ដំបង','Battambang'),
('កំពង់ចាម','Kampong Cham'),
('កំពង់ឆ្នាំង','Kampong Chhnang'),
('កំពង់ស្ពឺ','Kampong Speu'),
('កំពង់ថម','Kampong Thom'),
('កំពត','Kampot'),
('កណ្តាល','Kandal'),
('កោះកុង','Koh Kong'),
('ក្រចេះ','Kratie'),
('មណ្ឌលគីរី','Mondulkiri'),
('ព្រះវិហារ','Preah Vihear'),
('ព្រៃវែង','Prey Veng'),
('ពោធិ៍សាត់','Pursat'),
('រតនគីរី','Ratanak Kiri'),
('ស្ទឹងត្រែង','Stung Treng'),
('ស្វាយរៀង','Svay Rieng'),
('តាកែវ','Takeo'),
('ត្បូងឃ្មុំ','Tboung Khmum'),
('ប៉ៃលិន','Pailin'),
('ព្រះសីហនុ','Sihanoukville'),
('បន្ទាយមានជ័យ','Banteay Meanchey');

-- ===========================================================
-- TABLE: scholarship_categories
-- ===========================================================
CREATE TABLE `scholarship_categories` (
  `id` int NOT NULL AUTO_INCREMENT,
  `name_kh` varchar(255) COLLATE utf8mb4_unicode_ci NOT NULL,
  `name_en` varchar(255) COLLATE utf8mb4_unicode_ci NOT NULL,
  `description_kh` text COLLATE utf8mb4_unicode_ci,
  `description_en` text COLLATE utf8mb4_unicode_ci,
  `is_active` tinyint DEFAULT '1',
  `created_at` timestamp NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `idx_scholarship_categories_active` (`is_active`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

INSERT INTO `scholarship_categories` (`name_kh`, `name_en`, `description_kh`, `description_en`, `is_active`) VALUES
('អាហារូបករណ៍ពេញ','Full Scholarship','ទទួលបានអាហារូបករណ៍ពេញដែលរួមបញ្ចូលថ្លៃសិក្សា និងថ្លៃផ្សេងៗ','Full scholarship covering tuition fees and other expenses',1),
('អាហារូបករណ៍មួយចំនួន','Partial Scholarship','ទទួលបានអាហារូបករណ៍មួយចំនួនសម្រាប់ថ្លៃសិក្សា','Partial scholarship for tuition fees',1),
('អាហារូបករណ៍សិស្សក្រីក្រ','Poor Family Scholarship (Financial Hardship)','សម្រាប់សិស្សដែលមានជីវភាពខ្វះខាត','For students from economically disadvantaged families',1),
('អាហារូបករណ៍សមត្ថភាពសិក្សាល្អ','Outstanding Academic Achievement Scholarship','សម្រាប់សិស្សដែលមានលទ្ធផលសិក្សាល្អប្រសើរ','For students with excellent academic performance',1),
('អាហារូបករណ៍សិស្សស្រី','Female Student Scholarship','សម្រាប់សិស្សស្រីដែលមានសមត្ថភាព','For female students with outstanding abilities',1),
('អាហារូបករណ៍សិស្សពិការ','Scholarship for Students with Disabilities','សម្រាប់សិស្សដែលមានពិការភាព','For students with disabilities',1),
('អាហារូបករណ៍ផ្សេងៗ','Other Categories','ប្រភេទអាហារូបករណ៍ផ្សេងៗដែលកំណត់ដោយសាកលវិទ្យាល័យ','Other scholarship categories as defined by the university',1);

-- ===========================================================
-- TABLE: scholarship_types
-- ===========================================================
CREATE TABLE `scholarship_types` (
  `id` int NOT NULL AUTO_INCREMENT,
  `name_kh` varchar(500) COLLATE utf8mb4_unicode_ci NOT NULL,
  `name_en` varchar(500) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `coverage_percentage` int NOT NULL DEFAULT '0',
  `duration_years` int NOT NULL DEFAULT '1',
  `provider_name` varchar(500) COLLATE utf8mb4_unicode_ci NOT NULL,
  `ministry_fee` decimal(10,2) DEFAULT '0.00',
  `description` text COLLATE utf8mb4_unicode_ci,
  `is_active` tinyint DEFAULT '1',
  `created_at` timestamp NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` timestamp NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `idx_scholarship_types_active` (`is_active`),
  KEY `idx_scholarship_types_provider` (`provider_name`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

INSERT INTO `scholarship_types` (`name_kh`, `name_en`, `coverage_percentage`, `duration_years`, `provider_name`, `ministry_fee`, `description`, `is_active`) VALUES
('អាហារូបករណ៍៤០% សិក្សារយៈពេល៤ឆ្នាំ របស់អង្គការកុមារមេគង្គកម្ពុជា','40% Scholarship for 4 Years - Mekong Child Organization',40,4,'អង្គការកុមារមេគង្គកម្ពុជា',0.00,'អាហារូបករណ៍៤០% សម្រាប់សិស្សដែលមានលទ្ធផលសិក្សាល្អ សិក្សារយៈពេល៤ឆ្នាំ អង្គការកុមារមេគង្គកម្ពុជា',1),
('អាហារូបករណ៍៥០% សិក្សារយៈពេល២ឆ្នាំ របស់សាកលវិទ្យាល័យជាតិមានជ័យ','50% Scholarship for 2 Years - NMU',50,2,'សាកលវិទ្យាល័យជាតិមានជ័យ',0.00,'អាហារូបករណ៍៥០% សម្រាប់និស្សិតសាកលវិទ្យាល័យជាតិមានជ័យ សិក្សារយៈពេល២ឆ្នាំ',1),
('អាហារូបករណ៍១០០% សិក្សារយៈពេល៤ឆ្នាំ របស់ក្រសួង','100% Full Scholarship for 4 Years - Ministry of Education',100,4,'ក្រសួងអប់រំ យុវជន និងកីឡា',200000.00,'អាហារូបករណ៍ពេញ១០០% សម្រាប់សិស្សពូកែ សិក្សារយៈពេល៤ឆ្នាំ កក្រសួងអប់រំ យុវជន និងកីឡា',1),
('អាហារូបករណ៍៥០% សិក្សារយៈពេល៤ឆ្នាំ របស់សាកលវិទ្យាល័យជាតិមានជ័យ','50% Scholarship for 4 Years - NMU',50,4,'សាកលវិទ្យាល័យជាតិមានជ័យ',0.00,'អាហារូបករណ៍៥០% សិក្សារយៈពេល៤ឆ្នាំ របស់សាកលវិទ្យាល័យជាតិមានជ័យ',1),
('អាហារូបករណ៍១០០% សិក្សារយៈពេល៤ឆ្នាំ របស់សកលវិទ្យាល័យជាតិមានជ័យ','100% Full Scholarship for 4 Years - NMU',100,4,'សាកលវិទ្យាល័យជាតិមានជ័យ',0.00,'អាហារូបករណ៍១០០% សិក្សារយៈពេល៤ឆ្នាំ របស់សកលវិទ្យាល័យជាតិមានជ័យ',1);

-- ===========================================================
-- TABLE: majors
-- ===========================================================
CREATE TABLE `majors` (
  `id` int NOT NULL AUTO_INCREMENT,
  `name_kh` varchar(255) COLLATE utf8mb4_unicode_ci NOT NULL,
  `name_en` varchar(255) COLLATE utf8mb4_unicode_ci NOT NULL,
  `faculty_kh` varchar(255) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `faculty_en` varchar(255) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `is_active` tinyint DEFAULT '1',
  `created_at` timestamp NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `idx_majors_active` (`is_active`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

INSERT INTO `majors` (`name_kh`, `name_en`, `faculty_kh`, `faculty_en`, `is_active`) VALUES
('អភិវឌ្ឍន៍កម្មវិធីកុំព្យូទ័រនិងទូរស័ព្ទដៃ','Computer and mobile application development','មហាវិទ្យាល័យវិទ្យាសាស្ត្រ និងបច្ចេកវិទ្យា','Faculty of Science and Technology',1),
('អក្សរសាស្រ្តខ្មែរ','Khmer Langauge','មហាវិទ្យាល័យសិល្បៈ មនុស្សសាស្ត្រ និងភាសា','Faculty of Art Humanities and Language',1);

-- ===========================================================
-- TABLE: fee_types
-- ===========================================================
CREATE TABLE `fee_types` (
  `id` int NOT NULL AUTO_INCREMENT,
  `name_kh` varchar(255) COLLATE utf8mb4_unicode_ci NOT NULL,
  `name_en` varchar(255) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `amount` decimal(10,2) NOT NULL DEFAULT '0.00',
  `description` text COLLATE utf8mb4_unicode_ci,
  `is_active` tinyint DEFAULT '1',
  `created_at` timestamp NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` timestamp NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `idx_fee_types_active` (`is_active`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

INSERT INTO `fee_types` (`name_kh`, `name_en`, `amount`, `description`, `is_active`) VALUES
('ថ្លៃសិក្សា','Tuition Fee',0.00,'ថ្លៃសិក្សាប្រចាំឆ្នាំសម្រាប់និស្សិតអាហារូបករណ៍',1);

-- ===========================================================
-- TABLE: major_tuition
-- ===========================================================
CREATE TABLE `major_tuition` (
  `id` int NOT NULL AUTO_INCREMENT,
  `major_id` int NOT NULL,
  `academic_year` varchar(20) COLLATE utf8mb4_unicode_ci NOT NULL,
  `tuition_per_year` decimal(10,2) NOT NULL DEFAULT '0.00',
  `is_active` tinyint DEFAULT '1',
  `created_at` timestamp NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` timestamp NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `unique_major_year` (`major_id`,`academic_year`),
  KEY `idx_major_tuition_active` (`is_active`),
  CONSTRAINT `major_tuition_ibfk_1` FOREIGN KEY (`major_id`) REFERENCES `majors` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

INSERT INTO `major_tuition` (`major_id`, `academic_year`, `tuition_per_year`, `is_active`) VALUES
(14,'2025-2026',1600000.00,1),
(13,'2025-2026',1600000.00,1);

-- ===========================================================
-- TABLE: settings
-- ===========================================================
CREATE TABLE `settings` (
  `id` int NOT NULL AUTO_INCREMENT,
  `setting_key` varchar(100) COLLATE utf8mb4_unicode_ci NOT NULL,
  `setting_value` text COLLATE utf8mb4_unicode_ci,
  `description` varchar(255) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `updated_at` timestamp NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `setting_key` (`setting_key`),
  KEY `idx_settings_key` (`setting_key`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

INSERT INTO `settings` (`setting_key`, `setting_value`, `description`) VALUES
('registration_open','1','Enable or disable student registration'),
('registration_start','2026-06-01T00:00','Registration start date and time'),
('registration_end','2027-02-05T23:59:59','Registration end date and time'),
('enrollment_open','1','Enable or disable enrollment'),
('enrollment_start','2026-09-04T00:00','Enrollment start date'),
('enrollment_end','2027-02-05T23:59:59','Enrollment end date'),
('scholarship_open','1',NULL),
('scholarship_start','2026-09-04T08:52',NULL),
('scholarship_end','2027-02-04T08:52',NULL),
('payment_qr_path',NULL,NULL);

-- ===========================================================
-- TABLE: applications
-- ===========================================================
CREATE TABLE `applications` (
  `id` int NOT NULL AUTO_INCREMENT,
  `user_id` int NOT NULL,
  `status` enum('pending','under_review','approved','rejected','correction_requested') COLLATE utf8mb4_unicode_ci DEFAULT 'pending',
  `khmer_first_name` varchar(255) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `khmer_last_name` varchar(255) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `english_first_name` varchar(255) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `english_last_name` varchar(255) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `gender` enum('male','female','other') COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `date_of_birth` date DEFAULT NULL,
  `nationality` varchar(100) COLLATE utf8mb4_unicode_ci DEFAULT 'Cambodian',
  `current_address` text COLLATE utf8mb4_unicode_ci,
  `phone` varchar(20) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `telegram` varchar(100) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `email` varchar(255) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `parent_name` varchar(255) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `parent_phone` varchar(20) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `emergency_contact` varchar(255) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `emergency_phone` varchar(20) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `school_name` varchar(255) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `school_province_id` int DEFAULT NULL,
  `graduation_year` int DEFAULT NULL,
  `exam_result` varchar(50) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `major_first_choice_id` int DEFAULT NULL,
  `major_second_choice_id` int DEFAULT NULL,
  `scholarship_type_id` int DEFAULT NULL,
  `scholarship_category_id` int DEFAULT NULL,
  `photo_path` varchar(500) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `transcript_path` varchar(500) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `additional_documents_path` varchar(500) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `admin_remark` text COLLATE utf8mb4_unicode_ci,
  `correction_notes` text COLLATE utf8mb4_unicode_ci,
  `exam_date` date DEFAULT NULL,
  `exam_time` varchar(20) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `exam_venue` varchar(255) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `submitted_at` timestamp NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` timestamp NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `idx_applications_user_id` (`user_id`),
  KEY `idx_applications_status` (`status`),
  KEY `idx_applications_submitted_at` (`submitted_at`),
  KEY `idx_applications_school_province` (`school_province_id`),
  KEY `idx_applications_major_first` (`major_first_choice_id`),
  KEY `idx_applications_major_second` (`major_second_choice_id`),
  KEY `idx_applications_scholarship_category` (`scholarship_category_id`),
  CONSTRAINT `applications_ibfk_1` FOREIGN KEY (`user_id`) REFERENCES `users` (`id`) ON DELETE CASCADE,
  CONSTRAINT `applications_ibfk_2` FOREIGN KEY (`school_province_id`) REFERENCES `provinces` (`id`) ON DELETE SET NULL,
  CONSTRAINT `applications_ibfk_3` FOREIGN KEY (`major_first_choice_id`) REFERENCES `majors` (`id`) ON DELETE SET NULL,
  CONSTRAINT `applications_ibfk_4` FOREIGN KEY (`major_second_choice_id`) REFERENCES `majors` (`id`) ON DELETE SET NULL,
  CONSTRAINT `applications_ibfk_5` FOREIGN KEY (`scholarship_category_id`) REFERENCES `scholarship_categories` (`id`) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ===========================================================
-- TABLE: application_status_history
-- ===========================================================
CREATE TABLE `application_status_history` (
  `id` int NOT NULL AUTO_INCREMENT,
  `application_id` int NOT NULL,
  `old_status` varchar(50) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `new_status` varchar(50) COLLATE utf8mb4_unicode_ci NOT NULL,
  `changed_by` int DEFAULT NULL,
  `notes` text COLLATE utf8mb4_unicode_ci,
  `created_at` timestamp NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `idx_status_history_application` (`application_id`),
  KEY `idx_status_history_changed_by` (`changed_by`),
  KEY `idx_status_history_created_at` (`created_at`),
  CONSTRAINT `application_status_history_ibfk_1` FOREIGN KEY (`application_id`) REFERENCES `applications` (`id`) ON DELETE CASCADE,
  CONSTRAINT `application_status_history_ibfk_2` FOREIGN KEY (`changed_by`) REFERENCES `users` (`id`) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ===========================================================
-- TABLE: enrollments
-- ===========================================================
CREATE TABLE `enrollments` (
  `id` int NOT NULL AUTO_INCREMENT,
  `user_id` int NOT NULL,
  `application_id` int DEFAULT NULL,
  `academic_year` varchar(20) COLLATE utf8mb4_unicode_ci NOT NULL,
  `semester` varchar(20) COLLATE utf8mb4_unicode_ci NOT NULL,
  `khmer_first_name` varchar(255) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `khmer_last_name` varchar(255) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `english_first_name` varchar(255) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `english_last_name` varchar(255) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `gender` enum('male','female') COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `date_of_birth` date DEFAULT NULL,
  `place_of_birth` varchar(255) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `phone` varchar(20) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `current_address` text COLLATE utf8mb4_unicode_ci,
  `province` varchar(100) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `district` varchar(100) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `commune` varchar(100) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `parent_name` varchar(255) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `parent_phone` varchar(20) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `parent_relationship` varchar(50) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `previous_school` varchar(255) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `previous_diploma` varchar(255) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `diploma_year` int DEFAULT NULL,
  `major` varchar(255) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `major_choice` varchar(255) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `scholarship_category_id` int DEFAULT NULL,
  `bank_name` varchar(100) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `bank_account_number` varchar(100) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `bank_account_name` varchar(255) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `photo_path` varchar(500) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `student_signature_date` date DEFAULT NULL,
  `parent_signature_date` date DEFAULT NULL,
  `status` enum('pending','approved','rejected') COLLATE utf8mb4_unicode_ci DEFAULT 'pending',
  `admin_notes` text COLLATE utf8mb4_unicode_ci,
  `enrolled_at` timestamp NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` timestamp NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  `village` varchar(255) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `father_name` varchar(255) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `mother_name` varchar(255) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `occupation` varchar(255) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `education_level` varchar(255) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `guardian_phone` varchar(255) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `exam_session` varchar(100) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `overall_grade` varchar(50) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `high_school` varchar(255) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `high_school_province` varchar(255) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `exam_center` varchar(255) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `education_level_enroll` varchar(100) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `study_schedule` varchar(50) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `study_shift` varchar(50) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `documents_checklist` text COLLATE utf8mb4_unicode_ci,
  `additional_info` text COLLATE utf8mb4_unicode_ci,
  `confirmation` tinyint DEFAULT NULL,
  `doc_transcript_path` text COLLATE utf8mb4_unicode_ci,
  `doc_birth_cert_path` text COLLATE utf8mb4_unicode_ci,
  `doc_photo_4x6_path` text COLLATE utf8mb4_unicode_ci,
  `doc_photo_3x4_path` text COLLATE utf8mb4_unicode_ci,
  PRIMARY KEY (`id`),
  KEY `application_id` (`application_id`),
  KEY `idx_enrollments_user` (`user_id`),
  KEY `idx_enrollments_status` (`status`),
  CONSTRAINT `enrollments_ibfk_1` FOREIGN KEY (`user_id`) REFERENCES `users` (`id`) ON DELETE CASCADE,
  CONSTRAINT `enrollments_ibfk_2` FOREIGN KEY (`application_id`) REFERENCES `applications` (`id`) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ===========================================================
-- TABLE: notifications
-- ===========================================================
CREATE TABLE `notifications` (
  `id` int NOT NULL AUTO_INCREMENT,
  `user_id` int NOT NULL,
  `title` varchar(255) COLLATE utf8mb4_unicode_ci NOT NULL,
  `message` text COLLATE utf8mb4_unicode_ci NOT NULL,
  `is_read` tinyint DEFAULT '0',
  `type` varchar(50) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `created_at` timestamp NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `idx_notifications_user_id` (`user_id`),
  KEY `idx_notifications_is_read` (`is_read`),
  KEY `idx_notifications_created_at` (`created_at`),
  CONSTRAINT `notifications_ibfk_1` FOREIGN KEY (`user_id`) REFERENCES `users` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ===========================================================
-- TABLE: payments
-- ===========================================================
CREATE TABLE `payments` (
  `id` int NOT NULL AUTO_INCREMENT,
  `enrollment_id` int NOT NULL,
  `user_id` int NOT NULL,
  `fee_type_id` int NOT NULL,
  `amount` decimal(10,2) NOT NULL,
  `payment_method` enum('bank_transfer','aba','acleda','wing','cash','bakong_khqr') COLLATE utf8mb4_unicode_ci DEFAULT 'bakong_khqr',
  `transaction_ref` varchar(255) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `proof_path` varchar(500) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `khqr_md5` varchar(255) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `khqr_string` text COLLATE utf8mb4_unicode_ci,
  `status` enum('pending','verified','rejected') COLLATE utf8mb4_unicode_ci DEFAULT 'pending',
  `admin_notes` text COLLATE utf8mb4_unicode_ci,
  `verified_by` int DEFAULT NULL,
  `verified_at` datetime DEFAULT NULL,
  `paid_at` timestamp NULL DEFAULT CURRENT_TIMESTAMP,
  `created_at` timestamp NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `fee_type_id` (`fee_type_id`),
  KEY `verified_by` (`verified_by`),
  KEY `idx_payments_user` (`user_id`),
  KEY `idx_payments_enrollment` (`enrollment_id`),
  KEY `idx_payments_status` (`status`),
  KEY `idx_payments_khqr_md5` (`khqr_md5`),
  CONSTRAINT `payments_ibfk_1` FOREIGN KEY (`enrollment_id`) REFERENCES `enrollments` (`id`) ON DELETE CASCADE,
  CONSTRAINT `payments_ibfk_2` FOREIGN KEY (`user_id`) REFERENCES `users` (`id`) ON DELETE CASCADE,
  CONSTRAINT `payments_ibfk_3` FOREIGN KEY (`fee_type_id`) REFERENCES `fee_types` (`id`) ON DELETE CASCADE,
  CONSTRAINT `payments_ibfk_4` FOREIGN KEY (`verified_by`) REFERENCES `users` (`id`) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ===========================================================
-- TABLE: telegram_pending
-- ===========================================================
CREATE TABLE `telegram_pending` (
  `id` int NOT NULL AUTO_INCREMENT,
  `phone` varchar(20) COLLATE utf8mb4_unicode_ci NOT NULL,
  `chat_id` varchar(100) COLLATE utf8mb4_unicode_ci NOT NULL,
  `created_at` timestamp NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `idx_telegram_pending_phone` (`phone`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ===========================================================
-- DEFAULT ADMIN ACCOUNT
-- Password: admin123 (CHANGE THIS IMMEDIATELY after first login)
-- ===========================================================
INSERT INTO `users` (`email`, `password`, `role`, `khmer_name`, `english_name`, `phone`, `is_verified`, `username`, `verify_method`)
VALUES (
  'admin@nmu.edu.kh',
  '$2a$12$xo9xBQcdMIxAnLHDYSHneeGmejRDwUtJ1QGHLxPAp4op8DbxRtF/G',
  'admin',
  'អ្នកគ្រប់គ្រង',
  'Administrator',
  '+855',
  1,
  'admin',
  'email'
);

SET FOREIGN_KEY_CHECKS = 1;

-- ===========================================================
-- IMPORTANT: After importing, create a strong admin password:
--   UPDATE users SET password = 'YOUR_BCRYPT_HASH' WHERE email = 'admin@nmu.edu.kh';
-- ===========================================================
