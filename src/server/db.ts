import { env } from "cloudflare:workers";
import { createServerOnlyFn } from "@tanstack/react-start";

export type Database = D1Database;
export const db = createServerOnlyFn((): Database => {
  return (env as unknown as { DB: Database }).DB;
});
export async function required<T>(
  sql: string,
  ...values: unknown[]
): Promise<T> {
  const row = await db()
    .prepare(sql)
    .bind(...values)
    .first<T>();
  if (!row) throw new Error("Not found");
  return row;
}
