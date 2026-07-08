-- Email Verification: Add token_expires_at column
-- Run this if your database already exists and you need to add the new column

ALTER TABLE users ADD COLUMN token_expires_at DATETIME AFTER verification_token;

-- Update existing unverified users with a fresh 24-hour token
-- (Only if you want to re-enable verification for existing unverified users)
-- UPDATE users SET token_expires_at = DATE_ADD(NOW(), INTERVAL 24 HOUR) WHERE is_verified = 0 AND verification_token IS NOT NULL;
