-- Migration: Add Bakong KHQR support to payments
-- Adds khqr_md5 column and bakong_khqr payment method

ALTER TABLE payments
  ADD COLUMN IF NOT EXISTS khqr_md5 VARCHAR(255) AFTER proof_path,
  ADD COLUMN IF NOT EXISTS khqr_string TEXT AFTER khqr_md5,
  ADD COLUMN IF NOT EXISTS paid_at TIMESTAMP NULL AFTER verified_at;

ALTER TABLE payments
  MODIFY COLUMN payment_method ENUM('bank_transfer','aba','acleda','wing','cash','bakong_khqr') DEFAULT 'bakong_khqr';

CREATE INDEX IF NOT EXISTS idx_payments_khqr_md5 ON payments(khqr_md5);
