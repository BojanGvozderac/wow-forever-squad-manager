import { beforeEach, describe, expect, it, vi } from "vitest";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
const state = vi.hoisted(() => ({ user: { id: "u1", username: "owner", role: "player" as const }, scopes: ["read"] as string[], save: vi.fn(), get: vi.fn(), updateAvailability: vi.fn(), deleteAvailability: vi.fn() }));
vi.mock("./mcp-tokens", () => {
  class McpAuthError extends Error { status = 401; }
  return { McpAuthError, authenticateMcpRequest: async (request: Request) => {
    if (request.headers.get("authorization") !== "Bearer valid") throw new McpAuthError();
    return { user: state.user, tokenId: "t1", scopes: state.scopes };
  } };
});
vi.mock("./domain", () => ({
  listCharactersForUser: async () => [{ id: "c1", name: "Twin", ownerId: "u1", verified: true, region: "eu", ruleset: "normal" }, { id: "c2", name: "Twin", ownerId: "u2", verified: false, region: "us", ruleset: "normal" }],
  listSquadsForUser: async () => [{ id: "s1", name: "Squad", region: "eu", ruleset: "normal" }],
  getSquadForUser: async () => ({ squad: { id: "s1" }, characters: [{ id: "c1" }] }),
  getCharacterForUser: (...args: unknown[]) => state.get(...args),
  listWishlistForUser: async () => [],
  saveWishlistForUser: (...args: unknown[]) => state.save(...args),
  updateWishlistForUser: vi.fn(), deleteWishlistForUser: vi.fn(),
}));
vi.mock("./calendar", () => ({ getSquadCalendarForUser: vi.fn(), createAvailabilityForUser: vi.fn(), updateAvailabilityForUser: (...args: unknown[]) => state.updateAvailability(...args), deleteAvailabilityForUser: (...args: unknown[]) => state.deleteAvailability(...args) }));
import { handleMcpRequest } from "./mcp";
import { DomainError } from "./domain-errors";
const url = "https://team.example/mcp";
function request(body: unknown, headers: Record<string,string> = {}) {
  return new Request(url, { method: "POST", headers: { Authorization: "Bearer valid", "Content-Type": "application/json", Accept: "application/json, text/event-stream", ...headers }, body: JSON.stringify(body) });
}
async function connect() {
  const client = new Client({ name: "test", version: "1" });
  const transport = new StreamableHTTPClientTransport(new URL(url), { requestInit: { headers: { Authorization: "Bearer valid" } }, fetch: async (input, init) => handleMcpRequest(new Request(input, init)) });
  await client.connect(transport);
  return client;
}
beforeEach(() => { state.scopes = ["read"]; state.save.mockReset(); state.get.mockReset(); state.updateAvailability.mockReset(); state.deleteAvailability.mockReset(); });
describe("MCP Streamable HTTP", () => {
  it("supports official SDK initialize, tools/list and calls without sessions", async () => {
    const client = await connect();
    const tools = await client.listTools();
    expect(tools.tools).toHaveLength(14);
    expect(tools.tools.find(tool => tool.name === "find_characters")?.annotations?.readOnlyHint).toBe(true);
    const found = await client.callTool({ name: "find_characters", arguments: { name: "Twin" } });
    expect(found.structuredContent).toMatchObject({ count: 2, selectionRequired: true });
    const owned = await client.callTool({ name: "find_characters", arguments: { name: "Twin", owned: true, squadId: "s1" } });
    expect(owned.structuredContent).toMatchObject({ count: 1, candidates: [{ id: "c1", ownerId: "u1", verified: true }] });
    await client.close();
  });
  it("authenticates every method and ignores cookie authentication", async () => {
    for (const method of ["POST", "GET", "DELETE", "OPTIONS"]) {
      const response = await handleMcpRequest(new Request(url, { method, headers: { Cookie: "session=valid" } }));
      expect(response.status).toBe(401);
      expect(response.headers.get("www-authenticate")).toContain("Bearer");
    }
  });
  it("rejects foreign origins and body overflow", async () => {
    expect((await handleMcpRequest(request({}, { Origin: "https://evil.example" }))).status).toBe(403);
    expect((await handleMcpRequest(request({ value: "x".repeat(65536) }))).status).toBe(413);
    expect((await handleMcpRequest(new Request(url, { headers: { Authorization: "Bearer valid" } }))).status).toBe(405);
  });
  it("requires scope and rejects offsetless calendar input", async () => {
    const client = await connect();
    const denied = await client.callTool({ name: "add_wishlist_entry", arguments: { characterId: "c1", category: "item", priority: "normal", status: "wanted", title: "Item", idempotencyKey: "retry-1" } });
    expect(denied.isError).toBe(true);
    expect(denied.structuredContent).toMatchObject({ error: { code: "insufficient_scope" } });
    expect(state.save).not.toHaveBeenCalled();
    const invalid = await client.callTool({ name: "get_squad_calendar", arguments: { squadId: "s1", from: "2026-10-19T10:00:00", to: "2026-10-20T10:00:00Z" } });
    expect(invalid.isError).toBe(true);
    await client.close();
  });
  it("passes authenticated write context and keeps internal errors private", async () => {
    state.scopes = ["read", "wishlist:write"];
    state.save.mockResolvedValue({ id: "w1", version: 1 });
    const client = await connect();
    const saved = await client.callTool({ name: "add_wishlist_entry", arguments: { characterId: "c1", category: "item", priority: "normal", status: "wanted", title: "Item", idempotencyKey: "retry-1", userId: "forged", ownerId: "forged" } });
    expect(saved.structuredContent).toMatchObject({ id: "w1", version: 1 });
    expect(state.save).toHaveBeenCalledWith(state.user, expect.not.objectContaining({ idempotencyKey: expect.anything() }), expect.objectContaining({ tokenId: "t1", idempotencyKey: "retry-1", toolName: "add_wishlist_entry", requestId: expect.any(String) }));
    state.get.mockRejectedValue(new Error("D1_ERROR secret SQL"));
    const failed = await client.callTool({ name: "get_character", arguments: { characterId: "c1" } });
    expect(failed.isError).toBe(true);
    expect(JSON.stringify(failed)).not.toContain("secret SQL");
    await client.close();
  });
  it("reports availability authorization and merged interval failures with their domain codes", async () => {
    state.scopes = ["read", "availability:write"];
    const client = await connect();
    state.updateAvailability.mockRejectedValue(new DomainError("forbidden", "Availability changed or you are not its author. Reload the calendar and try again."));
    const denied = await client.callTool({ name: "update_availability", arguments: { id: "other-entry", version: 1, note: "Changed" } });
    expect(denied.structuredContent).toMatchObject({ error: { code: "forbidden" } });
    state.deleteAvailability.mockRejectedValue(new DomainError("forbidden", "Availability changed or you are not its author. Reload the calendar and try again."));
    const deniedDelete = await client.callTool({ name: "delete_availability", arguments: { id: "other-entry", version: 1 } });
    expect(deniedDelete.structuredContent).toMatchObject({ error: { code: "forbidden" } });
    state.updateAvailability.mockRejectedValue(new DomainError("invalid_input", "Availability must last more than zero and at most 48 hours"));
    const invalid = await client.callTool({ name: "update_availability", arguments: { id: "own-entry", version: 1, endsAt: "2026-10-19T09:00:00Z" } });
    expect(invalid.structuredContent).toMatchObject({ error: { code: "invalid_input" } });
    await client.close();
  });
  it("does not issue a session ID", async () => {
    const response = await handleMcpRequest(request({ jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2025-11-25", capabilities: {}, clientInfo: { name: "test", version: "1" } } }));
    expect(response.status).toBe(200);
    expect(response.headers.has("mcp-session-id")).toBe(false);
    expect(response.headers.get("cache-control")).toBe("no-store");
  });
});
