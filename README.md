# WoW Forever — The War Room

A private squad roster and upgrade wishlist for official EU Forever, built with pnpm, TanStack Start, React, WarcraftCN, and Cloudflare D1 (SQLite).

## Current data availability

Squads, shared name-only character placeholders, ownership, login, and custom wishlists work without an external API. **Live character lookup, equipment, images, catalog search, and automatic acquisition discovery are unavailable until a documented Forever provider is verified and configured.** The app does not substitute retail/Classic data or invented character records. See [data-source audit](docs/data-sources.md).

The cache and scheduled refresh infrastructure are implemented for a verified provider. Unsupported providers do not repeatedly fetch, and placeholders are never refreshed as if they were real profiles.

## Local setup

Use Node.js 22.12 or newer and pnpm 10.33.0.

```sh
pnpm install --frozen-lockfile
pnpm db:migrate
pnpm keys:seed-admin
pnpm dev
```

Open http://127.0.0.1:3000. Save the generated keys in a password manager. The seed creates only `admin` with the administrator role. Its key is shown once and only its hash is stored. Rerunning the seed preserves existing accounts and keys; it does not delete players. Sign in as admin and use **Create player** to add player accounts. Save each generated login key before closing the dialog and share it with that player. Public registration is disabled.

```sh
# Generate a replacement key and revoke this user's existing sessions
pnpm keys:rotate admin
```

To insert another account manually, run `node scripts/access-keys.mjs generate username` (optionally `--admin`). It prints an INSERT statement containing only the hash and shows the generated login key separately. Run that SQL in your chosen database. The `create` command executes the same insertion for you; neither operation exposes a registration endpoint.

These credentials are high-entropy random keys, not human-chosen passwords. Do not replace them with memorable passwords: the fast SHA-256 verifier is designed specifically for generated 192-bit secrets.

Local data lives in `.wrangler/state/` and is ignored by Git. Production uses a separate D1 database. No Battle.net credentials are currently required because the unverified integration is disabled.

## Blizzard OAuth preparation

Optional Blizzard credentials belong in the ignored `.env.local` file, using `BLIZZARD_API_CLIENT_ID` and `BLIZZARD_API_CLIENT_SECRET` (see `.env.example`). Run `pnpm blizzard:check` to verify the client-credentials exchange. It prints only the result and token lifetime; tokens are never saved. This does not enable Forever data fetching or Battle.net login for users.

The Cloudflare Vite plugin loads `.env.local` into server bindings. Do not add a `.dev.vars` file alongside it, because that takes precedence over `.env` files. Never prefix these credentials with `VITE_`. For deployment, set each credential using `pnpm exec wrangler secret put BLIZZARD_API_CLIENT_ID` and `pnpm exec wrangler secret put BLIZZARD_API_CLIENT_SECRET`; local secrets are not deployed automatically.

## Permissions and behavior

- All accounts view all squads, characters, and wishlists.
- Admin creates player accounts and creates and edits squads, adds/removes characters, and assigns a single owner.
- Only the assigned owner can edit a character's wishlist. Admin must also be the owner to edit it.
- A character may belong to several squads with the same EU ruleset. Ownership and wishlist are shared.
- Removing a membership or deleting a squad preserves the character and wishlist. Unreferenced characters stop refreshing.
- Rulesets can change only for empty squads. The app stores at most 50 characters, including unreferenced placeholders.
- Wishlist entries support priority, notes, an HTTPS source link, and wanted/acquired status. Custom goals have no automatically verified acquisition source.

## Validation

```sh
pnpm build
pnpm typecheck
pnpm test
pnpm exec playwright install chromium
pnpm test:e2e
```

Browser tests use port 3100 and a separate disposable database under `.wrangler/e2e`; they never rotate your normal local keys. They cover admin roster management, owner-only wishlists, read-only members, invalid login, and mobile layout.

The build generates the TanStack route tree; run it before type checking a fresh checkout if the generated route tree is missing. Runtime integration tests launch a local Cloudflare runtime and need permission to bind loopback sockets.

## Cloudflare free-tier deployment

Deployment is intentionally manual. This repository has not enabled billing or deployed resources.

1. Sign in with `pnpm exec wrangler login`.
2. Create the free D1 database with `pnpm exec wrangler d1 create wow-forever-squads`.
3. Replace the all-zero `database_id` in `wrangler.jsonc` with the returned ID. Keep the binding named `DB`.
4. Run `pnpm db:migrate:remote` and `pnpm keys:seed-admin --remote`. Store the production keys securely.
5. Run `pnpm deploy`.
6. Verify login, logout, permissions, and the minute cron in the deployed environment. Inspect CPU, subrequests, and D1 usage before considering free-tier compatibility verified.

One scheduled invocation processes at most one due, referenced, verified character, with a one-hour successful refresh interval. Browser polling reads cached D1 data every minute while visible. Upstream failures use bounded backoff and preserve existing data. This targets 50 characters without paid queues or storage services.

The local tests cannot prove Cloudflare production CPU limits. If the free tier cannot support the measured workload, treat that as a deployment blocker; do not silently enable paid services.

## UI attribution

The WarcraftCN button includes the original library's locally bundled textures and an adapted React implementation. Its license and source attribution are in `src/components/ui/warcraftcn/LICENSE.md`. Other application layouts are custom. This fan application is not affiliated with Blizzard Entertainment.

The administrator username is reserved as `admin`; database triggers and account scripts reject other administrator names. Run migrations on existing databases before using the new account UI. `pnpm keys:seed` remains the optional three-account development seed (`admin`, `player1`, `player2`); use `pnpm keys:seed-admin` for a new installation.

## Squad calendar

Open a squad and select **Calendar** to coordinate availability. The calendar shows the entire Monday–Sunday week as vertically stacked days on every screen size. Times are entered and displayed in the viewer's local timezone, which is labeled in the UI; storage uses UTC. Overnight sessions appear on each day they overlap.

Players can create availability in squads where they own a character; administrators can create their own availability in any squad. All signed-in accounts can view calendars, consistent with roster visibility. Only an entry's author can edit or delete it, even after losing their last character in the squad. Administrators cannot edit someone else's availability. Deleting a squad deletes its calendar entries; removing a character does not.

A slot can optionally select one of the author’s characters in that squad. All owned characters are offered, including alts; the server validates ownership and squad membership on every save. If a selected character is reassigned or removed, choose another character or clear the selection when editing. Deleting a character clears its calendar selection without deleting the slot.

A slot can include several named dungeons, raids, or battlegrounds and an optional note, or simply indicate availability. Sessions are limited to 48 hours, 10 activities, and a 2,000-character note. Concurrent edits are detected and require reloading the latest entry. Calendars refresh every minute while visible and on focus; successful changes refresh immediately.

Automatic Forever game events are a separate, capability-gated integration. No verified Forever/EU calendar HTTP source is configured, so the UI reports that automatic events are unavailable. It does not substitute retail or Classic schedules, invent battleground rotations, or require Blizzard connectivity for player availability.
