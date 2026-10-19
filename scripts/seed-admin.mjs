#!/usr/bin/env node
// Reuse the credential generator; never delete existing users or rotate keys.
process.argv.splice(2, 0, "seed-admin");
await import("./access-keys.mjs");
