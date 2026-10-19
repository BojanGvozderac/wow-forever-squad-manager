import type { User } from "./auth";
import { db } from "./db";
export type WriteContext = { tokenId: string; requestId: string; toolName: string; idempotencyKey?: string };
// Inputs are parsed before this function; sorting keys makes equivalent objects identical.
function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value && typeof value === "object") return `{${Object.entries(value).filter(([,v]) => v !== undefined).sort(([a],[b]) => a.localeCompare(b)).map(([k,v]) => `${JSON.stringify(k)}:${canonical(v)}`).join(",")}}`;
  return JSON.stringify(value);
}
export async function replayWrite<T>(user: User, input: unknown, context?: WriteContext): Promise<T | null> {
  if (!context) return null;
  if (!context.idempotencyKey || context.idempotencyKey.length > 200) throw new Error("A valid idempotency key is required for creates");
  const row = await db().prepare("SELECT payload,result_json AS resultJson FROM mcp_idempotency WHERE user_id=? AND tool_name=? AND idempotency_key=?")
    .bind(user.id,context.toolName,context.idempotencyKey).first<{payload:string;resultJson:string}>();
  if (!row) return null;
  if (row.payload !== canonical(input)) throw new Error("Idempotency key was already used with a different payload");
  return JSON.parse(row.resultJson) as T;
}
export async function commitWrite<T>(user: User, statement: D1PreparedStatement, resourceId: string, context?: WriteContext, create?: { input: unknown; resultSql: string; bindings: unknown[]; authorize: () => Promise<void> }): Promise<T | null> {
  if (!context) return statement.first<T>();
  const statements = [statement, db().prepare("INSERT INTO mcp_audit(id,user_id,token_id,request_id,tool_name,resource_id) SELECT ?,?,?,?,?,? WHERE changes()>0")
    .bind(crypto.randomUUID(),user.id,context.tokenId,context.requestId,context.toolName,resourceId)];
  if (create) {
    statements.push(db().prepare(`INSERT INTO mcp_idempotency(user_id,tool_name,idempotency_key,payload,result_json) SELECT ?,?,?,?,(${create.resultSql}) WHERE changes()>0`)
      .bind(user.id,context.toolName,context.idempotencyKey,canonical(create.input),...create.bindings));
  }
  try {
    const results = await db().batch<T>(statements);
    return results[0].results[0] ?? null;
  } catch (error) {
    // A concurrent create may have committed the same key first. Its batch wins.
    if (create) {
      await create.authorize();
      const replay = await replayWrite<T>(user,create.input,context);
      if (replay) return replay;
    }
    throw error;
  }
}
