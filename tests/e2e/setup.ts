import { execFileSync } from "node:child_process";
import { randomBytes, createHash } from "node:crypto";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

export default async function setup() {
  // Isolated test storage: never seed, rotate, or erase the normal local database.
  const args = ["exec", "wrangler", "d1"];
  execFileSync(
    "pnpm",
    [
      ...args,
      "migrations",
      "apply",
      "DB",
      "--local",
      "--persist-to",
      ".wrangler/e2e",
    ],
    { stdio: "pipe" },
  );
  const statements = [
    "DELETE FROM squads;",
    "DELETE FROM characters;",
    "DELETE FROM users;",
    "DELETE FROM login_limits;",
  ];
  for (const username of ["admin", "player1", "player2"]) {
    const key = randomBytes(24).toString("base64url");
    process.env[`E2E_KEY_${username}`] = key;
    const hash = createHash("sha256").update(key).digest("hex");
    statements.push(
      `INSERT INTO users(id,username,key_hash,role) VALUES ('${username}','${username}','${hash}','${username === "admin" ? "admin" : "player"}');`,
    );
  }
  const directory = mkdtempSync(join(tmpdir(), "war-room-e2e-"));
  try {
    const file = join(directory, "seed.sql");
    writeFileSync(file, statements.join("\n"), { mode: 0o600 });
    execFileSync(
      "pnpm",
      [
        ...args,
        "execute",
        "DB",
        "--local",
        "--persist-to",
        ".wrangler/e2e",
        "--file",
        file,
      ],
      { stdio: "pipe" },
    );
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
}
