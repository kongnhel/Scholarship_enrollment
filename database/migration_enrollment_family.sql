-- Migration: Family / sibling / study-history details for printable letter (sections IV, V, VI)
-- father/mother status, job, organization, phone + siblings JSON + study history JSON

ALTER TABLE enrollments
  ADD COLUMN IF NOT EXISTS father_alive VARCHAR(10) DEFAULT NULL AFTER guardian_phone,
  ADD COLUMN IF NOT EXISTS father_job VARCHAR(255) DEFAULT NULL AFTER father_alive,
  ADD COLUMN IF NOT EXISTS father_org VARCHAR(255) DEFAULT NULL AFTER father_job,
  ADD COLUMN IF NOT EXISTS father_phone VARCHAR(30) DEFAULT NULL AFTER father_org,
  ADD COLUMN IF NOT EXISTS mother_alive VARCHAR(10) DEFAULT NULL AFTER father_phone,
  ADD COLUMN IF NOT EXISTS mother_job VARCHAR(255) DEFAULT NULL AFTER mother_alive,
  ADD COLUMN IF NOT EXISTS mother_org VARCHAR(255) DEFAULT NULL AFTER mother_job,
  ADD COLUMN IF NOT EXISTS mother_phone VARCHAR(30) DEFAULT NULL AFTER mother_org,
  ADD COLUMN IF NOT EXISTS siblings_info TEXT DEFAULT NULL AFTER mother_phone,
  ADD COLUMN IF NOT EXISTS study_history TEXT DEFAULT NULL AFTER siblings_info;
