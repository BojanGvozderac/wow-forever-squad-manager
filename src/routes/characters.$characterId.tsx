import { regionLabels } from "../lib/regions";
import {
  LookupForm,
  SnapshotSection,
  CatalogPicker,
  WishlistSources,
} from "../components/game-data";
import type { CatalogEntry } from "../server/game/provider";
import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import {
  Check,
  ExternalLink,
  Pencil,
  Plus,
  ScrollText,
  Trash2,
  UserRound,
  LockKeyhole,
  Shield,
  Gem,
  BookOpen,
  Hammer,
  Sparkles,
} from "lucide-react";
import {
  getCharacter,
  listUsers,
  listWishlist,
  saveWishlistEntry,
  deleteWishlistEntry,
  type WishlistEntry,
} from "../server/api";
import {
  BackLink,
  Button,
  Empty,
  ErrorNotice,
  Field,
  InfoNote,
  LastRefresh,
  Loading,
  Modal,
  PageHeading,
  message,
  useData,
  useUser,
} from "../components/app";
import { rulesetLabels } from "./index";
export const Route = createFileRoute("/characters/$characterId")({
  component: CharacterPage,
});
const sections = [
  { id: "overview", label: "Overview", icon: Shield },
  { id: "equipment", label: "Equipment", icon: Gem },
  { id: "talents", label: "Talents", icon: Sparkles },
  { id: "professions", label: "Professions", icon: Hammer },
  { id: "recipes", label: "Recipes", icon: BookOpen },
];
function CharacterPage() {
  const { characterId } = Route.useParams(),
    user = useUser();
  const {
    data,
    loading,
    error: loadError,
    reload,
  } = useData(async () => {
    const [character, wishlist, users] = await Promise.all([
      getCharacter({ data: { characterId } }),
      listWishlist({ data: { characterId } }),
      listUsers(),
    ]);
    return { character, wishlist, users };
  }, [characterId]);
  const [tab, setTab] = useState("overview"),
    [editing, setEditing] = useState<WishlistEntry | "new" | null>(null),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false),
    [filter, setFilter] = useState("all"),
    [chosen, setChosen] = useState<CatalogEntry | null>(null);
  async function action(fn: () => Promise<unknown>) {
    setBusy(true);
    setError("");
    try {
      await fn();
      await reload();
      return true;
    } catch (e) {
      setError(message(e));
      return false;
    } finally {
      setBusy(false);
    }
  }
  if (loading) return <Loading />;
  if (!data)
    return (
      <>
        <BackLink />
        <ErrorNotice error={loadError} />
      </>
    );
  const { character: c, wishlist, users } = data;
  const owner = users.find((u) => u.id === c.ownerId),
    canEdit = c.ownerId === user.id;
  const filtered = wishlist.filter(
    (w) => filter === "all" || w.status === filter,
  );
  const entry = editing && editing !== "new" ? editing : null;
  const snapshot = c.sections?.find(
    (s) => s.section === (tab === "overview" ? "profile" : tab),
  );
  return (
    <>
      <BackLink />
      <div className="character-hero">
        <div className="portrait portrait-large">
          <UserRound size={44} />
        </div>
        <PageHeading
          eyebrow={`${rulesetLabels[c.ruleset].toUpperCase()} · ${regionLabels[c.region].toUpperCase()}`}
          title={c.name}
        >
          {" "}
          {c.verified ? "Verified character" : "Unverified placeholder"}{" "}
          <span className="inline-dot">·</span>{" "}
          {owner ? `Owned by ${owner.username}` : "No owner assigned"}
        </PageHeading>
        <span className={`status-badge ${c.verified ? "verified" : ""}`}>
          {c.verified ? "VERIFIED" : "UNVERIFIED"}
        </span>
      </div>
      <ErrorNotice error={loadError || error} />
      {user.role === "admin" && !c.verified && (
        <LookupForm
          characterId={characterId}
          onComplete={() => void reload()}
        />
      )}
      <nav className="character-tabs" aria-label="Character sections">
        {sections.map((s) => (
          <button
            key={s.id}
            className={tab === s.id ? "selected" : ""}
            onClick={() => setTab(s.id)}
          >
            <s.icon size={16} />
            {s.label}
          </button>
        ))}
      </nav>
      <div className="character-columns">
        <section className="character-panel">
          <div className="panel-header">
            <h2>{sections.find((s) => s.id === tab)?.label}</h2>
            <span className="muted">CACHED SNAPSHOT</span>
          </div>
          {snapshot ? (
            <SnapshotSection section={snapshot} />
          ) : tab === "overview" ? (
            <>
              <div className="overview-grid">
                {[
                  ["Level", c.profile.level],
                  ["Class", c.profile.class],
                  ["Specialization", c.profile.spec],
                  ["Faction", c.profile.faction],
                ].map(([label, value]) => (
                  <div key={String(label)}>
                    <span>{String(label)}</span>
                    <strong>{value ? String(value) : "Unavailable"}</strong>
                  </div>
                ))}
              </div>
              <div className="data-status">
                <Shield size={24} />
                <div>
                  <h3>Waiting for a connection</h3>
                  <p>
                    {c.verified
                      ? "No game snapshot is available yet."
                      : "This placeholder has no verified game profile. Equipment, talents, and professions are unavailable."}
                  </p>
                </div>
              </div>
              <dl className="snapshot-info">
                <div>
                  <dt>Last successful refresh</dt>
                  <dd>
                    <LastRefresh at={c.lastSyncedAt} />
                  </dd>
                </div>
                <div>
                  <dt>Data source</dt>
                  <dd>{c.provider ?? "Not connected"}</dd>
                </div>
                <div>
                  <dt>Refresh status</dt>
                  <dd>{c.syncError ?? "Game data unavailable"}</dd>
                </div>
              </dl>
            </>
          ) : (
            <Empty
              title={`${sections.find((s) => s.id === tab)?.label} unavailable`}
            >
              <p>
                {tab === "recipes"
                  ? "No learned recipes have been imported."
                  : "No verified game data has been imported for this section."}{" "}
                A supported provider is required.
              </p>
            </Empty>
          )}
        </section>
        <aside className="character-side-note">
          <div className="eyebrow">CHARACTER RECORD</div>
          <p>
            Everyone can view this character. Only{" "}
            {owner?.username ?? "the assigned owner"} can manage its wishlist.
          </p>
          <div>
            <LockKeyhole size={15} />
            {canEdit
              ? "You own this character"
              : "Wishlist is read-only for you"}
          </div>
        </aside>
      </div>
      <section className="wishlist-section">
        <div className="section-toolbar">
          <div>
            <h2>
              Wishlist <span className="count-tag">{wishlist.length}</span>
            </h2>
          </div>
          {canEdit && (
            <Button
              onClick={() => {
                setChosen(null);
                setEditing("new");
              }}
            >
              <Plus size={16} /> Add a goal
            </Button>
          )}
        </div>
        <div className="wishlist-toolbar">
          <div className="filter-group">
            {["all", "wanted", "acquired"].map((v) => (
              <button
                className={filter === v ? "selected" : ""}
                key={v}
                onClick={() => setFilter(v)}
              >
                {v === "all"
                  ? "All goals"
                  : v === "wanted"
                    ? "Wanted"
                    : "Acquired"}{" "}
                <span>
                  {v === "all"
                    ? wishlist.length
                    : wishlist.filter((w) => w.status === v).length}
                </span>
              </button>
            ))}
          </div>
          <span className="muted">
            <LockKeyhole size={13} />{" "}
            {canEdit ? "Only you can edit" : "Only the owner can edit"}
          </span>
        </div>
        {filtered.length ? (
          <div className="wishlist-list">
            {filtered.map((w) => (
              <article key={w.id} className={`wishlist-item ${w.status}`}>
                <button
                  disabled={!canEdit || busy}
                  className={`goal-check ${w.status === "acquired" ? "checked" : ""}`}
                  aria-label={`Mark ${w.title} ${w.status === "wanted" ? "acquired" : "wanted"}`}
                  onClick={() =>
                    void action(() =>
                      saveWishlistEntry({
                        data: {
                          ...w,
                          status: w.status === "wanted" ? "acquired" : "wanted",
                        },
                      }),
                    )
                  }
                >
                  {w.status === "acquired" ? (
                    <Check size={16} />
                  ) : (
                    <Gem size={16} />
                  )}
                </button>
                <div className="goal-content">
                  <div className="goal-title">
                    <h3>{w.title}</h3>
                    <span className={`priority ${w.priority}`}>
                      {w.priority} priority
                    </span>
                    <span className="category-tag">{w.category}</span>
                  </div>
                  {w.notes && <p>{w.notes}</p>}
                  {w.catalogRef && <WishlistSources reference={w.catalogRef} />}
                  <div className="goal-source">
                    {w.sourceUrl ? (
                      <a
                        href={w.sourceUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                      >
                        Owner-provided link <ExternalLink size={12} />
                      </a>
                    ) : (
                      <span>Acquisition source unknown</span>
                    )}
                    <span>·</span>
                    <span>
                      {w.catalogRef ? "Catalog reference saved" : "Custom goal"}
                    </span>
                  </div>
                </div>
                {canEdit && (
                  <div className="row-actions">
                    <button
                      className="icon-button"
                      onClick={() => {
                        setChosen(null);
                        setEditing(w);
                      }}
                      aria-label={`Edit ${w.title}`}
                    >
                      <Pencil size={15} />
                    </button>
                    <button
                      className="icon-button danger"
                      aria-label={`Delete ${w.title}`}
                      disabled={busy}
                      onClick={() => {
                        if (
                          window.confirm(
                            `Delete “${w.title}” from this wishlist?`,
                          )
                        )
                          void action(() =>
                            deleteWishlistEntry({
                              data: { characterId, id: w.id, version: w.version },
                            }),
                          );
                      }}
                    >
                      <Trash2 size={15} />
                    </button>
                  </div>
                )}
              </article>
            ))}
          </div>
        ) : (
          <Empty
            title={
              wishlist.length
                ? "No goals in this view"
                : "No wishlist goals yet"
            }
          >
            <p>
              {canEdit
                ? "Add an item, enchant, recipe, or personal milestone to your wishlist."
                : "The owner has not added any goals in this view yet."}
            </p>
            {canEdit && (
              <Button
                onClick={() => {
                  setChosen(null);
                  setEditing("new");
                }}
              >
                <Plus size={16} /> Add a goal
              </Button>
            )}
          </Empty>
        )}
      </section>
      {editing && (
        <Modal
          title={entry ? "Edit wishlist goal" : "Add a wishlist goal"}
          onClose={() => setEditing(null)}
        >
          <CatalogPicker onChoose={setChosen} />
          <form
            key={chosen?.externalId ?? entry?.id ?? "new"}
            onSubmit={async (e) => {
              e.preventDefault();
              const f = new FormData(e.currentTarget);
              const values = {
                characterId,
                id: entry?.id,
                version: entry?.version,
                title: String(f.get("title")),
                category: String(
                  f.get("category"),
                ) as WishlistEntry["category"],
                priority: String(
                  f.get("priority"),
                ) as WishlistEntry["priority"],
                status: String(f.get("status")) as WishlistEntry["status"],
                notes: String(f.get("notes")),
                sourceUrl: String(f.get("sourceUrl")) || null,
                catalogRef: chosen
                  ? JSON.stringify([
                      chosen.provider,
                      chosen.category,
                      chosen.externalId,
                    ])
                  : (entry?.catalogRef ?? null),
              };
              if (await action(() => saveWishlistEntry({ data: values })))
                setEditing(null);
            }}
          >
            <Field label="Goal name">
              <input
                name="title"
                required
                maxLength={200}
                defaultValue={chosen?.title ?? entry?.title}
                placeholder="What are you working toward?"
                autoFocus
              />
            </Field>
            <div className="form-grid">
              <Field label="Category">
                <select
                  name="category"
                  defaultValue={chosen?.category ?? entry?.category ?? "item"}
                >
                  {["item", "enchant", "recipe", "other"].map((v) => (
                    <option key={v} value={v}>
                      {v[0].toUpperCase() + v.slice(1)}
                    </option>
                  ))}
                </select>
              </Field>
              <Field label="Priority">
                <select
                  name="priority"
                  defaultValue={entry?.priority ?? "normal"}
                >
                  <option value="high">High</option>
                  <option value="normal">Normal</option>
                  <option value="low">Low</option>
                </select>
              </Field>
            </div>
            <Field label="Status">
              <select name="status" defaultValue={entry?.status ?? "wanted"}>
                <option value="wanted">Wanted</option>
                <option value="acquired">Acquired</option>
              </select>
            </Field>
            <Field label="Notes (optional)">
              <textarea
                name="notes"
                maxLength={4000}
                defaultValue={entry?.notes}
                placeholder="A plan, a reminder, a little motivation…"
                rows={3}
              />
            </Field>
            <Field label="Reference link (optional, HTTPS)">
              <input
                type="url"
                pattern="https://.*"
                name="sourceUrl"
                defaultValue={
                  chosen?.provenance.sourceUrl ?? entry?.sourceUrl ?? ""
                }
                placeholder="https://…"
              />
            </Field>
            <ErrorNotice error={error} />
            <div className="form-actions">
              <button
                type="button"
                className="secondary-button"
                onClick={() => setEditing(null)}
              >
                Cancel
              </button>
              <Button disabled={busy}>{busy ? "Saving…" : "Save goal"}</Button>
            </div>
          </form>
        </Modal>
      )}
    </>
  );
}
