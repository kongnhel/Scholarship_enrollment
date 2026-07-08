-- Migration: Add Telegram OTP verification to users table
-- Run this SQL to update the database schema

-- Add Telegram and OTP columns
ALTER TABLE users ADD COLUMN telegram_chat_id VARCHAR(100) NULL AFTER phone;
ALTER TABLE users ADD COLUMN otp_code VARCHAR(10) NULL AFTER telegram_chat_id;
ALTER TABLE users ADD COLUMN otp_expires_at DATETIME NULL AFTER otp_code;
ALTER TABLE users ADD COLUMN otp_attempts INT DEFAULT 0 AFTER otp_expires_at;
ALTER TABLE users ADD COLUMN otp_last_sent_at DATETIME NULL AFTER otp_attempts;

-- Remove old email verification columns (no longer needed)
ALTER TABLE users DROP COLUMN IF EXISTS verification_token;
ALTER TABLE users DROP COLUMN IF EXISTS token_expires_at;

-- Pending Telegram sessions: stores phone→chat_id before user registers
CREATE TABLE IF NOT EXISTS telegram_pending (
    id INT AUTO_INCREMENT PRIMARY KEY,
    phone VARCHAR(20) NOT NULL,
    chat_id VARCHAR(100) NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    INDEX idx_telegram_pending_phone (phone)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
