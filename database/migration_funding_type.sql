-- Migration: Add funding type selection for Foundation Year enrollment
-- funding_type matches the 6 official letter templates:
--   gov_scholarship       = អាហារូបករណ៍ក្រសួងអប់រំ យុវជន និងកីឡា (អ.យ.ក)
--   nmu_scholarship       = legacy alias of nmu_scholarship_100 (kept for backward compatibility)
--   nmu_scholarship_100   = អាហារូបករណ៍១០០%របស់សាកលវិទ្យាល័យជាតិមានជ័យ
--   nmu_scholarship_50_4y = អាហារូបករណ៍៥០%រយៈពេល៤ឆ្នាំ របស់សាកលវិទ្យាល័យជាតិមានជ័យ
--   nmu_scholarship_50_2y = អាហារូបករណ៍៥០%សិក្សារយៈពេល២ឆ្នាំ របស់សាកលវិទ្យាល័យជាតិមានជ័យ
--   mekong_scholarship_40_4y = អាហារូបករណ៍៤០%រយៈពេល៤ឆ្នាំ របស់អង្គការកុមារមេគង្គកម្ពុជា
--   self_pay              = បង់ថ្លៃ
-- funding_payment_mode = ពេញថ្លៃ (full_pay) / បង់ថ្លៃ (partial_pay) sub-choice
-- major_choice_id stores the majors table ID (major_choice keeps the name for display/back-compat)

ALTER TABLE enrollments
  ADD COLUMN funding_type ENUM('gov_scholarship','nmu_scholarship','nmu_scholarship_100','nmu_scholarship_50_4y','nmu_scholarship_50_2y','mekong_scholarship_40_4y','self_pay') NULL AFTER major_choice,
  ADD COLUMN funding_payment_mode ENUM('full_pay','partial_pay') NULL AFTER funding_type,
  ADD COLUMN major_choice_id INT NULL AFTER funding_payment_mode;

CREATE INDEX idx_enrollments_funding ON enrollments(funding_type);
