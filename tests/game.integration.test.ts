import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { Miniflare } from "miniflare";
import { readFileSync, readdirSync } from "node:fs";
import { scheduledRefresh } from "../src/server/refresh";
import { cached } from "../src/server/game/cache";
import {
  foreverProvider,
  type GameProvider,
} from "../src/server/game/provider";
import { providerRequest } from "../src/server/game/request";
import { gameData, type GameCalendarEvent } from "../src/server/game";
let mf: Miniflare;
let db: D1Database;
const now = 1000;
const provider: GameProvider = {
  ...foreverProvider,
  id: "test",
  getCapabilities: () => ({
    ...foreverProvider.getCapabilities(),
    fetchCharacter: true,
  }),
};
async function addCharacter(id = "one") {
  await db
    .prepare(
      "INSERT INTO characters(id,name,normalized_name,ruleset,verified,provider,external_id,next_due) VALUES(?,?,?,'normal',1,'test',?,0)",
    )
    .bind(id, id, id, id)
    .run();
  await db.prepare("INSERT INTO squad_characters VALUES('s',?)").bind(id).run();
}
async function character(id = "one") {
  return db
    .prepare("SELECT * FROM characters WHERE id=?")
    .bind(id)
    .first<Record<string, unknown>>();
}
beforeEach(async () => {
  mf = new Miniflare({
    modules: true,
    script: 'export default {fetch(){return new Response("test")}}',
    d1Databases: ["DB"],
    compatibilityDate: "2026-08-01",
  });
  db = (await mf.getD1Database("DB")) as unknown as D1Database;
  // D1 exec accepts one statement per line; retain trigger bodies as one unit.
  for (const file of readdirSync("migrations")
    .filter((f) => f.endsWith(".sql"))
    .sort()) {
    const sql = readFileSync(`migrations/${file}`, "utf8");
    const statements = sql.match(/\s*CREATE TRIGGER[^]*?END;|[^;]+;/g) ?? [];
    for (const statement of statements) await db.prepare(statement).run();
  }
  await db
    .prepare("INSERT INTO squads(id,name,ruleset) VALUES('s','Squad','normal')")
    .run();
});
afterEach(async () => {
  await mf.dispose();
});
describe("D1 refresh and cache integration", () => {
  it("caches calendar windows by contract and ruleset and retains stale events after failure", async () => {
    const input = { region: "eu" as const, ruleset: "normal" as const, from: 0, to: 86400000 };
    const events: GameCalendarEvent[] = [{
      id: "event-1", title: "Provider test event", category: "holiday",
      startsAt: 1000, endsAt: 2000, game: "forever", region: "eu",
      sourceUrl: "https://example.test/event-1", retrievedAt: 3000,
    }];
    let calls = 0;
    let failing = false;
    const adapter: GameProvider = {
      ...provider,
      getCapabilities: () => ({ ...provider.getCapabilities(), calendarEvents: true }),
      getCalendarEvents: async (_input, signal) => {
        expect(signal).toBeInstanceOf(AbortSignal);
        calls++;
        return failing
          ? { status: "upstream_failure", message: "offline" }
          : { status: "ok", data: events };
      },
    };
    const service = gameData(db, adapter);
    expect(await service.getCalendarEvents(input)).toMatchObject({ status: "ok", data: events });
    await service.getCalendarEvents(input);
    expect(calls).toBe(1);
    await service.getCalendarEvents({ ...input, ruleset: "pvp" });
    await service.getCalendarEvents({ ...input, to: input.to * 2 });
    await gameData(db, { ...adapter, version: "next" }).getCalendarEvents(input);
    expect(calls).toBe(4);
    const original = (await db.prepare("SELECT value_json FROM game_cache ORDER BY cache_key").all()).results;
    await db.prepare("UPDATE game_cache SET expires_at=0").run();
    failing = true;
    expect(await service.getCalendarEvents(input)).toMatchObject({ status: "ok", stale: true, data: events });
    expect((await db.prepare("SELECT value_json FROM game_cache ORDER BY cache_key").all()).results).toEqual(original);
    expect(await service.getCalendarEvents({ ...input, from: 100, to: 200 })).toMatchObject({ status: "upstream_failure" });
    expect((await db.prepare("SELECT COUNT(*) AS count FROM game_cache").first<{ count: number }>())?.count).toBe(4);
  });
  it("claims at most one lease across concurrent invocations", async () => {
    await addCharacter();
    let calls = 0;
    const adapter = {
      ...provider,
      fetchCharacter: async () => {
        calls++;
        await new Promise((resolve) => setTimeout(resolve, 10));
        return {
          status: "ok" as const,
          data: {
            sections: {
              profile: { status: "ok" as const, data: { level: 12 } },
            },
          },
        };
      },
    };
    await Promise.all([
      scheduledRefresh({ DB: db }, { now, provider: () => adapter }),
      scheduledRefresh({ DB: db }, { now, provider: () => adapter }),
    ]);
    expect(calls).toBe(1);
    expect(await character()).toMatchObject({
      next_due: 4600,
      lease_token: null,
      sync_status: "synced",
    });
  });
  it("retains failed section values and records failure while refreshing supported sections", async () => {
    await addCharacter();
    await db
      .prepare(
        "INSERT INTO character_sections(character_id,section,value_json,fetched_at) VALUES('one','equipment','[1]',100)",
      )
      .run();
    const adapter = {
      ...provider,
      fetchCharacter: async () => ({
        status: "ok" as const,
        data: {
          sections: {
            profile: { status: "ok" as const, data: { level: 12 } },
            equipment: { status: "upstream_failure" as const, message: "down" },
          },
        },
      }),
    };
    await scheduledRefresh({ DB: db }, { now, provider: () => adapter });
    expect(
      await db
        .prepare("SELECT * FROM character_sections WHERE section='equipment'")
        .first(),
    ).toMatchObject({
      value_json: "[1]",
      fetched_at: 100,
      status: "upstream_failure",
    });
    expect(await character()).toMatchObject({
      next_due: 1300,
      sync_status: "partial",
      profile_json: '{"level":12}',
    });
  });
  it("continues supported sections hourly and does not retry wholly unsupported characters", async () => {
    await addCharacter();
    const adapter = {
      ...provider,
      fetchCharacter: async () => ({
        status: "ok" as const,
        data: {
          sections: {
            profile: { status: "ok" as const, data: { level: 12 } },
            recipes: { status: "unsupported" as const, message: "no endpoint" },
          },
        },
      }),
    };
    await scheduledRefresh({ DB: db }, { now, provider: () => adapter });
    expect(await character()).toMatchObject({
      next_due: 4600,
      sync_status: "partial",
    });
    await db.prepare("UPDATE characters SET next_due=0").run();
    await scheduledRefresh(
      { DB: db },
      { now, provider: () => foreverProvider },
    );
    expect(await character()).toMatchObject({
      next_due: null,
      sync_status: "unsupported",
    });
    let calls = 0;
    await scheduledRefresh(
      { DB: db },
      {
        now: 9000,
        provider: () => {
          calls++;
          return adapter;
        },
      },
    );
    expect(calls).toBe(0);
  });
  it("shares provider retry-after backoff across characters and interactive requests", async () => {
    await addCharacter("one");
    await addCharacter("two");
    let calls = 0;
    const adapter = {
      ...provider,
      fetchCharacter: async () => {
        calls++;
        return {
          status: "rate_limited" as const,
          message: "slow",
          retryAfterSeconds: 7200,
        };
      },
    };
    await scheduledRefresh({ DB: db }, { now, provider: () => adapter });
    await scheduledRefresh({ DB: db }, { now: 1060, provider: () => adapter });
    expect(calls).toBe(1);
    expect(
      await db
        .prepare("SELECT retry_at FROM refresh_backoff WHERE provider='test'")
        .first(),
    ).toEqual({ retry_at: 8200 });
    await db
      .prepare("UPDATE refresh_backoff SET retry_at=?")
      .bind(Math.floor(Date.now() / 1000) + 7200)
      .run();
    expect(
      await providerRequest(db, provider, async () => {
        throw new Error("should not run");
      }),
    ).toMatchObject({ status: "rate_limited" });
  });
  it("serves stale cache on upstream failure without replacing the last good record", async () => {
    const key = { type: "item", externalId: "opaque" };
    await cached(
      db,
      provider,
      key,
      async () => ({ status: "ok", data: { title: "Original" } }),
      100,
    );
    expect(
      await cached(
        db,
        provider,
        key,
        async () => ({ status: "upstream_failure", message: "offline" }),
        100 + 8 * 86400,
      ),
    ).toMatchObject({ status: "ok", stale: true, data: { title: "Original" } });
    expect(
      await db.prepare("SELECT fetched_at,expires_at FROM game_cache").first(),
    ).toEqual({ fetched_at: 100, expires_at: 100 + 7 * 86400 });
  });
});
