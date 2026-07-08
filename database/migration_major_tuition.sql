-- Migration: Major Tuition Management
-- Replaces old fee_types system with per-major tuition fees

-- Create major_tuition table
CREATE TABLE IF NOT EXISTS major_tuition (
    id INT AUTO_INCREMENT PRIMARY KEY,
    major_id INT NOT NULL,
    academic_year VARCHAR(20) NOT NULL,
    tuition_per_year DECIMAL(10,2) NOT NULL DEFAULT 0,
    is_active TINYINT DEFAULT 1,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    FOREIGN KEY (major_id) REFERENCES majors(id) ON DELETE CASCADE,
    UNIQUE KEY unique_major_year (major_id, academic_year),
    INDEX idx_major_tuition_active (is_active)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Clean old fee types
DELETE FROM fee_types;

-- Insert single tuition fee type
INSERT INTO fee_types (name_kh, name_en, amount, description, is_active) VALUES
('ថ្លៃសិក្សា', 'Tuition Fee', 0, 'ថ្លៃសិក្សាប្រចាំឆ្នាំសម្រាប់និស្សិតអាហារូបករណ៍', 1);

-- Seed major tuition data (example: 500,000 KHR per year for each major)
INSERT INTO major_tuition (major_id, academic_year, tuition_per_year, is_active) VALUES
(1, '2025-2026', 500000, 1),
(2, '2025-2026', 500000, 1),
(3, '2025-2026', 500000, 1),
(4, '2025-2026', 500000, 1),
(5, '2025-2026', 500000, 1),
(6, '2025-2026', 500000, 1),
(7, '2025-2026', 500000, 1),
(8, '2025-2026', 500000, 1),
(9, '2025-2026', 500000, 1),
(10, '2025-2026', 500000, 1),
(11, '2025-2026', 500000, 1),
(12, '2025-2026', 500000, 1);
