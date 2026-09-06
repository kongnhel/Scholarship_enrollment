CREATE TABLE IF NOT EXISTS scholarship_types (
    id INT AUTO_INCREMENT PRIMARY KEY,
    name_kh VARCHAR(500) NOT NULL,
    name_en VARCHAR(500),
    coverage_percentage INT NOT NULL DEFAULT 0,
    duration_years INT NOT NULL DEFAULT 1,
    provider_name VARCHAR(500) NOT NULL,
    description TEXT,
    ministry_fee DECIMAL(10,2) DEFAULT 0,
    is_active TINYINT DEFAULT 1,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    INDEX idx_scholarship_types_active (is_active),
    INDEX idx_scholarship_types_provider (provider_name)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

INSERT INTO scholarship_types (name_kh, name_en, coverage_percentage, duration_years, provider_name, description, ministry_fee, is_active) VALUES
('អាហារូបករណ៍៤០% សិក្សារយៈពេល៤ឆ្នាំ របស់អង្គការកុមារមេគង្គកម្ពុជា', '40% Scholarship for 4 Years - Mekong Child Organization', 40, 4, 'អង្គការកុមារមេគង្គកម្ពុជា', 'អាហារូបករណ៍៤០% សម្រាប់សិស្សដែលមានលទ្ធផលសិក្សាល្អ សិក្សារយៈពេល៤ឆ្នាំ', 0, 1),
('អាហារូបករណ៍៥០% សិក្សារយៈពេល២ឆ្នាំ របស់សាកលវិទ្យាល័យជាតិមានជ័យ', '50% Scholarship for 2 Years - NMU', 50, 2, 'សាកលវិទ្យាល័យជាតិមានជ័យ', 'អាហារូបករណ៍៥០% សម្រាប់និស្សិតសាកលវិទ្យាល័យជាតិមានជ័យ សិក្សារយៈពេល២ឆ្នាំ', 0, 1),
('អាហារូបករណ៍១០០% សិក្សារយៈពេល៤ឆ្នាំ របស់រដ្ឋាភិបាល', '100% Full Scholarship for 4 Years - Government', 100, 4, 'រដ្ឋាភិបាលកម្ពុជា', 'អាហារូបករណ៍ពេញ១០០% សម្រាប់សិស្សពូកែ សិក្សារយៈពេល៤ឆ្នាំ', 0, 1);
