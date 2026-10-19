import { regionLabels } from "../lib/regions";
import { SquadCalendar } from "../components/squad-calendar";
import { LookupForm } from "../components/game-data";
import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useState } from "react";
import {
  Plus,
  Settings2,
  UserRound,
  Trash2,
  ChevronRight,
  Search,
  Shield,
  RefreshCw,
} from "lucide-react";
import {
  getSquad,
  listUsers,
  listCharacters,
  addCharacterToSquad,
  updateSquad,
  deleteSquad,
  addPlaceholder,
  assignOwner,
  removeCharacterFromSquad,
  type Squad,
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
import { rulesetLabels, RulesetIcon } from "./index";
export const Route = createFileRoute("/squads/$squadId")({
  component: SquadPage,
});
function SquadPage() {
  const { squadId } = Route.useParams(),
    user = useUser(),
    navigate = useNavigate();
  const {
    data,
    error: loadError,
    loading,
    reload,
  } = useData(async () => {
    const [roster, users, allCharacters] = await Promise.all([
      getSquad({ data: { squadId } }),
      listUsers(),
      listCharacters(),
    ]);
    return { ...roster, users, allCharacters };
  }, [squadId]);
  const [tab, setTab] = useState<"roster" | "calendar">("roster");
  const [modal, setModal] = useState<"add" | "settings" | null>(null),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false),
    [search, setSearch] = useState("");
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
  const { squad, characters, users } = data;
  const filtered = characters.filter((c) =>
    c.name.toLowerCase().includes(search.toLowerCase()),
  );
  return (
    <>
      <BackLink />
      <PageHeading
        eyebrow={`${rulesetLabels[squad.ruleset].toUpperCase()} · ${regionLabels[squad.region].toUpperCase()}`}
        title={squad.name}
        action={
          user.role === "admin" ? (
            <div className="heading-actions">
              <button
                className="secondary-button"
                onClick={() => setModal("settings")}
              >
                <Settings2 size={16} /> Manage squad
              </button>
              <Button onClick={() => setModal("add")}>
                <Plus size={16} /> Add character
              </Button>
            </div>
          ) : undefined
        }
      />
      <div className="roster-meta">
        <span>
          <RulesetIcon ruleset={squad.ruleset} /> {rulesetLabels[squad.ruleset]}{" "}
          ruleset
        </span>
        <span>
          <UserRound size={15} />
          {characters.length} characters
        </span>
        <span>
          <RefreshCw size={14} /> Cached data · checks every 60s
        </span>
      </div>
      <div className="squad-tabs" role="tablist" aria-label="Squad views">
        <button
          role="tab"
          id="roster-tab"
          aria-controls="roster-panel"
          aria-selected={tab === "roster"}
          onClick={() => setTab("roster")}
        >
          Roster
        </button>
        <button
          role="tab"
          id="calendar-tab"
          aria-controls="calendar-panel"
          aria-selected={tab === "calendar"}
          onClick={() => setTab("calendar")}
        >
          Calendar
        </button>
      </div>
      <div
        id="calendar-panel"
        role="tabpanel"
        aria-labelledby="calendar-tab"
        hidden={tab !== "calendar"}
      >
        <SquadCalendar key={squadId} squadId={squadId} />
      </div>
      <div
        id="roster-panel"
        role="tabpanel"
        aria-labelledby="roster-tab"
        hidden={tab !== "roster"}
      >
        <InfoNote>
          Character lookup is not connected. Added characters are clearly marked
          placeholders; game data stays unavailable until a supported provider
          is configured.
        </InfoNote>
        <ErrorNotice error={loadError || error} />
        <section className="roster-section">
          <div className="section-toolbar">
            <div>
              <h2>
                Squad roster{" "}
                <span className="count-tag">{characters.length}</span>
              </h2>
            </div>
            <label className="search-input">
              <Search size={16} />
              <input
                aria-label="Search characters"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Find a character…"
              />
            </label>
          </div>
          {characters.length === 0 ? (
            <Empty title="No characters yet" icon="users">
              <p>
                Add a character by its full in-game name to start building this
                squad.
              </p>
              {user.role === "admin" && (
                <Button onClick={() => setModal("add")}>
                  <Plus size={16} /> Add first character
                </Button>
              )}
            </Empty>
          ) : filtered.length === 0 ? (
            <Empty title="No characters found">
              <p>Try a different character name.</p>
            </Empty>
          ) : (
            <div className="table-scroll">
              <table className="roster-table">
                <thead>
                  <tr>
                    <th>CHARACTER</th>
                    <th>LEVEL / CLASS</th>
                    <th>OWNER</th>
                    <th>LAST REFRESH</th>
                    <th>
                      <span className="sr-only">Actions</span>
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {filtered.map((c) => (
                    <tr key={c.id}>
                      <td>
                        <Link
                          className="character-link"
                          to="/characters/$characterId"
                          params={{ characterId: c.id }}
                        >
                          <div className="portrait">
                            <UserRound size={25} />
                          </div>
                          <div>
                            <strong>{c.name}</strong>
                            <small>
                              {c.verified
                                ? "Verified character"
                                : "Unverified placeholder"}
                            </small>
                          </div>
                        </Link>
                      </td>
                      <td>
                        <span className="muted">
                          {String(c.profile.level ?? "—")} ·{" "}
                          {String(c.profile.class ?? "Class unknown")}
                        </span>
                        <small>
                          {String(
                            c.profile.spec ?? "Specialization unavailable",
                          )}
                        </small>
                      </td>
                      <td>
                        {user.role === "admin" ? (
                          <select
                            aria-label={`Owner of ${c.name}`}
                            value={c.ownerId ?? ""}
                            disabled={busy}
                            onChange={(e) =>
                              void action(() =>
                                assignOwner({
                                  data: {
                                    characterId: c.id,
                                    ownerId: e.target.value || null,
                                  },
                                }),
                              )
                            }
                          >
                            <option value="">Unassigned</option>
                            {users.map((u) => (
                              <option value={u.id} key={u.id}>
                                {u.username}
                              </option>
                            ))}
                          </select>
                        ) : (
                          <span>
                            {users.find((u) => u.id === c.ownerId)?.username ??
                              "Unassigned"}
                          </span>
                        )}
                      </td>
                      <td>
                        <span className="muted">
                          <LastRefresh at={c.lastSyncedAt} />
                        </span>
                      </td>
                      <td>
                        <div className="row-actions">
                          {user.role === "admin" && (
                            <button
                              className="icon-button danger"
                              aria-label={`Remove ${c.name} from squad`}
                              onClick={() => {
                                if (
                                  window.confirm(
                                    `Remove ${c.name} from ${squad.name}? Their character and wishlist will be kept.`,
                                  )
                                )
                                  void action(() =>
                                    removeCharacterFromSquad({
                                      data: { squadId, characterId: c.id },
                                    }),
                                  );
                              }}
                            >
                              <Trash2 size={15} />
                            </button>
                          )}
                          <Link
                            className="icon-button"
                            aria-label={`View ${c.name}`}
                            to="/characters/$characterId"
                            params={{ characterId: c.id }}
                          >
                            <ChevronRight size={18} />
                          </Link>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>
      </div>
      {modal === "add" && (
        <Modal title="Add a character" onClose={() => setModal(null)}>
          <LookupForm
            squadId={squadId}
            onComplete={() => {
              setModal(null);
              void reload();
            }}
          />
          <p className="modal-intro">
            Alternatively, create an unverified placeholder with no invented
            game data.
          </p>
          {data.allCharacters.some(
            (c) =>
              c.region === squad.region &&
              c.ruleset === squad.ruleset &&
              !characters.some((m) => m.id === c.id),
          ) && (
            <form
              className="existing-character-form"
              onSubmit={async (e) => {
                e.preventDefault();
                const f = new FormData(e.currentTarget);
                if (
                  await action(() =>
                    addCharacterToSquad({
                      data: {
                        squadId,
                        characterId: String(f.get("characterId")),
                      },
                    }),
                  )
                )
                  setModal(null);
              }}
            >
              <Field label="Or add an existing character">
                <select name="characterId" required>
                  <option value="">Select a character</option>
                  {data.allCharacters
                    .filter(
                      (c) =>
                        c.region === squad.region &&
              c.ruleset === squad.ruleset &&
                        !characters.some((m) => m.id === c.id),
                    )
                    .map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.name}
                      </option>
                    ))}
                </select>
              </Field>
              <button className="secondary-button" disabled={busy}>
                Add existing character
              </button>
            </form>
          )}
          <form
            onSubmit={async (e) => {
              e.preventDefault();
              const f = new FormData(e.currentTarget);
              if (
                await action(() =>
                  addPlaceholder({
                    data: { squadId, name: String(f.get("name")) },
                  }),
                )
              )
                setModal(null);
            }}
          >
            <Field label="Full in-game character name">
              <input
                name="name"
                required
                maxLength={40}
                placeholder="Enter the exact character name"
                autoFocus
              />
            </Field>
            <label className="checkbox-field">
              <input type="checkbox" required /> I understand this is an
              unverified placeholder.
            </label>
            <ErrorNotice error={error} />
            <div className="form-actions">
              <button
                className="secondary-button"
                type="button"
                onClick={() => setModal(null)}
              >
                Cancel
              </button>
              <Button disabled={busy}>
                {busy ? "Adding…" : "Add placeholder"}
              </Button>
            </div>
          </form>
        </Modal>
      )}
      {modal === "settings" && (
        <Modal title="Manage squad" onClose={() => setModal(null)}>
          <form
            onSubmit={async (e) => {
              e.preventDefault();
              const f = new FormData(e.currentTarget);
              if (
                await action(() =>
                  updateSquad({
                    data: {
                      squadId,
                      name: String(f.get("name")),
                      ruleset: (f.get("ruleset") ??
                        squad.ruleset) as Squad["ruleset"],
                    },
                  }),
                )
              )
                setModal(null);
            }}
          >
            <Field label="Squad name">
              <input
                name="name"
                required
                defaultValue={squad.name}
                maxLength={80}
              />
            </Field>
            <Field label="Ruleset">
              <select
                name="ruleset"
                defaultValue={squad.ruleset}
                disabled={characters.length > 0}
              >
                {Object.entries(rulesetLabels).map(([v, l]) => (
                  <option key={v} value={v}>
                    {l}
                  </option>
                ))}
              </select>
            </Field>
            {characters.length > 0 && (
              <p className="field-hint">
                Remove all members before changing the ruleset.
              </p>
            )}
            <ErrorNotice error={error} />
            <div className="form-actions">
              <button
                className="danger-button"
                type="button"
                disabled={busy}
                onClick={async () => {
                  if (
                    window.confirm(
                      `Delete ${squad.name}? Squad memberships will be removed; characters and wishlists are kept.`,
                    )
                  ) {
                    if (await action(() => deleteSquad({ data: { squadId } })))
                      void navigate({ to: "/" });
                  }
                }}
              >
                <Trash2 size={15} /> Delete squad
              </button>
              <Button disabled={busy}>Save changes</Button>
            </div>
          </form>
        </Modal>
      )}
    </>
  );
}
