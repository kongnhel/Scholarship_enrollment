-- Migration: Enrollment & Payment System
-- Adds fee_types, enrollments, payments tables

CREATE TABLE IF NOT EXISTS fee_types (
    id INT AUTO_INCREMENT PRIMARY KEY,
    name_kh VARCHAR(255) NOT NULL,
    name_en VARCHAR(255),
    amount DECIMAL(10,2) NOT NULL DEFAULT 0,
    description TEXT,
    is_active TINYINT DEFAULT 1,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    INDEX idx_fee_types_active (is_active)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS enrollments (
    id INT AUTO_INCREMENT PRIMARY KEY,
    user_id INT NOT NULL,
    application_id INT,
    academic_year VARCHAR(20) NOT NULL,
    semester VARCHAR(20) NOT NULL,
    status ENUM('pending','approved','rejected') DEFAULT 'pending',
    admin_notes TEXT,
    enrolled_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
    FOREIGN KEY (application_id) REFERENCES applications(id) ON DELETE SET NULL,
    INDEX idx_enrollments_user (user_id),
    INDEX idx_enrollments_status (status)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS payments (
    id INT AUTO_INCREMENT PRIMARY KEY,
    enrollment_id INT NOT NULL,
    user_id INT NOT NULL,
    fee_type_id INT NOT NULL,
    amount DECIMAL(10,2) NOT NULL,
    payment_method ENUM('bank_transfer','aba','acleda','wing','cash') DEFAULT 'bank_transfer',
    transaction_ref VARCHAR(255),
    proof_path VARCHAR(500),
    status ENUM('pending','verified','rejected') DEFAULT 'pending',
    admin_notes TEXT,
    verified_by INT,
    verified_at DATETIME,
    paid_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (enrollment_id) REFERENCES enrollments(id) ON DELETE CASCADE,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
    FOREIGN KEY (fee_type_id) REFERENCES fee_types(id) ON DELETE CASCADE,
    FOREIGN KEY (verified_by) REFERENCES users(id) ON DELETE SET NULL,
    INDEX idx_payments_user (user_id),
    INDEX idx_payments_enrollment (enrollment_id),
    INDEX idx_payments_status (status)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Seed fee types based on the PDF form
INSERT INTO fee_types (name_kh, name_en, amount, description, is_active) VALUES
('ថ្លៃសៀវភៅសិក្សា', 'Study Book Fee', 5000, 'ថ្លៃសៀវភៅសិក្សា (សៀវភៅកត់ត្រា)', 1),
('ថ្លៃប័ណ្ណសម្គាល់អត្តសញ្ញាណ ឬសំបុត្រកំណើត', 'ID Card or Birth Certificate Fee', 5000, 'ថ្លៃសម្គាល់អត្តសញ្ញាណប័ណ្ណ ឬសំបុត្រកំណើត', 1),
('ថ្លៃរូបថត', 'Photo Fee', 5000, 'ថ្លៃរូបថត ៤×៦', 1),
('ថ្លៃការងារស្រាវជ្រាវ', 'Research Work Fee', 5000, 'ថ្លៃការងារស្រាវជ្រាវសិក្សា', 1),
('ថ្លៃប័ណ្ណសម្គាល់សិស្ស ឆ្នាំទី ១', 'Student ID Card Fee (Year 1)', 5000, 'ថ្លៃប័ណ្ណសម្គាល់សិស្ស (ឆ្នាំទី ១ សាលាក្រុង សាលាខេត្ត)', 1),
('ថ្លៃប័ណ្ណសម្គាល់សិស្ស ឆ្នាំទី ២', 'Student ID Card Fee (Year 2)', 5000, 'ថ្លៃប័ណ្ណសម្គាល់សិស្ស (ឆ្នាំទី ២ សាលាខេត្ត សាលាខេត្ត)', 1),
('ថ្លៃសិក្សា', 'Tuition Fee', 500000, 'ថ្លៃសិក្សាមួយឆ្នាំសម្រាប់និស្សិតអាហារូបករណ៍', 1);
