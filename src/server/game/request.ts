import type { GameProvider, Result } from "./provider";
/** Shared backoff also applies to interactive requests, not just cron. */
export async function providerRequest<T>(
  db: D1Database,
  provider: GameProvider,
  run: (signal: AbortSignal) => Promise<Result<T>>,
): Promise<Result<T>> {
  const now = Math.floor(Date.now() / 1000);
  const backoff = await db
    .prepare("SELECT retry_at FROM refresh_backoff WHERE provider=?")
    .bind(provider.id)
    .first<{ retry_at: number }>();
  if (backoff && backoff.retry_at > now)
    return {
      status: "rate_limited",
      message: "Game data provider is temporarily rate limited.",
      retryAfterSeconds: backoff.retry_at - now,
    };
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  let result: Result<T>;
  try {
    result = await Promise.race([
      run(controller.signal),
      new Promise<Result<T>>((resolve) => {
        timer = setTimeout(() => {
          controller.abort();
          resolve({
            status: "upstream_failure",
            message: "Game data request timed out.",
          });
        }, 10_000);
      }),
    ]);
  } catch {
    result = {
      status: "upstream_failure",
      message: "Game data provider could not be reached.",
    };
  } finally {
    if (timer) clearTimeout(timer);
  }
  if (result.status === "rate_limited") {
    const retryAt = now + Math.max(300, result.retryAfterSeconds ?? 0);
    await db
      .prepare(
        "INSERT INTO refresh_backoff(provider,retry_at) VALUES(?,?) ON CONFLICT(provider) DO UPDATE SET retry_at=MAX(refresh_backoff.retry_at,excluded.retry_at)",
      )
      .bind(provider.id, retryAt)
      .run();
  }
  return result;
}
