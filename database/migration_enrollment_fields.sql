-- Migration: Add new enrollment form fields
-- Adds village, father_name, mother_name, occupation, education_level, guardian_phone

ALTER TABLE enrollments
  ADD COLUMN IF NOT EXISTS village VARCHAR(255) DEFAULT NULL AFTER place_of_birth,
  ADD COLUMN IF NOT EXISTS father_name VARCHAR(255) DEFAULT NULL AFTER commune,
  ADD COLUMN IF NOT EXISTS mother_name VARCHAR(255) DEFAULT NULL AFTER father_name,
  ADD COLUMN IF NOT EXISTS occupation VARCHAR(255) DEFAULT NULL AFTER mother_name,
  ADD COLUMN IF NOT EXISTS education_level VARCHAR(100) DEFAULT NULL AFTER occupation,
  ADD COLUMN IF NOT EXISTS guardian_phone VARCHAR(30) DEFAULT NULL AFTER phone;
