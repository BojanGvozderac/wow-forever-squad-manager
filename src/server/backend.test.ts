import {
  beforeAll,
  afterAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import { Miniflare } from "miniflare";
import { readFileSync } from "node:fs";

const state = vi.hoisted(() => ({
  db: null as unknown as D1Database,
  cookies: new Map<string, string>(),
  headers: new Map<string, string>(),
  cookieOptions: {} as Record<string, unknown>,
  requestUrl: "https://team.example/",
}));
vi.mock("cloudflare:workers", () => ({
  env: {
    get DB() {
      return state.db;
    },
  },
}));
vi.mock("@tanstack/react-start/server", () => ({
  getRequest: () => new Request(state.requestUrl),
  getRequestHeader: (name: string) => state.headers.get(name),
  getCookie: (name: string) => state.cookies.get(name),
  setCookie: (
    name: string,
    value: string,
    options: Record<string, unknown>,
  ) => {
    state.cookies.set(name, value);
    state.cookieOptions = options;
  },
  deleteCookie: (name: string) => state.cookies.delete(name),
}));
vi.mock("@tanstack/react-start", () => ({
  createServerOnlyFn: (fn: unknown) => fn,
  createServerFn: () => {
    let schema: { parse: (value: unknown) => unknown } | undefined;
    const builder = {
      validator(value: typeof schema) {
        schema = value;
        return builder;
      },
      handler(fn: (input: { data: unknown }) => unknown) {
        return async (input?: { data: unknown }) =>
          fn({ data: schema ? schema.parse(input?.data) : input?.data });
      },
    };
    return builder;
  },
}));
import * as api from "./api";
import * as calendar from "./calendar";
import { getSquadGameEvents } from "./game-calendar";
import { attemptLogin, randomKey, requireUser, sha256 } from "./auth";
let mf: Miniflare;
const call = (fn: unknown, data?: unknown) =>
  (fn as (input?: { data: unknown }) => Promise<any>)({ data });
async function signIn(username: string) {
  state.cookies.clear();
  await attemptLogin(username, `key-${username}`);
}
beforeAll(async () => {
  mf = new Miniflare({
    modules: true,
    script: 'export default { fetch() { return new Response("ok") } }',
    d1Databases: ["DB"],
    compatibilityDate: "2026-07-30",
  });
  state.db = (await mf.getD1Database("DB")) as unknown as D1Database;
  await state.db.exec(readFileSync("migrations/0001_initial.sql", "utf8"));
  await state.db.exec(readFileSync("migrations/0003_admin_name.sql", "utf8"));
  for (const sql of readFileSync("migrations/0004_calendar.sql", "utf8").split(";").filter((sql) => sql.trim()))
    await state.db.prepare(sql).run();
  await state.db.exec(readFileSync("migrations/0005_calendar_character.sql", "utf8"));
  for (const sql of readFileSync("migrations/0002_refresh.sql", "utf8")
    .split(";")
    .filter((sql) => sql.trim()))
    await state.db.prepare(sql).run();
});
afterAll(async () => {
  await mf?.dispose();
});
beforeEach(async () => {
  state.cookies.clear();
  state.headers.clear();
  state.headers.set("origin", "https://team.example");
  state.headers.set("cf-connecting-ip", "192.0.2.1");
  state.requestUrl = "https://team.example/";
  for (const table of [
    "availability_entries",
    "wishlist_entries",
    "squad_characters",
    "character_sections",
    "characters",
    "squads",
    "sessions",
    "login_limits",
    "users",
  ])
    await state.db.prepare(`DELETE FROM ${table}`).run();
  for (const [id, role] of [
    ["admin", "admin"],
    ["player1", "player"],
    ["player2", "player"],
  ])
    await state.db
      .prepare("INSERT INTO users(id,username,key_hash,role) VALUES (?,?,?,?)")
      .bind(id, id, await sha256(`key-${id}`), role)
      .run();
});
describe("authentication", () => {
  it("generates 24-byte base64url access keys and fixed lifetime hashed sessions", async () => {
    expect(randomKey()).toMatch(/^[A-Za-z0-9_-]{32}$/);
    const before = Math.floor(Date.now() / 1000);
    await signIn("admin");
    const token = state.cookies.get("__Host-session")!;
    const row = await state.db
      .prepare("SELECT * FROM sessions")
      .first<{ token_hash: string; expires_at: number }>();
    expect(row!.token_hash).toBe(await sha256(token));
    expect(row!.expires_at).toBeGreaterThanOrEqual(before + 604800);
    expect(state.cookieOptions).toMatchObject({
      secure: true,
      httpOnly: true,
      sameSite: "lax",
      path: "/",
      maxAge: 604800,
    });
    await requireUser();
    expect(
      (await state.db
        .prepare("SELECT expires_at FROM sessions")
        .first<{ expires_at: number }>())!.expires_at,
    ).toBe(row!.expires_at);
  });
  it("rejects cross-origin and missing origin mutations", async () => {
    state.headers.set("origin", "http://team.example");
    await expect(attemptLogin("admin", "key-admin")).rejects.toThrow("origin");
    state.headers.delete("origin");
    await expect(attemptLogin("admin", "key-admin")).rejects.toThrow("origin");
  });
  it("expires sessions, revokes rotation and disabled accounts", async () => {
    await signIn("player1");
    await state.db.prepare("UPDATE sessions SET expires_at=0").run();
    expect(await api.getSession()).toEqual({ user: null });
    await signIn("player1");
    await state.db
      .prepare("UPDATE users SET key_hash=? WHERE id=?")
      .bind(await sha256("rotated"), "player1")
      .run();
    expect(await requireUser().catch(() => null)).toBeNull();
    await signIn("player2");
    await state.db
      .prepare("UPDATE users SET disabled=1 WHERE id=?")
      .bind("player2")
      .run();
    expect(await requireUser().catch(() => null)).toBeNull();
    await expect(attemptLogin("player2", "key-player2")).rejects.toThrow(
      "Invalid",
    );
  });
  it("limits username attempts atomically, including concurrent failures", async () => {
    const results = await Promise.allSettled(
      Array.from({ length: 12 }, () => attemptLogin("admin", "wrong")),
    );
    expect(
      results.filter(
        (result) =>
          result.status === "rejected" &&
          String(result.reason).includes("Too many"),
      ),
    ).toHaveLength(2);
    await state.db.prepare("UPDATE login_limits SET resets_at=0").run();
    await signIn("admin");
  });
  it("limits shared IP to thirty attempts across usernames", async () => {
    for (let i = 0; i < 30; i++)
      await attemptLogin(`missing-${i}`, "wrong").catch(() => {});
    await expect(attemptLogin("admin", "key-admin")).rejects.toThrow(
      "Too many",
    );
  });
});
describe("squads, ownership, and stored character constraints", () => {
  it("keeps shared records and wishlist after membership/squad deletion", async () => {
    await signIn("admin");
    const first = await call(api.createSquad, {
      name: "One",
      ruleset: "normal",
    });
    const second = await call(api.createSquad, {
      name: "Two",
      ruleset: "normal",
    });
    const char = await call(api.addPlaceholder, {
      squadId: first.id,
      name: "  Hero-Realm  ",
    });
    const reused = await call(api.addPlaceholder, {
      squadId: second.id,
      name: "hero-realm",
    });
    expect(reused.id).toBe(char.id);
    await expect(
      call(api.updateSquad, { squadId: first.id, name: "One", ruleset: "pvp" }),
    ).rejects.toThrow("ruleset");
    await call(api.assignOwner, { characterId: char.id, ownerId: "player1" });
    await signIn("player1");
    const entry = await call(api.saveWishlistEntry, {
      characterId: char.id,
      category: "item",
      priority: "high",
      status: "wanted",
      title: "Sword",
    });
    await signIn("admin");
    await call(api.deleteSquad, { squadId: first.id });
    await call(api.removeCharacterFromSquad, {
      squadId: second.id,
      characterId: char.id,
    });
    expect((await call(api.listWishlist, { characterId: char.id }))[0].id).toBe(
      entry.id,
    );
    await call(api.deleteCharacter, { characterId: char.id });
    expect(
      await state.db.prepare("SELECT id FROM wishlist_entries").first(),
    ).toBeNull();
  });
  it("only allows the owner to edit a wishlist, including rejecting admin override", async () => {
    await signIn("admin");
    const squad = await call(api.createSquad, {
      name: "One",
      ruleset: "normal",
    });
    const char = await call(api.addPlaceholder, {
      squadId: squad.id,
      name: "Hero",
    });
    await call(api.assignOwner, { characterId: char.id, ownerId: "player1" });
    const input = {
      characterId: char.id,
      category: "other",
      priority: "low",
      status: "wanted",
      title: "Wish",
    };
    await expect(call(api.saveWishlistEntry, input)).rejects.toThrow(
      "Only the character owner",
    );
    await signIn("player2");
    await expect(call(api.saveWishlistEntry, input)).rejects.toThrow(
      "Only the character owner",
    );
    await expect(
      call(api.createSquad, { name: "Denied", ruleset: "normal" }),
    ).rejects.toThrow("Administrator");
    await signIn("player1");
    await call(api.saveWishlistEntry, input);
    await expect(
      call(api.saveWishlistEntry, {
        ...input,
        sourceUrl: "http://unsafe.example/",
      }),
    ).rejects.toThrow("HTTPS");
  });
  it("rejects mismatched memberships, non-EU records, and the 51st stored character", async () => {
    await signIn("admin");
    const normal = await call(api.createSquad, {
      name: "Normal",
      ruleset: "normal",
    });
    const pvp = await call(api.createSquad, { name: "PvP", ruleset: "pvp" });
    const char = await call(api.addPlaceholder, {
      squadId: normal.id,
      name: "Hero",
    });
    await expect(
      call(api.addCharacterToSquad, { squadId: pvp.id, characterId: char.id }),
    ).rejects.toThrow("rulesets");
    await expect(
      state.db
        .prepare(
          "INSERT INTO characters(id,name,normalized_name,region,ruleset) VALUES ('us','US','us','us','normal')",
        )
        .run(),
    ).rejects.toThrow();
    for (let i = 1; i < 50; i++)
      await call(api.addPlaceholder, { squadId: normal.id, name: `Hero-${i}` });
    await expect(
      call(api.addPlaceholder, { squadId: normal.id, name: "Overflow" }),
    ).rejects.toThrow("50");
    await call(api.deleteSquad, { squadId: normal.id });
    expect((await call(api.listCharacters)).length).toBe(50);
  });
});

it("only admins create players, stores a hash, and the generated key signs in", async () => {
  await expect(call(api.createPlayer, { username: "new_player" })).rejects.toThrow("sign in");
  await signIn("player1");
  await expect(call(api.createPlayer, { username: "new_player" })).rejects.toThrow("Administrator");
  await signIn("admin");
  const result = await call(api.createPlayer, { username: "new_player", role: "admin" });
  expect(result.user.role).toBe("player");
  expect(result.key).toMatch(/^[A-Za-z0-9_-]{32}$/);
  const stored = await state.db.prepare("SELECT key_hash FROM users WHERE username=?").bind("new_player").first<{ key_hash: string }>();
  expect(stored?.key_hash).toBe(await sha256(result.key));
  await expect(call(api.createPlayer, { username: "new_player" })).rejects.toThrow("already taken");
  await expect(call(api.createPlayer, { username: "admin" })).rejects.toThrow();
  await expect(call(api.createPlayer, { username: "Invalid Name" })).rejects.toThrow();
  state.headers.set("origin", "https://other.example");
  await expect(call(api.createPlayer, { username: "other" })).rejects.toThrow("origin");
  state.headers.set("origin", "https://team.example");
  state.cookies.clear();
  const login = await attemptLogin("new_player", result.key);
  expect(login.user.username).toBe("new_player");
});

it("reserves the admin database name for the administrator role", async () => {
  await expect(state.db.prepare("UPDATE users SET username='other_admin' WHERE username='admin'").run()).rejects.toThrow();
  await expect(state.db.prepare("UPDATE users SET role='admin' WHERE username='player1'").run()).rejects.toThrow();
});

describe("squad calendar", () => {
  const slot = {
    startsAt: Date.UTC(2026, 9, 19, 18),
    endsAt: Date.UTC(2026, 9, 19, 20),
    activities: [{ category: "dungeon", name: "Stratholme" }],
    note: "Available after dinner",
  };
  async function setupCalendar() {
    await signIn("admin");
    const squad = await call(api.createSquad, { name: "Calendar", ruleset: "normal" });
    const character = await call(api.addPlaceholder, { squadId: squad.id, name: "Calendar Hero" });
    await call(api.assignOwner, { characterId: character.id, ownerId: "player1" });
    return { squadId: squad.id, characterId: character.id };
  }
  const range = (squadId: string) => ({ squadId, from: slot.startsAt, to: slot.endsAt });

  it("requires authentication, permits all players to view, and limits creation to members or admin", async () => {
    const { squadId } = await setupCalendar();
    state.cookies.clear();
    await expect(call(calendar.getSquadCalendar, range(squadId))).rejects.toThrow("sign in");
    await expect(call(calendar.createAvailability, { squadId, ...slot })).rejects.toThrow("sign in");
    await signIn("player2");
    expect(await call(calendar.getSquadCalendar, range(squadId))).toEqual({ entries: [], canCreate: false, ownedCharacters: [] });
    await expect(call(calendar.createAvailability, { squadId, ...slot })).rejects.toThrow("own a character");
    await signIn("player1");
    expect((await call(calendar.getSquadCalendar, range(squadId))).canCreate).toBe(true);
    const own = await call(calendar.createAvailability, { squadId, ...slot, userId: "admin", id: "forged" });
    expect(own).toMatchObject({ userId: "player1", username: "player1", version: 1, ...slot });
    expect(own.id).not.toBe("forged");
    await signIn("admin");
    expect((await call(calendar.getSquadCalendar, range(squadId))).canCreate).toBe(true);
    await call(calendar.createAvailability, { squadId, ...slot });
  });

  it("offers all owned squad characters and validates selections on creation and editing", async () => {
    const { squadId, characterId } = await setupCalendar();
    const alt = await call(api.addPlaceholder, { squadId, name: "Calendar Alt" });
    await call(api.assignOwner, { characterId: alt.id, ownerId: "player1" });
    const foreign = await call(api.addPlaceholder, { squadId, name: "Other Player" });
    await call(api.assignOwner, { characterId: foreign.id, ownerId: "player2" });
    const otherSquad = await call(api.createSquad, { name: "Elsewhere", ruleset: "normal" });
    const elsewhere = await call(api.addPlaceholder, { squadId: otherSquad.id, name: "Elsewhere Hero" });
    await call(api.assignOwner, { characterId: elsewhere.id, ownerId: "player1" });
    await signIn("player1");
    expect((await call(calendar.getSquadCalendar, range(squadId))).ownedCharacters).toEqual([
      { id: alt.id, name: "Calendar Alt" }, { id: characterId, name: "Calendar Hero" },
    ]);
    for (const invalid of [foreign.id, elsewhere.id, "missing"]) {
      await expect(call(calendar.createAvailability, { squadId, ...slot, characterId: invalid })).rejects.toThrow();
    }
    const entry = await call(calendar.createAvailability, { squadId, ...slot, characterId });
    expect(entry).toMatchObject({ characterId, characterName: "Calendar Hero" });
    await expect(call(calendar.updateAvailability, { ...slot, id: entry.id, version: 1, characterId: foreign.id })).rejects.toThrow();
    const changed = await call(calendar.updateAvailability, { ...slot, id: entry.id, version: 1, characterId: alt.id });
    expect(changed).toMatchObject({ characterId: alt.id, characterName: "Calendar Alt", version: 2 });
    await signIn("admin");
    await expect(call(calendar.createAvailability, { squadId, ...slot, characterId })).rejects.toThrow();
    await call(api.assignOwner, { characterId: alt.id, ownerId: "player2" });
    await signIn("player1");
    await expect(call(calendar.updateAvailability, { ...slot, id: entry.id, version: 2, characterId: alt.id })).rejects.toThrow();
    const cleared = await call(calendar.updateAvailability, { ...slot, id: entry.id, version: 2, characterId: null });
    expect(cleared).toMatchObject({ characterId: null, characterName: null });
    const second = await call(calendar.createAvailability, { squadId, ...slot, characterId });
    await signIn("admin");
    await call(api.removeCharacterFromSquad, { squadId, characterId });
    await signIn("player1");
    await expect(call(calendar.updateAvailability, { ...slot, id: second.id, version: 1, characterId })).rejects.toThrow();
    await signIn("admin");
    await call(api.deleteCharacter, { characterId });
    expect((await call(calendar.getSquadCalendar, range(squadId))).entries.find((e: { id: string }) => e.id === second.id)).toMatchObject({ characterId: null, characterName: null });
  });

  it("returns overlapping entries across boundaries and excludes touching endpoints and other squads", async () => {
    const { squadId } = await setupCalendar();
    const other = await call(api.createSquad, { name: "Other", ruleset: "normal" });
    const spanning = await call(calendar.createAvailability, { squadId, ...slot, startsAt: slot.startsAt - 3600000, endsAt: slot.endsAt + 3600000 });
    await call(calendar.createAvailability, { squadId, ...slot, endsAt: slot.startsAt, startsAt: slot.startsAt - 3600000 });
    await call(calendar.createAvailability, { squadId, ...slot, startsAt: slot.endsAt, endsAt: slot.endsAt + 3600000 });
    await call(calendar.createAvailability, { squadId: other.id, ...slot });
    await signIn("player2");
    expect((await call(calendar.getSquadCalendar, range(squadId))).entries.map((entry: { id: string }) => entry.id)).toEqual([spanning.id]);
  });

  it("keeps author access after losing membership and rejects admin override and stale writes", async () => {
    const { squadId, characterId } = await setupCalendar();
    await signIn("player1");
    const entry = await call(calendar.createAvailability, { squadId, ...slot });
    await signIn("admin");
    await expect(call(calendar.updateAvailability, { ...slot, id: entry.id, version: 1 })).rejects.toThrow("author");
    await expect(call(calendar.deleteAvailability, { id: entry.id, version: 1 })).rejects.toThrow("author");
    await call(api.removeCharacterFromSquad, { squadId, characterId });
    await signIn("player2");
    await expect(call(calendar.deleteAvailability, { id: entry.id, version: 1 })).rejects.toThrow("author");
    await signIn("player1");
    expect((await call(calendar.getSquadCalendar, range(squadId))).canCreate).toBe(false);
    const updates = await Promise.allSettled([
      call(calendar.updateAvailability, { ...slot, id: entry.id, version: 1, note: "Changed" }),
      call(calendar.updateAvailability, { ...slot, id: entry.id, version: 1, note: "Concurrent" }),
    ]);
    expect(updates.filter((result) => result.status === "fulfilled")).toHaveLength(1);
    expect(updates.filter((result) => result.status === "rejected")).toHaveLength(1);
    const updated = (await call(calendar.getSquadCalendar, range(squadId))).entries[0];
    expect(updated.version).toBe(2);
    await expect(call(calendar.deleteAvailability, { id: entry.id, version: 1 })).rejects.toThrow("changed");
    await call(calendar.deleteAvailability, { id: entry.id, version: 2 });
    expect((await call(calendar.getSquadCalendar, range(squadId))).entries).toEqual([]);
  });

  it("validates time bounds, duration, activity and note limits, and mutation origins", async () => {
    const { squadId } = await setupCalendar();
    for (const changes of [
      { startsAt: NaN }, { startsAt: Infinity }, { startsAt: 1.5 },
      { startsAt: -8640000000000001 }, { endsAt: 8640000000000001 },
      { endsAt: slot.startsAt }, { endsAt: slot.startsAt - 1 },
      { endsAt: slot.startsAt + 48 * 3600000 + 1 },
      { activities: Array.from({ length: 11 }, () => slot.activities[0]) },
      { activities: [{ category: "raid", name: "x".repeat(121) }] },
      { activities: [{ category: "unknown", name: "test" }] },
      { note: "x".repeat(2001) },
    ]) await expect(call(calendar.createAvailability, { squadId, ...slot, ...changes })).rejects.toThrow();
    for (const changes of [{ to: slot.startsAt }, { to: slot.startsAt + 42 * 86400000 + 1 }, { from: Infinity }])
      await expect(call(calendar.getSquadCalendar, { ...range(squadId), ...changes })).rejects.toThrow();
    const entry = await call(calendar.createAvailability, { squadId, ...slot, endsAt: slot.startsAt + 48 * 3600000 });
    state.headers.set("origin", "https://other.example");
    await expect(call(calendar.createAvailability, { squadId, ...slot })).rejects.toThrow("origin");
    await expect(call(calendar.updateAvailability, { ...slot, id: entry.id, version: 1 })).rejects.toThrow("origin");
    state.headers.delete("origin");
    await expect(call(calendar.deleteAvailability, { id: entry.id, version: 1 })).rejects.toThrow("origin");
  });

  it("cascades entries when a squad or author is deleted and enforces a positive stored interval", async () => {
    const { squadId } = await setupCalendar();
    await signIn("player1");
    await call(calendar.createAvailability, { squadId, ...slot });
    await expect(state.db.prepare("INSERT INTO availability_entries(id,squad_id,user_id,starts_at,ends_at) VALUES ('invalid',?,'player1',1,1)").bind(squadId).run()).rejects.toThrow();
    await state.db.prepare("DELETE FROM users WHERE id='player1'").run();
    expect(await state.db.prepare("SELECT id FROM availability_entries").first()).toBeNull();
    await signIn("admin");
    await call(calendar.createAvailability, { squadId, ...slot });
    await call(api.deleteSquad, { squadId });
    expect(await state.db.prepare("SELECT id FROM availability_entries").first()).toBeNull();
  });
});


describe("squad game events", () => {
  const window = { from: Date.UTC(2026, 9, 19), to: Date.UTC(2026, 9, 26) };

  it("requires authentication and an existing squad", async () => {
    await expect(call(getSquadGameEvents, { squadId: "missing", ...window })).rejects.toThrow("sign in");
    await signIn("player1");
    await expect(call(getSquadGameEvents, { squadId: "missing", ...window })).rejects.toThrow("Not found");
  });

  it("rejects invalid and oversized time windows", async () => {
    await signIn("player1");
    for (const changes of [
      { from: NaN }, { from: Infinity }, { from: 1.5 },
      { from: -8640000000000001 }, { to: 8640000000000001 },
      { to: window.from }, { to: window.from - 1 },
      { to: window.from + 42 * 86400000 + 1 },
    ]) {
      await expect(call(getSquadGameEvents, { squadId: "missing", ...window, ...changes })).rejects.toThrow();
    }
  });

  it("returns the provider's unsupported response for a valid squad to any signed-in player", async () => {
    await signIn("admin");
    const squad = await call(api.createSquad, { name: "Game events", ruleset: "pvp" });
    await signIn("player2");
    const result = await call(getSquadGameEvents, { squadId: squad.id, ...window });
    expect(result.status).toBe("unsupported");
    expect(result.message).toEqual(expect.any(String));
    expect(result).not.toHaveProperty("data");
    expect(await state.db.prepare("SELECT cache_key FROM game_cache WHERE kind='calendar-events'").first()).toBeNull();
  });
});
