-- Email Verification: Add token_expires_at column
-- Run this ONLY if your database already exists from a previous schema
-- that did NOT include token_expires_at. Skip if using the latest schema.sql.
-- NOTE: This will error if the column already exists, which is safe to ignore.

ALTER TABLE users ADD COLUMN token_expires_at DATETIME AFTER verification_token;

-- Update existing unverified users with a fresh 24-hour token
-- (Only if you want to re-enable verification for existing unverified users)
-- UPDATE users SET token_expires_at = DATE_ADD(NOW(), INTERVAL 24 HOUR) WHERE is_verified = 0 AND verification_token IS NOT NULL;
