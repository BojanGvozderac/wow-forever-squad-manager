import {
  getProvider,
  type GameProvider,
  type Result,
  type CharacterSnapshot,
  type Section,
} from "./game/provider";
type RefreshRow = {
  id: string;
  provider: string;
  external_id: string;
  region: "eu";
  ruleset: "normal" | "pvp" | "roleplay";
  name: string;
  failure_count: number;
};
export function retryDelay(failures: number, retryAfterSeconds = 0): number {
  return Math.max(
    [300, 900, 3600][Math.min(Math.max(failures - 1, 0), 2)],
    Math.max(0, retryAfterSeconds),
  );
}
export function successfulSections(
  snapshot: CharacterSnapshot,
): [Section, unknown][] {
  return (Object.entries(snapshot.sections) as [Section, Result<unknown>][])
    .filter(
      (entry): entry is [Section, Extract<Result<unknown>, { status: "ok" }>] =>
        entry[1].status === "ok",
    )
    .map(([section, result]) => [section, result.data]);
}
/** At most one referenced, verified character is claimed per invocation. Lease ownership guards every snapshot write. */
export async function scheduledRefresh(
  env: { DB: D1Database },
  options: {
    now?: number;
    provider?: (id: string) => GameProvider | undefined;
  } = {},
): Promise<void> {
  const db = env.DB;
  const now = options.now ?? Math.floor(Date.now() / 1000);
  const cleanup = await db
    .prepare(
      "INSERT INTO maintenance(name,last_run) VALUES('daily-cleanup',?) ON CONFLICT(name) DO UPDATE SET last_run=excluded.last_run WHERE maintenance.last_run<=? RETURNING name",
    )
    .bind(now, now - 86400)
    .first();
  if (cleanup)
    await db.batch([
      db.prepare("DELETE FROM sessions WHERE expires_at<=?").bind(now),
      db.prepare("DELETE FROM login_limits WHERE resets_at<=?").bind(now),
    ]);
  const token = crypto.randomUUID();
  const row = await db
    .prepare(
      `UPDATE characters SET lease_token=?,lease_until=? WHERE id=(
    SELECT c.id FROM characters c WHERE c.verified=1 AND c.sync_status!='unsupported'
    AND COALESCE(c.next_due,0)<=? AND COALESCE(c.lease_until,0)<=?
    AND EXISTS(SELECT 1 FROM squad_characters sc WHERE sc.character_id=c.id)
    AND NOT EXISTS(SELECT 1 FROM refresh_backoff b WHERE b.provider=c.provider AND b.retry_at>?)
    ORDER BY COALESCE(c.next_due,0),c.id LIMIT 1
  ) AND COALESCE(lease_until,0)<=? RETURNING id,provider,external_id,region,ruleset,name,failure_count`,
    )
    .bind(token, now + 300, now, now, now, now)
    .first<RefreshRow>();
  if (!row) return;
  const provider = (options.provider ?? getProvider)(row.provider);
  let result: Result<CharacterSnapshot>;
  if (!provider || !provider.getCapabilities().fetchCharacter) {
    result = {
      status: "unsupported",
      message:
        "Character refresh is not supported by the configured Forever provider.",
    };
  } else {
    try {
      const signal = AbortSignal.timeout(10_000);
      // Race also bounds a broken adapter that ignores the abort signal.
      result = await Promise.race([
        provider.fetchCharacter(
          {
            provider: row.provider,
            externalId: row.external_id,
            region: row.region,
            ruleset: row.ruleset,
            fullName: row.name,
          },
          signal,
        ),
        new Promise<Result<CharacterSnapshot>>((resolve) =>
          signal.addEventListener(
            "abort",
            () =>
              resolve({
                status: "upstream_failure",
                message: "Game data request timed out.",
              }),
            { once: true },
          ),
        ),
      ]);
    } catch {
      result = {
        status: "upstream_failure",
        message: "Character provider could not be reached.",
      };
    }
  }
  const statements: D1PreparedStatement[] = [];
  let failures = row.failure_count + 1;
  let nextDue: number | null = now + retryDelay(failures);
  let status: string = result.status;
  let error: string | null = result.status === "ok" ? null : result.message;
  let lastSynced: string | null = null;
  if (result.status === "ok") {
    const successes = successfulSections(result.data);
    const sectionFailures = Object.values(result.data.sections).filter(
      (value) => value?.status !== "ok",
    );
    for (const [section, value] of successes) {
      statements.push(
        db
          .prepare(
            `INSERT INTO character_sections(character_id,section,value_json,fetched_at)
        SELECT ?,?,?,? WHERE EXISTS(SELECT 1 FROM characters WHERE id=? AND lease_token=? AND lease_until>?)
        ON CONFLICT(character_id,section) DO UPDATE SET value_json=excluded.value_json,fetched_at=excluded.fetched_at,status='ok',error=NULL`,
          )
          .bind(
            row.id,
            section,
            JSON.stringify(value),
            now,
            row.id,
            token,
            now,
          ),
      );
      if (section === "profile")
        statements.push(
          db
            .prepare(
              "UPDATE characters SET profile_json=? WHERE id=? AND lease_token=? AND lease_until>?",
            )
            .bind(JSON.stringify(value), row.id, token, now),
        );
    }
    for (const [section, failure] of Object.entries(result.data.sections)) {
      if (!failure || failure.status === "ok") continue;
      statements.push(
        db
          .prepare(
            `INSERT INTO character_sections(character_id,section,value_json,fetched_at,status,error)
        SELECT ?,?,'null',0,?,? WHERE EXISTS(SELECT 1 FROM characters WHERE id=? AND lease_token=? AND lease_until>?)
        ON CONFLICT(character_id,section) DO UPDATE SET status=excluded.status,error=excluded.error`,
          )
          .bind(
            row.id,
            section,
            failure.status,
            failure.message,
            row.id,
            token,
            now,
          ),
      );
    }
    const retryableFailures = sectionFailures.filter(
      (value) => value?.status !== "unsupported",
    );
    if (retryableFailures.length === 0 && successes.length > 0) {
      failures = 0;
      nextDue = now + 3600;
      status = sectionFailures.length ? "partial" : "synced";
      lastSynced = new Date(now * 1000).toISOString();
    } else if (
      sectionFailures.length > 0 &&
      sectionFailures.every((value) => value?.status === "unsupported")
    ) {
      nextDue = null;
      status = "unsupported";
      error = "One or more character sections are unsupported.";
    } else {
      status = successes.length ? "partial" : "upstream_failure";
      error = "Some character sections could not be refreshed.";
      const delay = Math.max(
        0,
        ...sectionFailures.map((value) =>
          value ? (value.retryAfterSeconds ?? 0) : 0,
        ),
      );
      nextDue = now + retryDelay(failures, delay);
      if (sectionFailures.some((value) => value?.status === "rate_limited"))
        statements.push(backoff(db, row.provider, nextDue));
    }
  } else if (result.status === "unsupported") nextDue = null;
  else {
    nextDue = now + retryDelay(failures, result.retryAfterSeconds);
    if (result.status === "rate_limited")
      statements.push(backoff(db, row.provider, nextDue));
  }
  statements.push(
    db
      .prepare(
        `UPDATE characters SET sync_status=?,sync_error=?,failure_count=?,next_due=?,
    last_synced_at=COALESCE(?,last_synced_at),lease_token=NULL,lease_until=NULL WHERE id=? AND lease_token=? AND lease_until>?`,
      )
      .bind(status, error, failures, nextDue, lastSynced, row.id, token, now),
  );
  await db.batch(statements);
}
function backoff(
  db: D1Database,
  provider: string,
  retryAt: number,
): D1PreparedStatement {
  return db
    .prepare(
      "INSERT INTO refresh_backoff(provider,retry_at) VALUES(?,?) ON CONFLICT(provider) DO UPDATE SET retry_at=MAX(refresh_backoff.retry_at,excluded.retry_at)",
    )
    .bind(provider, retryAt);
}
