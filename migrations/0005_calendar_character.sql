ALTER TABLE availability_entries ADD COLUMN character_id TEXT REFERENCES characters(id) ON DELETE SET NULL;
