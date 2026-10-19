import type { Region } from "../../lib/regions";
import { cached } from "./cache";
import { providerRequest } from "./request";
import {
  foreverProvider,
  referenceKey,
  type GameProvider,
  type CatalogRef,
  type Category,
  type Ruleset,
} from "./provider";
export * from "./provider";
export function gameData(
  db: D1Database,
  provider: GameProvider = foreverProvider,
) {
  const call = <T>(
    run: (signal: AbortSignal) => Promise<import("./provider").Result<T>>,
  ) => providerRequest(db, provider, run);
  const capabilities = provider.getCapabilities();
  return {
    getCapabilities: () => provider.getCapabilities(),
    getCalendarEvents: (input: Parameters<GameProvider["getCalendarEvents"]>[0]) =>
      !capabilities.calendarEvents
        ? provider.getCalendarEvents(input)
        : cached(
            db,
            provider,
            {
              type: "calendar-events",
              externalId: JSON.stringify([input.from, input.to]),
              region: input.region,
              ruleset: input.ruleset,
            },
            () => call((signal) => provider.getCalendarEvents(input, signal)),
          ),
    lookupCharacter: (input: {
      region: Region;
      ruleset: Ruleset;
      fullName: string;
    }) =>
      capabilities.lookupCharacter
        ? call((signal) => provider.lookupCharacter(input, signal))
        : provider.lookupCharacter(input),
    fetchCharacter: (
      identity: Parameters<GameProvider["fetchCharacter"]>[0],
    ) =>
      capabilities.fetchCharacter
        ? call((signal) => provider.fetchCharacter(identity, signal))
        : provider.fetchCharacter(identity),
    searchCatalog: (input: { query: string; category: Category }) =>
      !capabilities.searchCatalog
        ? provider.searchCatalog(input)
        : cached(
            db,
            provider,
            {
              type: "catalog-search",
              externalId: JSON.stringify([
                input.category,
                input.query.trim().toLocaleLowerCase("en-GB"),
              ]),
            },
            () => call((signal) => provider.searchCatalog(input, signal)),
          ),
    getAcquisitionSources: (ref: CatalogRef) =>
      !capabilities.acquisitionSources
        ? provider.getAcquisitionSources(ref)
        : cached(
            db,
            provider,
            { type: "acquisition-sources", externalId: referenceKey(ref) },
            () => call((signal) => provider.getAcquisitionSources(ref, signal)),
          ),
  };
}
