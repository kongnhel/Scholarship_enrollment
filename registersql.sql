

DROP TABLE IF EXISTS `application_status_history`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
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
) ENGINE=InnoDB AUTO_INCREMENT=6 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Dumping data for table `application_status_history`
--

LOCK TABLES `application_status_history` WRITE;
/*!40000 ALTER TABLE `application_status_history` DISABLE KEYS */;
/*!40000 ALTER TABLE `application_status_history` ENABLE KEYS */;
UNLOCK TABLES;

--
-- Table structure for table `applications`
--

DROP TABLE IF EXISTS `applications`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
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
  `national_id` varchar(100) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
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
  `national_id_path` varchar(500) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
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
) ENGINE=InnoDB AUTO_INCREMENT=4 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Dumping data for table `applications`
--

LOCK TABLES `applications` WRITE;
/*!40000 ALTER TABLE `applications` DISABLE KEYS */;
/*!40000 ALTER TABLE `applications` ENABLE KEYS */;
UNLOCK TABLES;

--
-- Table structure for table `enrollments`
--

DROP TABLE IF EXISTS `enrollments`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
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
) ENGINE=InnoDB AUTO_INCREMENT=7 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Dumping data for table `enrollments`
--

LOCK TABLES `enrollments` WRITE;
/*!40000 ALTER TABLE `enrollments` DISABLE KEYS */;
INSERT INTO `enrollments` VALUES (6,24,NULL,'2026-2027','1','ញិល គង់',NULL,'Nhel Kong',NULL,'male','2004-11-04','fd','+855089204612',NULL,'test','test','test',NULL,NULL,NULL,NULL,NULL,NULL,NULL,'អភិវឌ្ឍន៍កម្មវិធីកុំព្យូទ័រនិងទូរស័ព្ទដៃ',NULL,NULL,NULL,NULL,NULL,NULL,NULL,'pending',NULL,'2026-09-20 05:15:04','2026-09-20 05:15:04','test','test','test','test','upper_secondary','04847774','2022','C','ស្វាយចេក','បជ','តេស្ត','bachelor','mon_fri','morning','transcript,birth_cert,photo_4x6,photo_3x4','ដាក',1,'https://ik.imagekit.io/wchfd9jcn/scholarship/enrollments/e4337662-b0fe-42f3-952c-944e7db0e518.jpg','https://ik.imagekit.io/wchfd9jcn/scholarship/enrollments/2933f988-5e2e-4301-8be8-72f8a29919f2.jpg','https://ik.imagekit.io/wchfd9jcn/scholarship/enrollments/6aa08632-fd55-4fad-9395-8a95077b0276.png','https://ik.imagekit.io/wchfd9jcn/scholarship/enrollments/f7a3c2cb-0fa1-45c7-902a-081921cb9128.png');
/*!40000 ALTER TABLE `enrollments` ENABLE KEYS */;
UNLOCK TABLES;

--
-- Table structure for table `fee_types`
--

DROP TABLE IF EXISTS `fee_types`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
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
) ENGINE=InnoDB AUTO_INCREMENT=9 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Dumping data for table `fee_types`
--

LOCK TABLES `fee_types` WRITE;
/*!40000 ALTER TABLE `fee_types` DISABLE KEYS */;
INSERT INTO `fee_types` VALUES (8,'ថ្លៃសិក្សា','Tuition Fee',0.00,'ថ្លៃសិក្សាប្រចាំឆ្នាំសម្រាប់និស្សិតអាហារូបករណ៍',1,'2026-07-08 09:16:31','2026-07-08 09:16:31');
/*!40000 ALTER TABLE `fee_types` ENABLE KEYS */;
UNLOCK TABLES;

--
-- Table structure for table `major_tuition`
--

DROP TABLE IF EXISTS `major_tuition`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
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
) ENGINE=InnoDB AUTO_INCREMENT=15 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Dumping data for table `major_tuition`
--

LOCK TABLES `major_tuition` WRITE;
/*!40000 ALTER TABLE `major_tuition` DISABLE KEYS */;
INSERT INTO `major_tuition` VALUES (13,14,'2025-2026',1600000.00,1,'2026-07-08 10:48:22','2026-07-08 10:48:22'),(14,13,'2025-2026',1600000.00,1,'2026-07-08 10:48:43','2026-07-08 10:48:43');
/*!40000 ALTER TABLE `major_tuition` ENABLE KEYS */;
UNLOCK TABLES;

--
-- Table structure for table `majors`
--

DROP TABLE IF EXISTS `majors`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
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
) ENGINE=InnoDB AUTO_INCREMENT=15 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Dumping data for table `majors`
--

LOCK TABLES `majors` WRITE;
/*!40000 ALTER TABLE `majors` DISABLE KEYS */;
INSERT INTO `majors` VALUES (13,'អភិវឌ្ឍន៍កម្មវិធីកុំព្យូទ័រនិងទូរស័ព្ទដៃ','Computer and mobile application development','មហាវិទ្យាល័យវិទ្យាសាស្ត្រ និងបច្ចេកវិទ្យា','Faculty of Science and Technology',1,'2026-07-08 10:47:29'),(14,'អក្សរសាស្រ្តខ្មែរ','Khmer Langauge','មហាវិទ្យាល័យសិល្បៈ មនុស្សសាស្ត្រ និងភាសា','Faculty of Art Humanities and Language',1,'2026-07-08 10:47:43');
/*!40000 ALTER TABLE `majors` ENABLE KEYS */;
UNLOCK TABLES;

--
-- Table structure for table `notifications`
--

DROP TABLE IF EXISTS `notifications`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
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
) ENGINE=InnoDB AUTO_INCREMENT=3 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Dumping data for table `notifications`
--

LOCK TABLES `notifications` WRITE;
/*!40000 ALTER TABLE `notifications` DISABLE KEYS */;
/*!40000 ALTER TABLE `notifications` ENABLE KEYS */;
UNLOCK TABLES;

--
-- Table structure for table `payments`
--

DROP TABLE IF EXISTS `payments`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
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
) ENGINE=InnoDB AUTO_INCREMENT=5 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Dumping data for table `payments`
--

LOCK TABLES `payments` WRITE;
/*!40000 ALTER TABLE `payments` DISABLE KEYS */;
INSERT INTO `payments` VALUES (4,6,24,8,800000.00,'bank_transfer','បានបង់រួចរាល់','https://ik.imagekit.io/wchfd9jcn/scholarship/payments/1718cb3d-8483-4592-aaed-b241579fb0d9.png',NULL,NULL,'pending',NULL,NULL,NULL,'2026-09-20 05:44:07','2026-09-20 05:44:07');
/*!40000 ALTER TABLE `payments` ENABLE KEYS */;
UNLOCK TABLES;

--
-- Table structure for table `provinces`
--

DROP TABLE IF EXISTS `provinces`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `provinces` (
  `id` int NOT NULL AUTO_INCREMENT,
  `name_kh` varchar(255) COLLATE utf8mb4_unicode_ci NOT NULL,
  `name_en` varchar(255) COLLATE utf8mb4_unicode_ci NOT NULL,
  PRIMARY KEY (`id`)
) ENGINE=InnoDB AUTO_INCREMENT=24 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Dumping data for table `provinces`
--

LOCK TABLES `provinces` WRITE;
/*!40000 ALTER TABLE `provinces` DISABLE KEYS */;
INSERT INTO `provinces` VALUES (1,'ភ្នំពេញ','Phnom Penh'),(2,'សៀមរាប','Siem Reap'),(3,'បាត់ដំបង','Battambang'),(4,'កំពង់ចាម','Kampong Cham'),(5,'កំពង់ឆ្នាំង','Kampong Chhnang'),(6,'កំពង់ស្ពឺ','Kampong Speu'),(7,'កំពង់ថម','Kampong Thom'),(8,'កំពត','Kampot'),(9,'កណ្តាល','Kandal'),(10,'កោះកុង','Koh Kong'),(11,'ក្រចេះ','Kratie'),(12,'មណ្ឌលគីរី','Mondulkiri'),(13,'ព្រះវិហារ','Preah Vihear'),(14,'ព្រៃវែង','Prey Veng'),(15,'ពោធិ៍សាត់','Pursat'),(16,'រតនគីរី','Ratanak Kiri'),(17,'ស្ទឹងត្រែង','Stung Treng'),(18,'ស្វាយរៀង','Svay Rieng'),(19,'តាកែវ','Takeo'),(20,'ត្បូងឃ្មុំ','Tboung Khmum'),(21,'ប៉ៃលិន','Pailin'),(22,'ព្រះសីហនុ','Sihanoukville'),(23,'បន្ទាយមានជ័យ','Banteay Meanchey');
/*!40000 ALTER TABLE `provinces` ENABLE KEYS */;
UNLOCK TABLES;

--
-- Table structure for table `scholarship_categories`
--

DROP TABLE IF EXISTS `scholarship_categories`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
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
) ENGINE=InnoDB AUTO_INCREMENT=8 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Dumping data for table `scholarship_categories`
--

LOCK TABLES `scholarship_categories` WRITE;
/*!40000 ALTER TABLE `scholarship_categories` DISABLE KEYS */;
INSERT INTO `scholarship_categories` VALUES (1,'អាហារូបករណ៍ពេញ','Full Scholarship','ទទួលបានអាហារូបករណ៍ពេញដែលរួមបញ្ចូលថ្លៃសិក្សា និងថ្លៃផ្សេងៗ','Full scholarship covering tuition fees and other expenses',1,'2026-07-08 09:16:25'),(2,'អាហារូបករណ៍មួយចំនួន','Partial Scholarship','ទទួលបានអាហារូបករណ៍មួយចំនួនសម្រាប់ថ្លៃសិក្សា','Partial scholarship for tuition fees',1,'2026-07-08 09:16:25'),(3,'អាហារូបករណ៍សិស្សក្រីក្រ','Poor Family Scholarship (Financial Hardship)','សម្រាប់សិស្សដែលមានជីវភាពខ្វះខាត','For students from economically disadvantaged families',1,'2026-07-08 09:16:25'),(4,'អាហារូបករណ៍សមត្ថភាពសិក្សាល្អ','Outstanding Academic Achievement Scholarship','សម្រាប់សិស្សដែលមានលទ្ធផលសិក្សាល្អប្រសើរ','For students with excellent academic performance',1,'2026-07-08 09:16:25'),(5,'អាហារូបករណ៍សិស្សស្រី','Female Student Scholarship','សម្រាប់សិស្សស្រីដែលមានសមត្ថភាព','For female students with outstanding abilities',1,'2026-07-08 09:16:25'),(6,'អាហារូបករណ៍សិស្សពិការ','Scholarship for Students with Disabilities','សម្រាប់សិស្សដែលមានពិការភាព','For students with disabilities',1,'2026-07-08 09:16:25'),(7,'អាហារូបករណ៍ផ្សេងៗ','Other Categories','ប្រភេទអាហារូបករណ៍ផ្សេងៗដែលកំណត់ដោយសាកលវិទ្យាល័យ','Other scholarship categories as defined by the university',1,'2026-07-08 09:16:25');
/*!40000 ALTER TABLE `scholarship_categories` ENABLE KEYS */;
UNLOCK TABLES;

--
-- Table structure for table `scholarship_types`
--

DROP TABLE IF EXISTS `scholarship_types`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
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
) ENGINE=InnoDB AUTO_INCREMENT=6 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Dumping data for table `scholarship_types`
--

LOCK TABLES `scholarship_types` WRITE;
/*!40000 ALTER TABLE `scholarship_types` DISABLE KEYS */;
INSERT INTO `scholarship_types` VALUES (1,'អាហារូបករណ៍៤០% សិក្សារយៈពេល៤ឆ្នាំ របស់អង្គការកុមារមេគង្គកម្ពុជា','40% Scholarship for 4 Years - Mekong Child Organization',40,4,'អង្គការកុមារមេគង្គកម្ពុជា',0.00,'អាហារូបករណ៍៤០% សម្រាប់សិស្សដែលមានលទ្ធផលសិក្សាល្អ សិក្សារយៈពេល៤ឆ្នាំ អង្គការកុមារមេគង្គកម្ពុជា',1,'2026-07-08 09:16:25','2026-07-08 10:33:58'),(2,'អាហារូបករណ៍៥០% សិក្សារយៈពេល២ឆ្នាំ របស់សាកលវិទ្យាល័យជាតិមានជ័យ','50% Scholarship for 2 Years - NMU',50,2,'សាកលវិទ្យាល័យជាតិមានជ័យ',0.00,'អាហារូបករណ៍៥០% សម្រាប់និស្សិតសាកលវិទ្យាល័យជាតិមានជ័យ សិក្សារយៈពេល២ឆ្នាំ',1,'2026-07-08 09:16:25','2026-07-08 09:16:25'),(3,'អាហារូបករណ៍១០០% សិក្សារយៈពេល៤ឆ្នាំ របស់ក្រសួង','100% Full Scholarship for 4 Years - Ministry of Education',100,4,'ក្រសួងអប់រំ យុវជន និងកីឡា',200000.00,'អាហារូបករណ៍ពេញ១០០% សម្រាប់សិស្សពូកែ សិក្សារយៈពេល៤ឆ្នាំ កក្រសួងអប់រំ យុវជន និងកីឡា',1,'2026-07-08 09:16:25','2026-07-08 10:32:41'),(4,'អាហារូបករណ៍៥០% សិក្សារយៈពេល៤ឆ្នាំ របស់សាកលវិទ្យាល័យជាតិមានជ័យ','50% Scholarship for 4 Years - NMU',50,4,'សាកលវិទ្យាល័យជាតិមានជ័យ',0.00,'អាហារូបករណ៍៥០% សិក្សារយៈពេល៤ឆ្នាំ របស់សាកលវិទ្យាល័យជាតិមានជ័យ',1,'2026-07-08 10:38:49','2026-07-08 10:38:49'),(5,'អាហារូបករណ៍១០០% សិក្សារយៈពេល៤ឆ្នាំ របស់សកលវិទ្យាល័យជាតិមានជ័យ','100% Full Scholarship for 4 Years - NMU',100,4,'សាកលវិទ្យាល័យជាតិមានជ័យ',0.00,'អាហារូបករណ៍១០០% សិក្សារយៈពេល៤ឆ្នាំ របស់សកលវិទ្យាល័យជាតិមានជ័យ',1,'2026-07-08 10:40:22','2026-07-08 10:40:22');
/*!40000 ALTER TABLE `scholarship_types` ENABLE KEYS */;
UNLOCK TABLES;

--
-- Table structure for table `settings`
--

DROP TABLE IF EXISTS `settings`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `settings` (
  `id` int NOT NULL AUTO_INCREMENT,
  `setting_key` varchar(100) COLLATE utf8mb4_unicode_ci NOT NULL,
  `setting_value` text COLLATE utf8mb4_unicode_ci,
  `description` varchar(255) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `updated_at` timestamp NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `setting_key` (`setting_key`),
  KEY `idx_settings_key` (`setting_key`)
) ENGINE=InnoDB AUTO_INCREMENT=11 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Dumping data for table `settings`
--

LOCK TABLES `settings` WRITE;
/*!40000 ALTER TABLE `settings` DISABLE KEYS */;
INSERT INTO `settings` VALUES (1,'registration_open','1','Enable or disable student registration','2026-07-08 09:16:25'),(2,'registration_start','2026-06-01T00:00','Registration start date and time','2026-09-06 11:54:29'),(3,'registration_end','2027-02-05T23:59:59','Registration end date and time','2026-09-21 02:36:43'),(4,'enrollment_open','1','Enable or disable enrollment','2026-09-21 02:36:37'),(5,'enrollment_start','2026-09-04T00:00','Enrollment start date','2026-09-06 11:44:22'),(6,'enrollment_end','2027-02-05T23:59:59','Enrollment end date','2026-09-21 02:36:54'),(7,'scholarship_open','1',NULL,'2026-07-15 03:56:45'),(8,'scholarship_start','2026-09-04T08:52',NULL,'2026-09-06 11:44:56'),(9,'scholarship_end','2027-02-04T08:52',NULL,'2026-09-06 11:44:56'),(10,'payment_qr_path','https://ik.imagekit.io/wchfd9jcn/scholarship/payments/cc7de004-442b-4a2d-ba11-7bbd04343b5e.jpg',NULL,'2026-09-21 06:43:55');
/*!40000 ALTER TABLE `settings` ENABLE KEYS */;
UNLOCK TABLES;

--
-- Table structure for table `telegram_pending`
--

DROP TABLE IF EXISTS `telegram_pending`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `telegram_pending` (
  `id` int NOT NULL AUTO_INCREMENT,
  `phone` varchar(20) COLLATE utf8mb4_unicode_ci NOT NULL,
  `chat_id` varchar(100) COLLATE utf8mb4_unicode_ci NOT NULL,
  `created_at` timestamp NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `idx_telegram_pending_phone` (`phone`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Dumping data for table `telegram_pending`
--

LOCK TABLES `telegram_pending` WRITE;
/*!40000 ALTER TABLE `telegram_pending` DISABLE KEYS */;
/*!40000 ALTER TABLE `telegram_pending` ENABLE KEYS */;
UNLOCK TABLES;

--
-- Table structure for table `users`
--

DROP TABLE IF EXISTS `users`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `users` (
  `id` int NOT NULL AUTO_INCREMENT,
  `email` varchar(255) COLLATE utf8mb4_unicode_ci NOT NULL,
  `password` varchar(255) COLLATE utf8mb4_unicode_ci NOT NULL,
  `role` enum('student','admin','committee') COLLATE utf8mb4_unicode_ci DEFAULT 'student',
  `khmer_name` varchar(255) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `english_name` varchar(255) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `national_id` varchar(100) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
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
  KEY `idx_users_reset_token` (`reset_token`),
  KEY `idx_users_national_id` (`national_id`)
) ENGINE=InnoDB AUTO_INCREMENT=26 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Dumping data for table `users`
--

LOCK TABLES `users` WRITE;
/*!40000 ALTER TABLE `users` DISABLE KEYS */;
INSERT INTO `users` VALUES (1,'admin@nmu.edu.kh','$2a$12$xo9xBQcdMIxAnLHDYSHneeGmejRDwUtJ1QGHLxPAp4op8DbxRtF/G','admin','អ្នកគ្រប់គ្រង','Administrator',NULL,NULL,NULL,NULL,NULL,'+855',NULL,'https://ik.imagekit.io/wchfd9jcn/scholarship/profiles/11a1c093-a159-4d33-8abe-12cd640d1dd6.jpg',1,NULL,NULL,NULL,NULL,'2026-07-08 09:16:25','2026-07-08 11:21:02','admin','email',NULL,NULL,NULL,0),(24,'kong@gmail.com','$2a$12$89FXp2OUcl6oeySVLpfPpOZ6DXAu9.uA1Y3UugGrfDp.yAejtQaqG','student','ញិល គង់','Nhel Kong',NULL,'male',NULL,NULL,NULL,'+855089204612',NULL,'https://ik.imagekit.io/wchfd9jcn/scholarship/profiles/7f58ed23-9f26-47ec-bff6-ae5ab9715624.jpg',1,NULL,NULL,NULL,NULL,'2026-09-08 16:53:36','2026-09-20 05:04:32','kong','telegram',NULL,NULL,NULL,0),(25,'nhelkong3@gmail.com','$2a$12$/yoLH.61c7qlKJUHnEikz.H/mQQUvsslxQAB5LQwXpPhCM5imhmTi','student','ញិល គង់','Nhel Kong',NULL,NULL,NULL,NULL,NULL,'+8550383763',NULL,NULL,0,'913a92d5-2e9e-4b3a-b715-db24b56e4d4c','2026-09-09 00:55:41',NULL,NULL,'2026-09-08 16:55:41','2026-09-08 16:55:41','kong2','email',NULL,NULL,NULL,0);
/*!40000 ALTER TABLE `users` ENABLE KEYS */;
UNLOCK TABLES;

--
-- Dumping routines for database 'defaultdb'
--
SET @@SESSION.SQL_LOG_BIN = @MYSQLDUMP_TEMP_LOG_BIN;
/*!40103 SET TIME_ZONE=@OLD_TIME_ZONE */;

/*!40101 SET SQL_MODE=@OLD_SQL_MODE */;
/*!40014 SET FOREIGN_KEY_CHECKS=@OLD_FOREIGN_KEY_CHECKS */;
/*!40014 SET UNIQUE_CHECKS=@OLD_UNIQUE_CHECKS */;
/*!40101 SET CHARACTER_SET_CLIENT=@OLD_CHARACTER_SET_CLIENT */;
/*!40101 SET CHARACTER_SET_RESULTS=@OLD_CHARACTER_SET_RESULTS */;
/*!40101 SET COLLATION_CONNECTION=@OLD_COLLATION_CONNECTION */;
/*!40111 SET SQL_NOTES=@OLD_SQL_NOTES */;

-- Dump completed on 2026-09-21 13:49:45
