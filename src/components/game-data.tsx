import { useEffect, useState } from "react";
import {
  getGameCapabilities,
  lookupCharacter,
  addVerifiedCharacter,
  linkPlaceholder,
  searchCatalog,
  getAcquisitionSources,
  type CharacterSection,
} from "../server/api";
import type {
  CatalogEntry,
  Identity,
  AcquisitionSource,
} from "../server/game/provider";
import { Button, ErrorNotice, Field, InfoNote, message, useData } from "./app";
export function WishlistSources({ reference }: { reference: string }) {
  const [sources, setSources] = useState<AcquisitionSource[]>([]);
  useEffect(() => {
    let active = true;
    setSources([]);
    async function load() {
      try {
        const parsed: unknown = JSON.parse(reference);
        if (!Array.isArray(parsed) || parsed.length !== 3) return;
        const [provider, category, externalId] = parsed;
        if (
          typeof provider !== "string" ||
          typeof externalId !== "string" ||
          !["item", "enchant", "recipe", "other"].includes(category)
        )
          return;
        const result = await getAcquisitionSources({
          data: { provider, externalId, category },
        });
        if (active && result.status === "ok") setSources(result.data);
      } catch {
        /* Unknown references remain visibly unresolved. */
      }
    }
    void load();
    return () => {
      active = false;
    };
  }, [reference]);
  if (!sources.length)
    return <p className="muted">Acquisition source unknown</p>;
  return (
    <div className="acquisition-sources">
      {sources.map((source) => (
        <div key={source.id}>
          <strong>{source.label}</strong>
          {source.details && <p>{source.details}</p>}
          {source.provenance.sourceUrl.startsWith("https://") && (
            <a
              href={source.provenance.sourceUrl}
              target="_blank"
              rel="noopener noreferrer"
            >
              Source: {source.provenance.provider}
            </a>
          )}
        </div>
      ))}
    </div>
  );
}
export function LookupForm({
  squadId,
  characterId,
  onComplete,
}: {
  squadId?: string;
  characterId?: string;
  onComplete: () => void;
}) {
  const { data: cap } = useData(() => getGameCapabilities());
  const [preview, setPreview] = useState<Identity | null>(null),
    [name, setName] = useState(""),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false);
  if (!cap?.lookupCharacter)
    return (
      <InfoNote>{cap?.reason ?? "Checking provider availability…"}</InfoNote>
    );
  return (
    <div className="provider-form">
      <h3>
        {characterId ? "Link verified identity" : "Find a verified character"}
      </h3>
      <form
        onSubmit={async (e) => {
          e.preventDefault();
          setError("");
          setBusy(true);
          try {
            const result = await lookupCharacter({
              data: {
                ...(squadId ? { squadId } : { characterId: characterId! }),
                fullName: name,
              },
            });
            if (result.status === "ok") setPreview(result.data);
            else setError(result.message);
          } catch (e) {
            setError(message(e));
          } finally {
            setBusy(false);
          }
        }}
      >
        <Field label="Full in-game name">
          <input
            required
            value={name}
            onChange={(e) => {
              setName(e.target.value);
              setPreview(null);
            }}
          />
        </Field>
        <button className="secondary-button" disabled={busy}>
          Look up character
        </button>
      </form>
      {preview && (
        <div className="lookup-preview">
          <strong>{preview.fullName}</strong>
          <p>
            {preview.region.toUpperCase()} · {preview.ruleset} ·{" "}
            {preview.provider}
          </p>
          <small>Provider identity: {preview.externalId}</small>
          <Button
            disabled={busy}
            onClick={async () => {
              setBusy(true);
              try {
                const result = characterId
                  ? await linkPlaceholder({
                      data: { characterId, fullName: name },
                    })
                  : await addVerifiedCharacter({
                      data: { squadId: squadId!, fullName: name },
                    });
                if (result.status !== "ok") setError(result.message);
                else onComplete();
              } catch (e) {
                setError(message(e));
              } finally {
                setBusy(false);
              }
            }}
          >
            {characterId
              ? "Confirm identity and link"
              : "Confirm and add to squad"}
          </Button>
        </div>
      )}
      <ErrorNotice error={error} />
    </div>
  );
}
function humanLabel(value: string) {
  return value
    .replace(/([a-z])([A-Z])/g, "$1 $2")
    .replace(/[_-]/g, " ")
    .replace(/^./, (c) => c.toUpperCase());
}
function ReadableValue({ value }: { value: unknown }) {
  if (value === null || value === undefined)
    return <span className="muted">Unavailable</span>;
  if (typeof value === "boolean") return <span>{value ? "Yes" : "No"}</span>;
  if (typeof value !== "object") return <span>{String(value)}</span>;
  if (Array.isArray(value))
    return value.length ? (
      <div className="snapshot-cards">
        {value.map((item, i) => (
          <div className="snapshot-record" key={i}>
            <ReadableValue value={item} />
          </div>
        ))}
      </div>
    ) : (
      <p className="muted">No entries in this snapshot.</p>
    );
  const entries = Object.entries(value as Record<string, unknown>).filter(
    ([key]) =>
      ![
        "externalId",
        "provider",
        "id",
        "imageUrl",
        "portraitUrl",
        "icon",
      ].includes(key),
  );
  return entries.length ? (
    <dl className="snapshot-fields">
      {entries.map(([key, item]) => (
        <div key={key}>
          <dt>{humanLabel(key)}</dt>
          <dd>
            <ReadableValue value={item} />
          </dd>
        </div>
      ))}
    </dl>
  ) : (
    <p className="muted">No display information available.</p>
  );
}
export function SnapshotSection({ section }: { section: CharacterSection }) {
  return (
    <div>
      <div className="snapshot-freshness">
        <span>
          {section.status === "ok"
            ? "Cached snapshot"
            : humanLabel(section.status)}
        </span>
        <span>{new Date(section.fetchedAt * 1000).toLocaleString()}</span>
      </div>
      {section.error && (
        <InfoNote>
          {section.error}{" "}
          {section.value ? "Showing the last available snapshot." : ""}
        </InfoNote>
      )}
      {section.value !== null ? (
        <ReadableValue value={section.value} />
      ) : (
        <InfoNote>No game data is available for this section.</InfoNote>
      )}
    </div>
  );
}
export function CatalogPicker({
  onChoose,
}: {
  onChoose: (entry: CatalogEntry) => void;
}) {
  const { data: cap } = useData(() => getGameCapabilities());
  const [results, setResults] = useState<CatalogEntry[] | null>(null),
    [sources, setSources] = useState<AcquisitionSource[] | null>(null),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false);
  if (!cap?.searchCatalog)
    return (
      <InfoNote>
        Catalog search and verified acquisition sources are unavailable. You can
        track a custom goal and add your own reference link.
      </InfoNote>
    );
  return (
    <div className="provider-form">
      <form
        onSubmit={async (e) => {
          e.preventDefault();
          setBusy(true);
          setError("");
          const f = new FormData(e.currentTarget);
          try {
            const result = await searchCatalog({
              data: {
                query: String(f.get("query")),
                category: String(
                  f.get("catalogCategory"),
                ) as CatalogEntry["category"],
              },
            });
            if (result.status === "ok") setResults(result.data);
            else setError(result.message);
          } catch (e) {
            setError(message(e));
          } finally {
            setBusy(false);
          }
        }}
      >
        <Field label="Search supported catalog">
          <input
            name="query"
            required
            placeholder="Search item, enchant, or recipe…"
          />
        </Field>
        <Field label="Catalog category">
          <select name="catalogCategory">
            <option value="item">Item</option>
            <option value="enchant">Enchant</option>
            <option value="recipe">Recipe</option>
            <option value="other">Other</option>
          </select>
        </Field>
        <button className="secondary-button" disabled={busy}>
          Search catalog
        </button>
      </form>
      <ErrorNotice error={error} />
      {results?.length === 0 && (
        <p className="field-hint">No matching catalog entries.</p>
      )}
      {results?.map((entry) => (
        <div
          className="catalog-result"
          key={`${entry.provider}:${entry.externalId}`}
        >
          <div>
            <strong>{entry.title}</strong>
            <small>{entry.provenance.provider}</small>
          </div>
          <button
            type="button"
            className="secondary-button"
            onClick={() => onChoose(entry)}
          >
            Use this goal
          </button>
          {cap.acquisitionSources && (
            <button
              type="button"
              className="secondary-button"
              onClick={async () => {
                try {
                  const result = await getAcquisitionSources({ data: entry });
                  if (result.status === "ok") setSources(result.data);
                  else setError(result.message);
                } catch (e) {
                  setError(message(e));
                }
              }}
            >
              Sources
            </button>
          )}
        </div>
      ))}
      {sources && (
        <div className="acquisition-sources">
          <h3>Acquisition sources</h3>
          {sources.length ? (
            sources.map((s) => (
              <div key={s.id}>
                <strong>{s.label}</strong>
                <p>{s.details}</p>
                {s.provenance.sourceUrl.startsWith("https://") && (
                  <a
                    href={s.provenance.sourceUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                  >
                    Source: {s.provenance.provider}
                  </a>
                )}
              </div>
            ))
          ) : (
            <p>Acquisition source unknown.</p>
          )}
        </div>
      )}
    </div>
  );
}
