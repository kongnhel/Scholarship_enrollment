ALTER TABLE settings
  ADD COLUMN enrollment_open VARCHAR(1) DEFAULT '0' AFTER registration_end,
  ADD COLUMN enrollment_start DATETIME DEFAULT NULL AFTER enrollment_open,
  ADD COLUMN enrollment_end DATETIME DEFAULT NULL AFTER enrollment_start;
