import { sha256, type User } from "./auth";
import { db } from "./db";
import { scopeSchema, type McpScope } from "./mcp-token-api";
export type { McpScope } from "./mcp-token-api";

export class McpAuthError extends Error {
  readonly status = 401;
  readonly code = "invalid_token";
  constructor() {
    super("A valid MCP bearer token is required.");
    this.name = "McpAuthError";
  }
}

// This path takes an explicit Request: it also works outside TanStack's request context.
export async function authenticateMcpRequest(request: Request): Promise<{
  user: User;
  tokenId: string;
  scopes: McpScope[];
}> {
  const match = /^Bearer (wft_mcp_[A-Za-z0-9_-]{32})$/i.exec(request.headers.get("authorization") ?? "");
  if (!match) throw new McpAuthError();
  const now = Math.floor(Date.now() / 1000);
  const row = await db().prepare(
    "SELECT t.id AS token_id,t.scopes_json,t.last_used_at,u.id,u.username,u.role FROM mcp_tokens t JOIN users u ON u.id=t.user_id WHERE t.token_hash=? AND t.revoked_at IS NULL AND t.expires_at>? AND u.disabled=0",
  ).bind(await sha256(match[1]), now).first<User & { token_id: string; scopes_json: string; last_used_at: number | null }>();
  if (!row) throw new McpAuthError();
  let scopes: McpScope[];
  try {
    scopes = scopeSchema.parse(JSON.parse(row.scopes_json));
  } catch {
    throw new McpAuthError();
  }
  // Frequent reads incur at most one metadata write per token every five minutes.
  if (row.last_used_at === null || row.last_used_at <= now - 300)
    await db().prepare("UPDATE mcp_tokens SET last_used_at=? WHERE id=? AND (last_used_at IS NULL OR last_used_at<=?) AND revoked_at IS NULL AND expires_at>?").bind(now, row.token_id, now - 300, now).run();
  return { user: { id: row.id, username: row.username, role: row.role }, tokenId: row.token_id, scopes };
}
