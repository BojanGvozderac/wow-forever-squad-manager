# Forever API integration plan

Status: waiting for an official World of Warcraft: Forever API.
Created: 2026-10-18.

## Objective

Enable real character lookup, character snapshots, images, upgrade catalog search, and acquisition sources when Blizzard publishes a supported Forever API. Keep the existing squad, ownership, and wishlist behavior. Never substitute retail or Classic records for Forever data.

## Current implementation

- The UI reads our database every 60 seconds while visible and when the browser window regains focus. This polling does not itself refresh Blizzard data.
- A Cloudflare cron is configured to run every minute and process one due, verified character belonging to at least one squad. After a successful refresh, the next refresh is scheduled one hour later. This is a target interval, not a guarantee during backlogs or upstream outages.
- Characters shared by multiple squads share their identity, owner, wishlist, and snapshots. Name-only placeholders are not refreshed.
- Failed refreshes retry after 5, 15, then 60 minutes, respecting longer upstream retry delays. Successful sections are retained when other sections fail. Database leases prevent overlapping refresh writes.
- A persistent SQLite/D1 `game_cache` table stores JSON results shared across users and squads. Successful results expire after seven days; explicit not-found results expire after one hour. Expired records refresh on demand. Upstream failures and rate limits preserve successful cached data and return it with a stale flag.
- Cache keys include provider ID, provider contract version, locale, data type, external ID, region, and ruleset.
- The cache currently wraps catalog searches and acquisition sources. Individual item, recipe, talent, profession, dungeon, and raid catalogs are not connected yet.
- Server-side Blizzard client-credentials OAuth was verified. `pnpm blizzard:check` checks the configured credentials without printing or saving tokens. Credentials live in ignored `.env.local` locally and must be configured as Cloudflare secrets for deployment.
- The Forever provider reports all external-data capabilities as unsupported. No live Forever data is fetched, regardless of whether OAuth credentials are configured.

## 1. Verify the official API contract

- [ ] Read the published Forever documentation and record official reference links in `docs/data-sources.md`.
- [ ] Confirm EU support, API hosts, namespaces, ruleset/server identifiers, full-name lookup syntax, and stable character IDs. Do not derive identity from a display name or assume retail realm slugs apply.
- [ ] Verify which character sections are public: profile, level, class, specialization, talents, equipment, professions, learned recipes, and media.
- [ ] Distinguish the shared recipe catalog from a character's learned recipes; support each only when documented.
- [ ] Confirm authentication, pagination, rate limits, cache headers, data update timing, deletion/privacy behavior, and data/image reuse requirements.
- [ ] Use a known Forever character to validate actual response shapes and partial/missing-data behavior. Save sanitized test fixtures with no credentials or tokens.
- [ ] Document unsupported fields and capabilities explicitly. Enable only verified capabilities.

## 2. Implement the provider and OAuth lifecycle

- [ ] Implement the existing `GameProvider` interface using verified Forever endpoints, keeping endpoint mapping and response normalization in the provider.
- [ ] Reuse the OAuth exchange helper; add server-side token reuse until shortly before expiry and bounded renewal after authentication failure. Avoid requesting a token for every endpoint call or retrying authentication indefinitely.
- [ ] Keep credentials and tokens out of browser bundles, API responses, logs, and cached game records.
- [ ] Apply the existing ten-second timeout and shared rate-limit backoff to provider requests. Account for pagination and endpoint fan-out within Cloudflare limits.
- [ ] Normalize upstream not-found, unsupported, rate-limited, and transient failures into the existing result types.

## 3. Connect character lookup and hourly refresh

- [ ] Look up characters by their full in-game name within the squad's configured region and ruleset/server scope.
- [ ] Store stable external IDs and prevent duplicate identities across squads. Enforce the same-server constraint on the server.
- [ ] Let an admin explicitly resolve an existing placeholder to a verified character. Preserve squad memberships, ownership, and wishlists; do not silently match names.
- [ ] Fetch available profile, equipment, professions, learned recipes, specialization, talents, and character media when adding a verified character.
- [ ] Store successful character sections independently and preserve prior snapshots on partial failures.
- [ ] Enable the existing hourly schedule for verified characters. Explicitly re-enable previously unsupported records only after provider support is verified.
- [ ] Continue the UI's 60-second database polling. Show last successful refresh, stale data, partial failures, and unavailable sections clearly.
- [ ] Verify actual upstream freshness rules; hourly polling cannot make source data fresher than Blizzard publishes it.

## 4. Extend static-data caching

- [ ] Cache individual items, item media metadata, talents, specializations, professions, skill tiers, recipes, dungeons, raids, encounters, and acquisition records as supported.
- [ ] Fetch shared records on demand by stable ID; reuse them across all characters and squads. Avoid importing an entire catalog on startup.
- [ ] Start with the existing seven-day successful-result lifetime and one-hour not-found lifetime. Preserve stale successful records on transient failures.
- [ ] Separate character-specific state from static definitions: equipped item instances, profession skill levels, and learned recipes belong in character snapshots.
- [ ] If the API supplies ETag or Last-Modified validators, use conditional requests and renew cache freshness on a valid 304 response.
- [ ] If the API supplies a reliable game-data version, include it in cache identity or invalidate affected records on version changes. The current provider contract version alone does not detect game patches.
- [ ] Extend lifetimes for demonstrably stable, versioned records after validating update semantics. Do not assume static data never changes.
- [ ] Coalesce or lease concurrent misses if simultaneous requests cause duplicate upstream fetches. Add bounded cleanup for obsolete cache versions and expired negative results.
- [ ] Store media URLs and metadata initially. Add image hosting only if required and permitted by Blizzard's reuse policy.

## 5. Resolve wishlist acquisition sources

- [ ] Connect item, enchant, recipe, and other supported upgrade searches to the shared cache.
- [ ] Verify how the API relates upgrades to bosses, dungeons, raids, quests, vendors, crafting recipes, reputations, or other acquisition methods.
- [ ] Build only relationships supported by actual data; do not assume an item endpoint provides every source.
- [ ] Include relevant difficulty, requirements, costs, materials, or location when provided, with source provenance and retrieval time.
- [ ] Show an explicit unknown-source state when coverage is missing. Preserve manual goals, notes, and source links.
- [ ] Keep wishlist mutation restricted to the assigned character owner, with admin-controlled ownership unchanged.

## 6. Validate and roll out

- [ ] Test response normalization, full-name lookup, identity deduplication, server-scope validation, partial responses, missing characters, and media fallbacks.
- [ ] Test token expiry/renewal, timeouts, rate-limit backoff, cache expiry, stale fallback, negative caching, and conditional requests if supported.
- [ ] Verify placeholder resolution preserves ownership, memberships, and wishlist entries.
- [ ] Test the scheduler with the supported workload of up to 50 characters, including retries and a cold-cache backlog. Confirm the one-character-per-minute schedule can maintain the hourly target under normal conditions.
- [ ] Run type checking, unit/integration tests, the existing browser tests, and a production build.
- [ ] Validate a small live cohort before enabling the full roster. Confirm the deployed cron actually runs and measure CPU, subrequests, D1 reads/writes, cache hit rate, and request failures against current Cloudflare free-tier limits.
- [ ] Update the data-source audit and README with verified capabilities, limitations, and operational steps. Keep a way to disable the provider without losing stored data.

## Completion criteria

An admin can find and add a real Forever character in the correct server scope, assign its owner, and see available character data and images. Verified characters refresh approximately hourly under normal conditions; shared static records reuse the D1 cache. Owners can select supported upgrades and see verified acquisition sources or a clear unknown-source state. Upstream outages preserve previously fetched data, and secrets remain server-side.

## Relevant code

- `src/server/game/provider.ts`: provider contract and disabled Forever implementation.
- `src/server/game/blizzard-oauth.ts`: OAuth token exchange.
- `src/server/game/index.ts`: game-data entry points and current cache integration.
- `src/server/game/cache.ts`: persistent cache and expiration policy.
- `src/server/game/request.ts`: interactive-request timeout and provider backoff.
- `src/server/refresh.ts`: scheduled character refresh and retries.
- `src/components/app.tsx`: visible-page database polling.
- `wrangler.jsonc`: D1 binding and minutely cron configuration.
