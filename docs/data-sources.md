# Game data source audit

Reviewed 2026-10-18 for **official EU World of Warcraft: Forever**, not Classic Era, Anniversary, retail, or a private server. No documented Forever HTTP contract or licensed, Forever-specific catalog was verified. This is a limitation of the available evidence, not a claim that Blizzard will never provide one.

## Official sources

- [Blizzard Forever announcement / deep dive](https://worldofwarcraft.blizzard.com/en-us/news/24303313/world-of-warcraft-forever-deep-dive-panel-recap): official product source. Direct retrieval returned HTTP 403 during review. News search confirmed the product announcement, but provides no verified character lookup, equipment, profession, recipe, item, enchant or acquisition API contract.
- [Battle.net WoW game data documentation](https://community.developer.battle.net/documentation/world-of-warcraft/game-data-apis): verified in the rendered browser after the initial research client received only a JavaScript shell. Documents items, media, professions, recipes, talents, and encounter journals for WoW; it does not establish a Forever contract. Profile documentation also provides realm/name character lookup, equipment, professions, specializations, and character media.
- [Battle.net Classic game data documentation](https://community.developer.battle.net/documentation/world-of-warcraft-classic/game-data-apis): direct retrieval was unavailable. A Classic namespace would not establish Forever support. No Classic or retail namespace is used as a substitute.

## Free community candidates reviewed

| Source | Verified scope / license | Decision |
| --- | --- | --- |
| [WoWDBDefs](https://github.com/wowdev/WoWDBDefs), [license](https://github.com/wowdev/WoWDBDefs/blob/master/LICENSE.md) | Client database field definitions, not hosted item records or player profiles. Definitions/data: CC BY-SA 4.0; code: BSD-3-Clause. | No verified Forever dataset/endpoint for required records. Not imported. |
| [CMaNGOS Classic-DB](https://github.com/cmangos/classic-db), [README](https://github.com/cmangos/classic-db/blob/master/README.md) | Community SQL content for client patch 1.12; README declares GPLv3 and separate copyrighted materials. Compatible with its own Classic core. | Different game/server scope. No official Forever relevance established. Not imported. |

No scraped Wowhead/private-server data, bundled game database, image binaries, or simulated production records are shipped.

## Exact enabled capabilities

Provider `blizzard-forever-eu`, contract version `unverified-1`, returns `unsupported` for character lookup, character fetch, catalog search, acquisition sources, and calendar events. `getCapabilities()` reports each capability as false with a reason. The user confirmed Forever has no official API yet. Optional server-side Blizzard OAuth credentials can be verified using `pnpm blizzard:check`; successful authentication does not establish Forever support. No guessed game endpoints or runtime fixture switches are enabled. Manual placeholders and manually authored wishlist entries remain usable; placeholders never become verified from names alone.

## Calendar source review

Reviewed again on 2026-10-19 for a verified HTTP calendar source covering official Forever EU. The [Battle.net game-data documentation](https://community.developer.battle.net/documentation/world-of-warcraft/game-data-apis) again returned only a JavaScript shell to direct retrieval. Targeted official-domain searches did not establish a Forever calendar endpoint, namespace, authentication contract, or event timestamp semantics. No calendar adapter is enabled on that evidence. This does not establish that no endpoint exists; it records that none was verified. Retail/Classic APIs, client-file event schedules, community calendars, and guessed reset times are not substituted for official Forever EU events.

`getSquadGameEvents` authenticates the user, verifies the squad exists, and requests that squad's region/ruleset for a positive window of at most 42 days using integer UTC epoch milliseconds. The provider reports `unsupported` without making network requests or reading the provider cache. Squad availability remains a separate read. Future supported adapters must return opaque event IDs, title, category, UTC millisecond start/end times, game `forever`, region `eu`, source URL, and retrieval time in milliseconds. Before enabling one, verify its Forever scope, timezone conversion, pagination, range semantics, authentication and reuse terms.

Supported calendar adapters reuse the shared request timeout/backoff and on-demand cache. Calendar keys include provider, contract version, region, ruleset and the exact requested window. A successful empty array means a verified source returned no events; `unsupported` means no configured source can answer. Expired successful event lists survive transient failures as stale data; failed requests never overwrite them.

A future adapter must document its Forever region/ruleset contract, authentication, supported sections, ID stability, pagination, rate limits, and reuse permission before enabling capability flags. Provider identities use opaque external IDs. Acquisition records carry provider, original source URL, retrieval time, and optional license. Images are URLs only.

## Storage and refresh behavior

`game_cache` keys encode provider, contract version, locale, type, opaque external ID and realm scope. Successful records expire after seven days; explicit not-found results after one hour. Transient failures do not replace successful records; expired successful records can be returned with `stale: true`. No eager catalog import runs.

Each minutely cron invocation claims at most one due, verified character referenced by a squad, ordered by due time. A single atomic SQL update grants a five-minute lease. Character section writes require lease ownership and retain each previous successful section when another fails. Success schedules one hour later; failures retry after 5, 15, then 60 minutes, respecting longer provider retry-after values and shared provider backoff. Unsupported refresh is disabled until explicitly re-enabled (`sync_status` and `next_due`), avoiding loops. Provider fetches are bounded to ten seconds. Sessions and login limit rows are purged at most daily.

The cron is infrastructure ready for a verified adapter; production cannot currently fetch Forever records. D1 migrations and provider tests exercise this distinction explicitly.
