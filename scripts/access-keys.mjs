#!/usr/bin/env node
import { randomBytes, createHash, randomUUID } from "node:crypto";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execFileSync } from "node:child_process";

const [command, ...args] = process.argv.slice(2);
const remote = args.includes("--remote");
const admin = args.includes("--admin");
const names = args.filter((arg) => !["--remote", "--admin"].includes(arg));
if (
  !["seed", "seed-admin", "rotate", "create", "generate"].includes(command) ||
  (!["seed", "seed-admin"].includes(command) && names.length !== 1) ||
  (["seed", "seed-admin"].includes(command) && names.length !== 0)
) {
  console.error(
    "Usage: node scripts/access-keys.mjs seed [--remote] | rotate USERNAME [--remote] | create USERNAME [--admin] [--remote] | generate USERNAME [--admin]",
  );
  process.exit(1);
}
const quote = (value) => `'${value.replaceAll("'", "''")}'`;
const usernames = command === "seed" ? ["admin", "player1", "player2"] : command === "seed-admin" ? ["admin"] : names;
if ((admin && names[0] !== "admin") || (["create", "generate"].includes(command) && names[0] === "admin" && !admin)) {
  console.error("The admin account must be named admin, and admin is reserved for that account.");
  process.exit(1);
}
const credentials = usernames.map((username) => {
  if (!/^[a-z0-9_-]{1,80}$/.test(username))
    throw new Error("Use a lowercase alphanumeric username");
  const key = randomBytes(24).toString("base64url");
  return {
    username,
    key,
    hash: createHash("sha256").update(key).digest("hex"),
  };
});
const sql = credentials
  .map(({ username, hash }) =>
    command !== "rotate"
      ? `INSERT INTO users(id,username,key_hash,role) VALUES (${quote(randomUUID())},${quote(username)},${quote(hash)},${quote((["seed", "seed-admin"].includes(command) ? username === "admin" : admin) ? "admin" : "player")}) ON CONFLICT(username) DO NOTHING RETURNING username;`
      : `UPDATE users SET key_hash=${quote(hash)} WHERE username=${quote(username)} RETURNING username;`,
  )
  .join("\n");
if (command === "generate") {
  console.log("Run this SQL manually in the intended database:");
  console.log(sql);
  console.log("Store this generated key securely:");
  console.log(`${credentials[0].username}: ${credentials[0].key}`);
  process.exit(0);
}
const directory = mkdtempSync(join(tmpdir(), "team-access-"));
try {
  const file = join(directory, "keys.sql");
  writeFileSync(file, sql, { mode: 0o600 });
  const output = execFileSync(
    "pnpm",
    [
      "exec",
      "wrangler",
      "d1",
      "execute",
      "DB",
      remote ? "--remote" : "--local",
      "--file",
      file,
      "--json",
    ],
    { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] },
  );
  const result = JSON.parse(output);
  const changed = credentials.filter((credential) =>
    result.some((item) =>
      item.results?.some((row) => row.username === credential.username),
    ),
  );
  if (command === "rotate" && changed.length === 0)
    throw new Error("Username not found; no key rotated");
  if (changed.length === 0) {
    console.log("No changes. Existing users and keys were preserved.");
    process.exitCode = 0;
  } else {
    console.log(
      "Store these access keys securely. They are shown only here; the database contains SHA-256 hashes.",
    );
    for (const { username, key } of changed) console.log(`${username}: ${key}`);
  }
} finally {
  rmSync(directory, { recursive: true, force: true });
}
