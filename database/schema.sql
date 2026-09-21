CREATE DATABASE IF NOT EXISTS scholarship_system CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
USE scholarship_system;

CREATE TABLE users (
    id INT AUTO_INCREMENT PRIMARY KEY,
    email VARCHAR(255) UNIQUE NOT NULL,
    password VARCHAR(255) NOT NULL,
    role ENUM('student','admin','committee') DEFAULT 'student',
    khmer_name VARCHAR(255),
    english_name VARCHAR(255),
    national_id VARCHAR(100),
    gender ENUM('male', 'female'),
    date_of_birth DATE,
    place_of_birth VARCHAR(255),
    address TEXT,
  phone VARCHAR(20),
  profile_pic VARCHAR(500),
  is_verified TINYINT DEFAULT 0,
    verification_token VARCHAR(255),
    token_expires_at DATETIME,
    reset_token VARCHAR(255),
    reset_token_expires DATETIME,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    INDEX idx_users_email (email),
    INDEX idx_users_role (role),
    INDEX idx_users_national_id (national_id),
    INDEX idx_users_verification_token (verification_token),
    INDEX idx_users_reset_token (reset_token)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE majors (
    id INT AUTO_INCREMENT PRIMARY KEY,
    name_kh VARCHAR(255) NOT NULL,
    name_en VARCHAR(255) NOT NULL,
    faculty_kh VARCHAR(255),
    faculty_en VARCHAR(255),
    is_active TINYINT DEFAULT 1,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    INDEX idx_majors_active (is_active)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE scholarship_categories (
    id INT AUTO_INCREMENT PRIMARY KEY,
    name_kh VARCHAR(255) NOT NULL,
    name_en VARCHAR(255) NOT NULL,
    description_kh TEXT,
    description_en TEXT,
    is_active TINYINT DEFAULT 1,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    INDEX idx_scholarship_categories_active (is_active)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE provinces (
    id INT AUTO_INCREMENT PRIMARY KEY,
    name_kh VARCHAR(255) NOT NULL,
    name_en VARCHAR(255) NOT NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE scholarship_types (
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

CREATE TABLE applications (
    id INT AUTO_INCREMENT PRIMARY KEY,
    user_id INT NOT NULL,
    status ENUM('pending','under_review','approved','rejected','correction_requested') DEFAULT 'pending',
    khmer_first_name VARCHAR(255),
    khmer_last_name VARCHAR(255),
    english_first_name VARCHAR(255),
    english_last_name VARCHAR(255),
    gender ENUM('male','female','other'),
    date_of_birth DATE,
    nationality VARCHAR(100) DEFAULT 'Cambodian',
    national_id VARCHAR(100),
    current_address TEXT,
    phone VARCHAR(20),
    telegram VARCHAR(100),
    email VARCHAR(255),
    parent_name VARCHAR(255),
    parent_phone VARCHAR(20),
    emergency_contact VARCHAR(255),
    emergency_phone VARCHAR(20),
    school_name VARCHAR(255),
    school_province_id INT,
    graduation_year INT,
    exam_result VARCHAR(50),
    major_first_choice_id INT,
    major_second_choice_id INT,
    scholarship_category_id INT,
    scholarship_type_id INT,
    photo_path VARCHAR(500),
    transcript_path VARCHAR(500),
    national_id_path VARCHAR(500),
    additional_documents_path VARCHAR(500),
    admin_remark TEXT,
    correction_notes TEXT,
    exam_date DATE,
    exam_time VARCHAR(20),
    exam_venue VARCHAR(255),
    submitted_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
    FOREIGN KEY (school_province_id) REFERENCES provinces(id) ON DELETE SET NULL,
    FOREIGN KEY (major_first_choice_id) REFERENCES majors(id) ON DELETE SET NULL,
    FOREIGN KEY (major_second_choice_id) REFERENCES majors(id) ON DELETE SET NULL,
    FOREIGN KEY (scholarship_category_id) REFERENCES scholarship_categories(id) ON DELETE SET NULL,
    FOREIGN KEY (scholarship_type_id) REFERENCES scholarship_types(id) ON DELETE SET NULL,
    INDEX idx_applications_user_id (user_id),
    INDEX idx_applications_status (status),
    INDEX idx_applications_submitted_at (submitted_at),
    INDEX idx_applications_school_province (school_province_id),
    INDEX idx_applications_major_first (major_first_choice_id),
    INDEX idx_applications_major_second (major_second_choice_id),
    INDEX idx_applications_scholarship_category (scholarship_category_id),
    INDEX idx_applications_scholarship_type (scholarship_type_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE application_status_history (
    id INT AUTO_INCREMENT PRIMARY KEY,
    application_id INT NOT NULL,
    old_status VARCHAR(50),
    new_status VARCHAR(50) NOT NULL,
    changed_by INT,
    notes TEXT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (application_id) REFERENCES applications(id) ON DELETE CASCADE,
    FOREIGN KEY (changed_by) REFERENCES users(id) ON DELETE SET NULL,
    INDEX idx_status_history_application (application_id),
    INDEX idx_status_history_changed_by (changed_by),
    INDEX idx_status_history_created_at (created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE notifications (
    id INT AUTO_INCREMENT PRIMARY KEY,
    user_id INT NOT NULL,
    title VARCHAR(255) NOT NULL,
    message TEXT NOT NULL,
    is_read TINYINT DEFAULT 0,
    type VARCHAR(50),
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
    INDEX idx_notifications_user_id (user_id),
    INDEX idx_notifications_is_read (is_read),
    INDEX idx_notifications_created_at (created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE settings (
    id INT AUTO_INCREMENT PRIMARY KEY,
    setting_key VARCHAR(100) UNIQUE NOT NULL,
    setting_value TEXT,
    description VARCHAR(255),
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    INDEX idx_settings_key (setting_key)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
