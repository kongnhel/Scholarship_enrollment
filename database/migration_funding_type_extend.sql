-- Migration: Extend funding_type to the 6 official letter templates
-- Run this ONLY if you already ran migration_funding_type.sql with the
-- earlier 3-value enum ('gov_scholarship','nmu_scholarship','self_pay').
-- NOTE: This will error if the column does not exist yet, which is safe to ignore
-- (in that case just run migration_funding_type.sql instead).

ALTER TABLE enrollments
  MODIFY COLUMN funding_type ENUM('gov_scholarship','nmu_scholarship','nmu_scholarship_100','nmu_scholarship_50_4y','nmu_scholarship_50_2y','mekong_scholarship_40_4y','self_pay') NULL;
