ALTER TABLE characters ADD COLUMN next_due INTEGER;
ALTER TABLE characters ADD COLUMN lease_until INTEGER;
ALTER TABLE characters ADD COLUMN lease_token TEXT;
ALTER TABLE characters ADD COLUMN failure_count INTEGER NOT NULL DEFAULT 0;
CREATE INDEX refresh_due ON characters(next_due) WHERE verified=1;
CREATE TABLE character_sections (
  character_id TEXT NOT NULL REFERENCES characters(id) ON DELETE CASCADE,
  section TEXT NOT NULL,
  value_json TEXT NOT NULL,
  fetched_at INTEGER NOT NULL,
  status TEXT NOT NULL DEFAULT 'ok',
  error TEXT,
  PRIMARY KEY(character_id, section)
);
CREATE TABLE refresh_backoff (
  provider TEXT PRIMARY KEY,
  retry_at INTEGER NOT NULL
);
CREATE TABLE maintenance (name TEXT PRIMARY KEY, last_run INTEGER NOT NULL);
