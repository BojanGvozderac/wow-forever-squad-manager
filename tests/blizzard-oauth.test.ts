import { afterEach, expect, it, vi } from "vitest";
import { requestBlizzardToken } from "../src/server/game/blizzard-oauth";

const credentials = { BLIZZARD_API_CLIENT_ID: "test-id", BLIZZARD_API_CLIENT_SECRET: "test-secret" };
afterEach(() => vi.unstubAllGlobals());

it("exchanges client credentials at the fixed endpoint without following redirects", async () => {
  const fetchMock = vi.fn().mockResolvedValue(Response.json({ access_token: "test-token", token_type: "bearer", expires_in: 86400 }));
  vi.stubGlobal("fetch", fetchMock);
  await expect(requestBlizzardToken(credentials)).resolves.toEqual({ accessToken: "test-token", expiresIn: 86400 });
  const [url, options] = fetchMock.mock.calls[0];
  expect(url).toBe("https://oauth.battle.net/token");
  expect(options.redirect).toBe("error");
  expect(options.body.toString()).toBe("grant_type=client_credentials");
  expect(options.headers.Authorization).toBe(`Basic ${btoa("test-id:test-secret")}`);
});

it("does not leak upstream error bodies", async () => {
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("test-secret", { status: 401 })));
  await expect(requestBlizzardToken(credentials)).rejects.toThrow("Blizzard OAuth failed (HTTP 401).");
});

it("rejects malformed token responses", async () => {
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue(Response.json({ access_token: "test-token" })));
  await expect(requestBlizzardToken(credentials)).rejects.toThrow("invalid token response");
});

it("does not request a token without credentials", async () => {
  const fetchMock = vi.fn();
  vi.stubGlobal("fetch", fetchMock);
  await expect(requestBlizzardToken({})).rejects.toThrow("credentials are missing");
  expect(fetchMock).not.toHaveBeenCalled();
});
