ALTER TABLE system_settings
  ADD COLUMN IF NOT EXISTS enrollment_open VARCHAR(1) DEFAULT '0' AFTER registration_end,
  ADD COLUMN IF NOT EXISTS enrollment_start DATETIME DEFAULT NULL AFTER enrollment_open,
  ADD COLUMN IF NOT EXISTS enrollment_end DATETIME DEFAULT NULL AFTER enrollment_start;
