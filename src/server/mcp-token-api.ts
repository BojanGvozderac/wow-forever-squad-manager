import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { assertMutationOrigin, randomKey, requireUser, sessionTokenHash, sha256 } from "./auth";
import { db } from "./db";

export const mcpScopes = ["read", "wishlist:write", "availability:write"] as const;
export type McpScope = (typeof mcpScopes)[number];
export type McpToken = {
  id: string;
  name: string;
  scopes: McpScope[];
  createdAt: number;
  expiresAt: number;
  lastUsedAt: number | null;
  revokedAt: number | null;
};
type TokenRow = {
  id: string;
  name: string;
  scopes_json: string;
  created_at: number;
  expires_at: number;
  last_used_at: number | null;
  revoked_at: number | null;
};
const tokenColumns = "id,name,scopes_json,created_at,expires_at,last_used_at,revoked_at";
export const scopeSchema = z.array(z.enum(mcpScopes)).min(1).max(3);
function metadata(row: TokenRow): McpToken {
  return {
    id: row.id,
    name: row.name,
    scopes: scopeSchema.parse(JSON.parse(row.scopes_json)),
    createdAt: row.created_at,
    expiresAt: row.expires_at,
    lastUsedAt: row.last_used_at,
    revokedAt: row.revoked_at,
  };
}

export const createMcpToken = createServerFn({ method: "POST" })
  .validator(z.object({
    name: z.string().trim().min(1).max(80),
    scopes: scopeSchema,
    expiresInDays: z.number().int().min(1).max(365),
  }))
  .handler(async ({ data }) => {
    assertMutationOrigin();
    const user = await requireUser();
    const sessionHash = await sessionTokenHash();
    const now = Math.floor(Date.now() / 1000);
    const token = `wft_mcp_${randomKey()}`;
    // Recheck account status at insertion in case it changed after session lookup.
    const row = await db().prepare(
      `INSERT INTO mcp_tokens(id,user_id,name,token_hash,scopes_json,created_at,expires_at) SELECT ?,?,?,?,?,?,? WHERE EXISTS (SELECT 1 FROM users u JOIN sessions s ON s.user_id=u.id WHERE u.id=? AND u.disabled=0 AND s.token_hash=? AND s.expires_at>?) RETURNING ${tokenColumns}`,
    ).bind(crypto.randomUUID(), user.id, data.name, await sha256(token), JSON.stringify([...new Set(data.scopes)]), now, now + data.expiresInDays * 86400, user.id, sessionHash, now).first<TokenRow>();
    if (!row) throw new Error("Account changed. Please sign in again.");
    return { ...metadata(row), token };
  });

export const listMcpTokens = createServerFn({ method: "GET" })
  .handler(async () => {
    const user = await requireUser();
    const rows = await db().prepare(`SELECT ${tokenColumns} FROM mcp_tokens WHERE user_id=? ORDER BY created_at DESC,id`).bind(user.id).all<TokenRow>();
    return rows.results.map(metadata);
  });

export const revokeMcpToken = createServerFn({ method: "POST" })
  .validator(z.object({ id: z.string().uuid() }))
  .handler(async ({ data }) => {
    assertMutationOrigin();
    const user = await requireUser();
    // The same response for an unknown or another user's token prevents enumeration.
    await db().prepare("UPDATE mcp_tokens SET revoked_at=COALESCE(revoked_at,?) WHERE id=? AND user_id=?").bind(Math.floor(Date.now() / 1000), data.id, user.id).run();
    return { ok: true as const };
  });

