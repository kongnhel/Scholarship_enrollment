-- Migration: scholarship level chosen by the student on Step 1
-- ('100' | '60' | '40' | ... — the valid levels are per-program
--  and stored in scholarship_types.tier_options, e.g. "100,60,40").

ALTER TABLE applications
  ADD COLUMN scholarship_option VARCHAR(20) DEFAULT NULL AFTER scholarship_type_id;

-- Legacy free-text note used by the removed "Other" category.
ALTER TABLE applications DROP COLUMN scholarship_option_note;
