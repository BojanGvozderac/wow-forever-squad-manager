ALTER TABLE wishlist_entries ADD COLUMN version INTEGER NOT NULL DEFAULT 1 CHECK(version>=1);
CREATE TABLE mcp_audit (id TEXT PRIMARY KEY, user_id TEXT NOT NULL, token_id TEXT NOT NULL, request_id TEXT NOT NULL, tool_name TEXT NOT NULL, resource_id TEXT NOT NULL, created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP);
CREATE INDEX mcp_audit_user ON mcp_audit(user_id,created_at);
CREATE TABLE mcp_idempotency (user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE, tool_name TEXT NOT NULL, idempotency_key TEXT NOT NULL, payload TEXT NOT NULL, result_json TEXT NOT NULL, created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP, PRIMARY KEY(user_id,tool_name,idempotency_key));
