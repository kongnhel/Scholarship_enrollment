-- Migration: align `applications` with the official Google enrollment form
-- (ពាក្យស្នើសុះចុះឈ្មោះចូលរៀន ឆ្នាំសិក្សា ២០២៦-២០២៧)

ALTER TABLE applications
  ADD COLUMN birth_place VARCHAR(255) DEFAULT NULL AFTER date_of_birth,
  ADD COLUMN address_village VARCHAR(255) DEFAULT NULL AFTER current_address,
  ADD COLUMN address_commune VARCHAR(255) DEFAULT NULL AFTER address_village,
  ADD COLUMN address_district VARCHAR(255) DEFAULT NULL AFTER address_commune,
  ADD COLUMN address_province VARCHAR(255) DEFAULT NULL AFTER address_district,
  ADD COLUMN mother_name VARCHAR(255) DEFAULT NULL AFTER parent_name,
  ADD COLUMN occupation VARCHAR(255) DEFAULT NULL AFTER mother_name,
  ADD COLUMN education_level VARCHAR(100) DEFAULT NULL AFTER occupation,
  ADD COLUMN exam_session VARCHAR(100) DEFAULT NULL AFTER school_name,
  ADD COLUMN exam_center VARCHAR(255) DEFAULT NULL AFTER exam_result,
  ADD COLUMN study_level VARCHAR(50) DEFAULT NULL AFTER scholarship_type_id,
  ADD COLUMN study_period VARCHAR(50) DEFAULT NULL AFTER study_level,
  ADD COLUMN study_shift VARCHAR(50) DEFAULT NULL AFTER study_period,
  ADD COLUMN documents_ready TEXT DEFAULT NULL AFTER study_shift,
  ADD COLUMN additional_info TEXT DEFAULT NULL AFTER documents_ready,
  ADD COLUMN declaration_confirmed TINYINT DEFAULT 0 AFTER additional_info,
  ADD COLUMN photo_3x4_path VARCHAR(500) DEFAULT NULL AFTER photo_path;
