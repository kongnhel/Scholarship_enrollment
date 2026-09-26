-- Migration: scholarship poster image + leader + majors (card content)
-- poster_path : uploaded poster image (ImageKit URL)
-- leader_name : leader offering the scholarship (shown on/near the poster)
-- major_ids   : majors covered, picked from the majors table (comma separated ids)

ALTER TABLE scholarship_types
  ADD COLUMN poster_path VARCHAR(600) NULL AFTER ministry_fee,
  ADD COLUMN leader_name VARCHAR(300) NULL AFTER poster_path;
