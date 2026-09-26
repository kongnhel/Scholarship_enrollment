-- Migration: per-scholarship scholarship levels (tiers) + majors
-- tier_options : each program carries its own list of selectable options,
--                stored as JSON combos {p: percent, y: years, s: seats}, e.g.
--                [{"p":100,"y":4,"s":5},{"p":50,"y":4,"s":5},{"p":50,"y":2,"s":5}]
--                (50% for 2 years and 50% for 4 years can coexist).
--                Legacy plain lists ("100,60,40") are converted by auto_setup
--                using the program's duration_years.
-- major_ids    : majors covered by the program, picked from the majors
--                table on the majors page (comma separated ids).

ALTER TABLE scholarship_types
  ADD COLUMN tier_options TEXT NULL AFTER poster_path,
  ADD COLUMN major_ids VARCHAR(200) NULL AFTER tier_options;

-- Legacy free-text majors column (replaced by major_ids).
ALTER TABLE scholarship_types DROP COLUMN majors_kh;
