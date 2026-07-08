-- Migration: Add OTP columns + username for dual verification
-- Run this migration to enable both email and Telegram OTP verification

-- Add username column
ALTER TABLE users ADD COLUMN username VARCHAR(50) NULL AFTER english_name;
ALTER TABLE users ADD UNIQUE INDEX idx_users_username (username);

-- Add OTP columns (alongside existing email verification columns)
ALTER TABLE users ADD COLUMN otp_code VARCHAR(10) NULL AFTER phone;
ALTER TABLE users ADD COLUMN otp_expires_at DATETIME NULL AFTER otp_code;
ALTER TABLE users ADD COLUMN otp_attempts INT DEFAULT 0 AFTER otp_expires_at;
ALTER TABLE users ADD COLUMN otp_last_sent_at DATETIME NULL AFTER otp_attempts;
ALTER TABLE users ADD COLUMN verify_method ENUM('email','telegram') DEFAULT 'email' AFTER otp_last_sent_at;
