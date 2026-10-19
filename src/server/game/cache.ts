import type { GameProvider, Result } from "./provider";
export type CacheIdentity = {
  type: string;
  externalId: string;
  locale?: string;
  region?: string;
  ruleset?: string;
};
export function cacheKey(
  provider: Pick<GameProvider, "id" | "version">,
  key: CacheIdentity,
): string {
  return JSON.stringify([
    provider.id,
    provider.version,
    key.locale ?? "en_GB",
    key.type,
    key.externalId,
    key.region ?? "eu",
    key.ruleset ?? null,
  ]);
}
/** Only successful data and explicit not-found responses are persisted. Errors never replace a good snapshot. */
export async function cached<T>(
  db: D1Database,
  provider: GameProvider,
  key: CacheIdentity,
  fetcher: () => Promise<Result<T>>,
  now = Math.floor(Date.now() / 1000),
): Promise<Result<T>> {
  const id = cacheKey(provider, key);
  const row = await db
    .prepare(
      "SELECT value_json, fetched_at, expires_at FROM game_cache WHERE cache_key=?",
    )
    .bind(id)
    .first<{ value_json: string; fetched_at: number; expires_at: number }>();
  let previous: Result<T> | undefined;
  try {
    const value = row ? (JSON.parse(row.value_json) as Result<T>) : undefined;
    if (value?.status === "ok" || value?.status === "not_found")
      previous = value;
  } catch {
    /* A corrupt cache record is a miss; fetch the original source. */
  }
  if (row && row.expires_at > now && previous) return previous;
  let result: Result<T>;
  try {
    result = await fetcher();
  } catch {
    result = {
      status: "upstream_failure",
      message: "Game data provider could not be reached.",
    };
  }
  if (result.status === "ok" || result.status === "not_found") {
    if (result.status === "ok") result = { ...result, fetchedAt: now };
    const ttl = result.status === "ok" ? 7 * 86400 : 3600;
    await db
      .prepare(
        "INSERT INTO game_cache(cache_key,kind,region,ruleset,value_json,fetched_at,expires_at) VALUES(?,?,?,?,?,?,?) ON CONFLICT(cache_key) DO UPDATE SET value_json=excluded.value_json,fetched_at=excluded.fetched_at,expires_at=excluded.expires_at",
      )
      .bind(
        id,
        key.type,
        key.region ?? "eu",
        key.ruleset ?? null,
        JSON.stringify(result),
        now,
        now + ttl,
      )
      .run();
    return result;
  }
  if (
    previous?.status === "ok" &&
    (result.status === "upstream_failure" || result.status === "rate_limited")
  )
    return { ...previous, stale: true };
  return result;
}
