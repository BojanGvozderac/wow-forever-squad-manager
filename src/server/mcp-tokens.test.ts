import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { Miniflare } from "miniflare";
import { readFileSync } from "node:fs";
const state = vi.hoisted(() => ({ db: null as unknown as D1Database, cookies: new Map<string, string>(), origin: "https://team.example" }));
vi.mock("cloudflare:workers", () => ({ env: { get DB() { return state.db; } } }));
vi.mock("@tanstack/react-start/server", () => ({
  getRequest: () => new Request("https://team.example/"),
  getRequestHeader: (name: string) => name === "origin" ? state.origin : undefined,
  getCookie: (name: string) => state.cookies.get(name),
  setCookie: (name: string, value: string) => state.cookies.set(name, value),
  deleteCookie: (name: string) => state.cookies.delete(name),
}));
vi.mock("@tanstack/react-start", () => ({
  createServerOnlyFn: (fn: unknown) => fn,
  createServerFn: () => {
    let schema: { parse: (value: unknown) => unknown } | undefined;
    const builder = {
      validator(value: typeof schema) { schema = value; return builder; },
      handler(fn: (input: { data: unknown }) => unknown) {
        return async (input?: { data: unknown }) => fn({ data: schema ? schema.parse(input?.data) : input?.data });
      },
    };
    return builder;
  },
}));
import { attemptLogin, endSession, sha256 } from "./auth";
import * as auth from "./auth";
import { authenticateMcpRequest, McpAuthError } from "./mcp-tokens";
import { createMcpToken, listMcpTokens, revokeMcpToken } from "./mcp-token-api";
let mf: Miniflare;
const call = (fn: unknown, data?: unknown): Promise<any> => (fn as (input: { data: unknown }) => Promise<any>)({ data });
const request = (token: string) => new Request("https://team.example/mcp", { headers: { authorization: `Bearer ${token}` } });
const create = (overrides = {}) => call(createMcpToken, { name: "Desktop", scopes: ["read"], expiresInDays: 30, ...overrides });
beforeAll(async () => {
  mf = new Miniflare({ modules: true, script: 'export default { fetch() { return new Response("ok") } }', d1Databases: ["DB"], compatibilityDate: "2026-07-30" });
  state.db = (await mf.getD1Database("DB")) as unknown as D1Database;
  await state.db.exec(readFileSync("migrations/0001_initial.sql", "utf8"));
  // D1 exec accepts each table/trigger on its own line.
  const migration = readFileSync("migrations/0007_mcp_tokens.sql", "utf8");
  const statements = migration.match(/CREATE TABLE[\s\S]*?\);|CREATE INDEX[^;]+;|CREATE TRIGGER[^\n]+/g)!;
  for (const sql of statements) await state.db.prepare(sql).run();
});
afterAll(async () => { await mf.dispose(); });
beforeEach(async () => {
  state.cookies.clear();
  state.origin = "https://team.example";
  await state.db.exec("DELETE FROM users; DELETE FROM login_limits;");
  for (const username of ["alice", "bob"]) await state.db.prepare("INSERT INTO users(id,username,key_hash,role) VALUES (?,?,?,'player')").bind(username, username, await sha256(`key-${username}`)).run();
  await attemptLogin("alice", "key-alice");
});
describe("personal MCP tokens", () => {
  it("issues a high entropy secret once and stores only its hash", async () => {
    const token = await create({ scopes: ["read", "wishlist:write", "availability:write"] });
    expect(token.token).toMatch(/^wft_mcp_[A-Za-z0-9_-]{32}$/);
    expect(token.expiresAt - token.createdAt).toBe(30 * 86400);
    const row = await state.db.prepare("SELECT * FROM mcp_tokens WHERE id=?").bind(token.id).first();
    expect(row?.token_hash).toBe(await sha256(token.token));
    expect(JSON.stringify(row)).not.toContain(token.token);
    const listed = await call(listMcpTokens);
    expect(listed).toEqual([expect.objectContaining({ id: token.id, scopes: token.scopes })]);
    expect(JSON.stringify(listed)).not.toContain("token_hash");
    expect(JSON.stringify(listed)).not.toContain(token.token);
    const auth = await authenticateMcpRequest(request(token.token));
    expect(auth).toEqual({ user: { id: "alice", username: "alice", role: "player" }, tokenId: token.id, scopes: token.scopes });
  });
  it("isolates listing and revocation across users", async () => {
    const alice = await create();
    state.cookies.clear();
    await attemptLogin("bob", "key-bob");
    expect(await call(listMcpTokens)).toEqual([]);
    await call(revokeMcpToken, { id: alice.id });
    expect((await authenticateMcpRequest(request(alice.token))).user.id).toBe("alice");
    const bob = await create();
    await call(revokeMcpToken, { id: bob.id });
    await expect(authenticateMcpRequest(request(bob.token))).rejects.toBeInstanceOf(McpAuthError);
  });
  it("requires a browser session and same origin for token writes", async () => {
    const token = await create();
    state.origin = "https://attacker.example";
    await expect(create()).rejects.toThrow("origin");
    await expect(call(revokeMcpToken, { id: token.id })).rejects.toThrow("origin");
    state.origin = "https://team.example";
    state.cookies.clear();
    await expect(call(listMcpTokens)).rejects.toThrow("sign in");
    await expect(create()).rejects.toThrow("sign in");
    await expect(call(revokeMcpToken, { id: token.id })).rejects.toThrow("sign in");
  });
  it("rejects invalid scopes, names and unbounded expiry", async () => {
    for (const values of [{ scopes: [] }, { scopes: ["admin"] }, { name: " " }, { expiresInDays: 0 }, { expiresInDays: 366 }, { expiresInDays: 1.5 }]) await expect(create(values)).rejects.toThrow();
  });
  it("rejects expired, revoked, missing and malformed bearer credentials", async () => {
    const token = await create();
    await state.db.prepare("UPDATE mcp_tokens SET expires_at=? WHERE id=?").bind(Math.floor(Date.now() / 1000), token.id).run();
    for (const req of [request(token.token), request("wrong"), new Request("https://team.example/mcp")]) {
      await expect(authenticateMcpRequest(req)).rejects.toMatchObject({ status: 401, code: "invalid_token" });
    }
    const revoked = await create();
    await call(revokeMcpToken, { id: revoked.id });
    await expect(authenticateMcpRequest(request(revoked.token))).rejects.toBeInstanceOf(McpAuthError);
  });
  it("revokes tokens on access key rotation and account disabling, even after re-enabling", async () => {
    const rotated = await create();
    await state.db.prepare("UPDATE users SET key_hash=? WHERE id='alice'").bind(await sha256("new-key")).run();
    await expect(authenticateMcpRequest(request(rotated.token))).rejects.toBeInstanceOf(McpAuthError);
    state.cookies.clear();
    await attemptLogin("alice", "new-key");
    const disabled = await create();
    await state.db.exec("UPDATE users SET disabled=1 WHERE id='alice'; UPDATE users SET disabled=0 WHERE id='alice';");
    await expect(authenticateMcpRequest(request(disabled.token))).rejects.toBeInstanceOf(McpAuthError);
  });
  it("does not issue a token if the access key rotates after session authentication", async () => {
    const requireUser = auth.requireUser;
    const spy = vi.spyOn(auth, "requireUser").mockImplementationOnce(async () => {
      const user = await requireUser();
      await state.db.prepare("UPDATE users SET key_hash=? WHERE id=?").bind(await sha256("rotated-key"), user.id).run();
      return user;
    });
    try {
      await expect(create()).rejects.toThrow("Account changed");
      expect((await state.db.prepare("SELECT COUNT(*) AS count FROM mcp_tokens").first())?.count).toBe(0);
    } finally {
      spy.mockRestore();
    }
  });
  it("keeps tokens valid after logout and throttles last-used writes", async () => {
    const token = await create();
    await endSession();
    await authenticateMcpRequest(request(token.token));
    const used = await state.db.prepare("SELECT last_used_at FROM mcp_tokens WHERE id=?").bind(token.id).first<{ last_used_at: number }>();
    expect(used!.last_used_at).toBeGreaterThan(0);
    const recent = used!.last_used_at - 60;
    await state.db.prepare("UPDATE mcp_tokens SET last_used_at=? WHERE id=?").bind(recent, token.id).run();
    await authenticateMcpRequest(request(token.token));
    expect(await state.db.prepare("SELECT last_used_at FROM mcp_tokens WHERE id=?").bind(token.id).first()).toEqual({ last_used_at: recent });
    await state.db.prepare("UPDATE mcp_tokens SET last_used_at=? WHERE id=?").bind(recent - 300, token.id).run();
    await authenticateMcpRequest(request(token.token));
    const updated = await state.db.prepare("SELECT last_used_at FROM mcp_tokens WHERE id=?").bind(token.id).first<{ last_used_at: number }>();
    expect(updated!.last_used_at).toBeGreaterThan(recent);
  });
});
