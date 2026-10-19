export type Ruleset = "normal" | "pvp" | "roleplay";
export type Category = "item" | "enchant" | "recipe" | "other";
export type Failure = {
  status: "unsupported" | "not_found" | "rate_limited" | "upstream_failure";
  message: string;
  retryAfterSeconds?: number;
};
export type Result<T> =
  { status: "ok"; data: T; stale?: boolean; fetchedAt?: number } | Failure;
export type Identity = {
  provider: string;
  externalId: string;
  region: "eu";
  ruleset: Ruleset;
  fullName: string;
};
export type CatalogRef = {
  provider: string;
  externalId: string;
  category: Category;
};
export type Provenance = {
  provider: string;
  sourceUrl: string;
  retrievedAt: string;
  license?: string;
};
export type CatalogEntry = CatalogRef & {
  title: string;
  imageUrl?: string;
  provenance: Provenance;
};
export type AcquisitionSource = {
  id: string;
  label: string;
  details?: string;
  provenance: Provenance;
};
export type Section =
  | "profile"
  | "equipment"
  | "professions"
  | "recipes"
  | "talents"
  | "specialization";
export type CharacterSnapshot = {
  sections: Partial<Record<Section, Result<unknown>>>;
};
export type GameCalendarEvent = {
  id: string;
  title: string;
  category: string;
  startsAt: number;
  endsAt: number;
  game: "forever";
  region: "eu";
  sourceUrl: string;
  retrievedAt: number;
};
export type CalendarEventsInput = {
  region: "eu";
  ruleset: Ruleset;
  from: number;
  to: number;
};
export type Capabilities = {
  lookupCharacter: boolean;
  fetchCharacter: boolean;
  searchCatalog: boolean;
  acquisitionSources: boolean;
  calendarEvents: boolean;
  reason: string;
};
export interface GameProvider {
  readonly id: string;
  readonly version: string;
  getCapabilities(): Capabilities;
  lookupCharacter(
    input: { region: "eu"; ruleset: Ruleset; fullName: string },
    signal?: AbortSignal,
  ): Promise<Result<Identity>>;
  fetchCharacter(
    identity: Identity,
    signal?: AbortSignal,
  ): Promise<Result<CharacterSnapshot>>;
  searchCatalog(
    input: { query: string; category: Category },
    signal?: AbortSignal,
  ): Promise<Result<CatalogEntry[]>>;
  getAcquisitionSources(
    ref: CatalogRef,
    signal?: AbortSignal,
  ): Promise<Result<AcquisitionSource[]>>;
  getCalendarEvents(
    input: CalendarEventsInput,
    signal?: AbortSignal,
  ): Promise<Result<GameCalendarEvent[]>>;
}
const reason =
  "No verified public API or licensed dataset for official EU World of Warcraft: Forever is configured. Manual entries are available.";
const unsupported = (): Failure => ({ status: "unsupported", message: reason });
export const foreverProvider: GameProvider = {
  id: "blizzard-forever-eu",
  version: "unverified-1",
  getCapabilities: () => ({
    lookupCharacter: false,
    fetchCharacter: false,
    searchCatalog: false,
    acquisitionSources: false,
    calendarEvents: false,
    reason,
  }),
  lookupCharacter: async () => unsupported(),
  fetchCharacter: async () => unsupported(),
  searchCatalog: async () => unsupported(),
  getAcquisitionSources: async () => unsupported(),
  getCalendarEvents: async () => ({
    status: "unsupported",
    message: "No verified HTTP calendar source for official EU World of Warcraft: Forever is configured.",
  }),
};
export function getProvider(id = foreverProvider.id): GameProvider | undefined {
  return id === foreverProvider.id ? foreverProvider : undefined;
}
/** IDs are opaque strings; never derive identity from a display name. */
export function referenceKey(ref: CatalogRef): string {
  return JSON.stringify([ref.provider, ref.category, ref.externalId]);
}
/** Every provider network request must use this helper and the supplied signal. */
export async function fetchWithTimeout(
  input: RequestInfo | URL,
  init: RequestInit = {},
): Promise<Response> {
  return fetch(input, {
    ...init,
    signal: init.signal
      ? AbortSignal.any([init.signal, AbortSignal.timeout(10_000)])
      : AbortSignal.timeout(10_000),
  });
}
