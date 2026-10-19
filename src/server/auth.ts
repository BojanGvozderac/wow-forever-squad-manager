import { timingSafeEqual } from "node:crypto";
import {
  deleteCookie,
  getCookie,
  getRequest,
  getRequestHeader,
  setCookie,
} from "@tanstack/react-start/server";
import { db } from "./db";

export type User = { id: string; username: string; role: "admin" | "player" };
export const SESSION_SECONDS = 7 * 24 * 60 * 60;
export async function sha256(value: string): Promise<string> {
  const bytes = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(value),
  );
  return Array.from(new Uint8Array(bytes), (byte) =>
    byte.toString(16).padStart(2, "0"),
  ).join("");
}
export function randomKey(): string {
  return btoa(
    String.fromCharCode(...crypto.getRandomValues(new Uint8Array(24))),
  )
    .replaceAll("+", "-")
    .replaceAll("/", "_")
    .replaceAll("=", "");
}
function secureRequest(): boolean {
  return new URL(getRequest().url).protocol === "https:";
}
function cookieName(): string {
  return secureRequest() ? "__Host-session" : "session";
}
export function assertMutationOrigin(): void {
  const origin = getRequestHeader("origin");
  const expected = new URL(getRequest().url);
  if (!origin) throw new Error("Request origin is required");
  let url: URL;
  try {
    url = new URL(origin);
  } catch {
    throw new Error("Invalid request origin");
  }
  if (url.origin !== expected.origin)
    throw new Error("Request origin does not match");
}
export async function sessionUser(): Promise<User | null> {
  const token = getCookie(cookieName());
  if (!token) return null;
  return db()
    .prepare(
      `SELECT u.id,u.username,u.role FROM sessions s JOIN users u ON u.id=s.user_id WHERE s.token_hash=? AND s.expires_at>? AND u.disabled=0`,
    )
    .bind(await sha256(token), Math.floor(Date.now() / 1000))
    .first<User>();
}
export async function requireUser(admin = false): Promise<User> {
  const user = await sessionUser();
  if (!user) throw new Error("Please sign in");
  if (admin && user.role !== "admin")
    throw new Error("Administrator access required");
  return user;
}
export async function attemptLogin(
  username: string,
  key: string,
): Promise<{ user: User }> {
  assertMutationOrigin();
  const now = Math.floor(Date.now() / 1000);
  const ip = getRequestHeader("cf-connecting-ip") || "local";
  const buckets = [
    { key: `user:${await sha256(username)}`, max: 10 },
    { key: `ip:${await sha256(ip)}`, max: 30 },
  ];
  // Each counter increment is a single atomic SQLite upsert; all attempts count.
  const counts = await db().batch<{ attempts: number }>(
    buckets.map((bucket) =>
      db()
        .prepare(
          `INSERT INTO login_limits(bucket,attempts,resets_at) VALUES (?,1,?) ON CONFLICT(bucket) DO UPDATE SET attempts=CASE WHEN resets_at<=? THEN 1 ELSE attempts+1 END,resets_at=CASE WHEN resets_at<=? THEN excluded.resets_at ELSE resets_at END RETURNING attempts`,
        )
        .bind(bucket.key, now + 900, now, now),
    ),
  );
  if (
    counts.some(
      (count, index) => count.results[0].attempts > buckets[index].max,
    )
  )
    throw new Error("Too many sign-in attempts. Try again in 15 minutes.");
  const hash = await sha256(key);
  const record = await db()
    .prepare(
      "SELECT id,username,role,key_hash,disabled FROM users WHERE username=?",
    )
    .bind(username)
    .first<User & { key_hash: string; disabled: number }>();
  const expectedHash =
    record && /^[a-f0-9]{64}$/.test(record.key_hash)
      ? record.key_hash
      : "0".repeat(64);
  const matches = timingSafeEqual(
    new TextEncoder().encode(hash),
    new TextEncoder().encode(expectedHash),
  );
  if (!record || record.disabled || !matches)
    throw new Error("Invalid username or access key");
  const user: User = {
    id: record.id,
    username: record.username,
    role: record.role,
  };
  const token = randomKey();
  const inserted = await db()
    .prepare(
      "INSERT INTO sessions(token_hash,user_id,expires_at) SELECT ?,?,? WHERE EXISTS(SELECT 1 FROM users WHERE id=? AND key_hash=? AND disabled=0)",
    )
    .bind(await sha256(token), user.id, now + SESSION_SECONDS, user.id, hash)
    .run();
  if (!inserted.meta.changes)
    throw new Error("Account changed. Please sign in again.");
  setCookie(cookieName(), token, {
    httpOnly: true,
    secure: secureRequest(),
    sameSite: "lax",
    path: "/",
    maxAge: SESSION_SECONDS,
  });
  return { user };
}
export async function endSession(): Promise<{ ok: true }> {
  assertMutationOrigin();
  const token = getCookie(cookieName());
  if (token)
    await db()
      .prepare("DELETE FROM sessions WHERE token_hash=?")
      .bind(await sha256(token))
      .run();
  deleteCookie(cookieName(), { path: "/", secure: secureRequest() });
  return { ok: true };
}
