import { describe, expect, it, vi } from "vitest";
import { gameData } from "../src/server/game";
import { foreverProvider, referenceKey } from "../src/server/game/provider";
import { cached, cacheKey } from "../src/server/game/cache";
import {
  scheduledRefresh,
  retryDelay,
  successfulSections,
} from "../src/server/refresh";
function memoryDb() {
  const rows = new Map<
    string,
    { value_json: string; fetched_at: number; expires_at: number }
  >();
  return {
    rows,
    db: {
      prepare: () => {
        let values: unknown[] = [];
        return {
          bind(...args: unknown[]) {
            values = args;
            return this;
          },
          async first() {
            return rows.get(String(values[0])) ?? null;
          },
          async run() {
            rows.set(String(values[0]), {
              value_json: String(values[4]),
              fetched_at: Number(values[5]),
              expires_at: Number(values[6]),
            });
          },
        };
      },
    } as unknown as D1Database,
  };
}
describe("Forever provider", () => {
  it("reports calendar events unsupported without network or cache access", async () => {
    const fetch = vi.spyOn(globalThis, "fetch");
    const prepare = vi.fn(() => { throw new Error("Unexpected cache access"); });
    try {
      expect(foreverProvider.getCapabilities().calendarEvents).toBe(false);
      expect(await gameData({ prepare } as unknown as D1Database).getCalendarEvents({
        region: "eu", ruleset: "normal", from: 0, to: 86400000,
      })).toMatchObject({ status: "unsupported" });
      expect(fetch).not.toHaveBeenCalled();
      expect(prepare).not.toHaveBeenCalled();
    } finally {
      fetch.mockRestore();
    }
  });
  it("reports unsupported without treating arbitrary names as verified", async () => {
    expect(foreverProvider.getCapabilities().lookupCharacter).toBe(false);
    expect(
      (
        await foreverProvider.lookupCharacter({
          region: "eu",
          ruleset: "normal",
          fullName: "Name-Realm",
        })
      ).status,
    ).toBe("unsupported");
    expect(
      (
        await foreverProvider.searchCatalog({
          query: "Sword",
          category: "item",
        })
      ).status,
    ).toBe("unsupported");
    expect(
      (
        await foreverProvider.getAcquisitionSources({
          provider: foreverProvider.id,
          externalId: "1",
          category: "item",
        })
      ).status,
    ).toBe("unsupported");
  });
  it("isolates opaque references and provider contract versions", () => {
    expect(
      referenceKey({ provider: "a", category: "item", externalId: "1" }),
    ).not.toBe(
      referenceKey({ provider: "b", category: "item", externalId: "1" }),
    );
    const key = { type: "item", externalId: "1" };
    expect(cacheKey(foreverProvider, key)).not.toBe(
      cacheKey({ ...foreverProvider, version: "new" }, key),
    );
  });
});
describe("on-demand cache", () => {
  it("caches success seven days and returns stale data without overwriting on a transient failure", async () => {
    const { db, rows } = memoryDb();
    const key = { type: "item", externalId: "opaque" };
    await cached(
      db,
      foreverProvider,
      key,
      async () => ({ status: "ok", data: { title: "Verified record" } }),
      100,
    );
    expect([...rows.values()][0].expires_at).toBe(100 + 7 * 86400);
    const result = await cached(
      db,
      foreverProvider,
      key,
      async () => ({ status: "rate_limited", message: "slow down" }),
      100 + 8 * 86400,
    );
    expect(result).toMatchObject({
      status: "ok",
      stale: true,
      data: { title: "Verified record" },
    });
    expect([...rows.values()][0].fetched_at).toBe(100);
  });
  it("refetches corrupt JSON instead of failing the request", async () => {
    const { db, rows } = memoryDb();
    const key = { type: "item", externalId: "corrupt" };
    rows.set(cacheKey(foreverProvider, key), {
      value_json: "broken",
      fetched_at: 1,
      expires_at: 9999,
    });
    expect(
      await cached(
        db,
        foreverProvider,
        key,
        async () => ({ status: "ok", data: "recovered" }),
        50,
      ),
    ).toMatchObject({ status: "ok", data: "recovered" });
  });
  it("negative-caches not-found for one hour and does not cache unsupported", async () => {
    const { db, rows } = memoryDb();
    await cached(
      db,
      foreverProvider,
      { type: "item", externalId: "missing" },
      async () => ({ status: "not_found", message: "missing" }),
      50,
    );
    expect([...rows.values()][0].expires_at).toBe(3650);
    await cached(
      db,
      foreverProvider,
      { type: "item", externalId: "unsupported" },
      async () => ({ status: "unsupported", message: "unsupported" }),
      50,
    );
    expect(rows.size).toBe(1);
  });
});
describe("refresh scheduling", () => {
  it("backs off with provider retry-after precedence", () => {
    expect([1, 2, 3, 9].map((n) => retryDelay(n))).toEqual([
      300, 900, 3600, 3600,
    ]);
    expect(retryDelay(1, 7200)).toBe(7200);
  });
  it("writes only successful sections so failures preserve previous snapshots", () => {
    expect(
      successfulSections({
        sections: {
          profile: { status: "ok", data: { level: 10 } },
          equipment: {
            status: "upstream_failure",
            message: "temporarily unavailable",
          },
          recipes: { status: "unsupported", message: "not supported" },
        },
      }),
    ).toEqual([["profile", { level: 10 }]]);
  });
});

function refreshDb() {
  const writes: { sql: string; values: unknown[] }[] = [];
  const db = {
    prepare(sql: string) {
      let values: unknown[] = [];
      return {
        sql,
        get values() {
          return values;
        },
        bind(...args: unknown[]) {
          values = args;
          return this;
        },
        async first() {
          return sql.startsWith("UPDATE characters SET lease_token")
            ? {
                id: "character",
                provider: "test",
                external_id: "opaque",
                region: "eu",
                ruleset: "normal",
                name: "Name",
                failure_count: 0,
              }
            : null;
        },
      };
    },
    async batch(statements: { sql: string; values: unknown[] }[]) {
      writes.push(...statements);
    },
  } as unknown as D1Database;
  return { db, writes };
}
describe("refresh outcomes", () => {
  it("continues supported sections hourly when other sections are unsupported", async () => {
    const { db, writes } = refreshDb();
    const provider = {
      ...foreverProvider,
      id: "test",
      getCapabilities: () => ({
        ...foreverProvider.getCapabilities(),
        fetchCharacter: true,
      }),
      fetchCharacter: async () => ({
        status: "ok" as const,
        data: {
          sections: {
            profile: { status: "ok" as const, data: { level: 10 } },
            recipes: { status: "unsupported" as const, message: "Unavailable" },
          },
        },
      }),
    };
    await scheduledRefresh({ DB: db }, { now: 1000, provider: () => provider });
    expect(writes.at(-1)?.values.slice(0, 4)).toEqual([
      "partial",
      null,
      0,
      4600,
    ]);
    expect(
      writes.some(
        (w) =>
          w.sql.includes("status=excluded.status") &&
          w.values[1] === "recipes" &&
          w.values[2] === "unsupported",
      ),
    ).toBe(true);
  });
  it("stops scheduling a wholly unsupported provider", async () => {
    const { db, writes } = refreshDb();
    await scheduledRefresh(
      { DB: db },
      { now: 1000, provider: () => foreverProvider },
    );
    expect(writes.at(-1)?.values[0]).toBe("unsupported");
    expect(writes.at(-1)?.values[3]).toBeNull();
  });
});
