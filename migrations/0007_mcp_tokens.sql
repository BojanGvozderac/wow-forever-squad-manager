CREATE TABLE mcp_tokens (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  token_hash TEXT NOT NULL UNIQUE,
  scopes_json TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL,
  last_used_at INTEGER,
  revoked_at INTEGER
);
CREATE INDEX mcp_tokens_user ON mcp_tokens(user_id);
CREATE TRIGGER rotate_invalidates_mcp_tokens AFTER UPDATE OF key_hash ON users WHEN NEW.key_hash != OLD.key_hash BEGIN UPDATE mcp_tokens SET revoked_at=COALESCE(revoked_at,unixepoch()) WHERE user_id=NEW.id; END;
CREATE TRIGGER disable_invalidates_mcp_tokens AFTER UPDATE OF disabled ON users WHEN NEW.disabled != 0 BEGIN UPDATE mcp_tokens SET revoked_at=COALESCE(revoked_at,unixepoch()) WHERE user_id=NEW.id; END;
