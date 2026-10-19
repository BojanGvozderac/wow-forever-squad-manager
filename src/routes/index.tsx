import { createFileRoute, Link } from "@tanstack/react-router";
import { useState } from "react";
import {
  ArrowUpRight,
  Plus,
  Shield,
  Swords,
  ScrollText,
  Users,
  Globe2,
  Flag,
} from "lucide-react";
import {
  listSquads,
  getSquad,
  createSquad,
  listCharacters,
  deleteCharacter,
  type Squad,
} from "../server/api";
import {
  Button,
  Empty,
  ErrorNotice,
  Field,
  Loading,
  Modal,
  PageHeading,
  message,
  useData,
  useUser,
} from "../components/app";
export const Route = createFileRoute("/")({ component: Squads });
export const rulesetLabels = {
  normal: "Normal",
  pvp: "PvP",
  roleplay: "Roleplay",
};
export function RulesetIcon({ ruleset }: { ruleset: string }) {
  return ruleset === "pvp" ? (
    <Swords />
  ) : ruleset === "roleplay" ? (
    <ScrollText />
  ) : (
    <Shield />
  );
}
function Squads() {
  const user = useUser();
  const [creating, setCreating] = useState(false),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [filter, setFilter] = useState("all");
  const {
    data,
    loading,
    error: loadError,
    reload,
  } = useData(async () => {
    const [squads, characters] = await Promise.all([
      listSquads(),
      listCharacters(),
    ]);
    const rosters = await Promise.all(
      squads.map((s) => getSquad({ data: { squadId: s.id } })),
    );
    return {
      rosters,
      retained: characters.filter(
        (c) =>
          !rosters.some((s) =>
            s.characters.some((member) => member.id === c.id),
          ),
      ),
    };
  });
  const count = data?.rosters.reduce((n, s) => n + s.characters.length, 0) ?? 0;
  const visible = data?.rosters.filter(
    (s) => filter === "all" || s.squad.ruleset === filter,
  );
  return (
    <>
      <PageHeading
        title="The war room"
        action={
          user.role === "admin" ? (
            <Button onClick={() => setCreating(true)}>
              <Plus size={17} /> Create squad
            </Button>
          ) : undefined
        }
      />
      <div className="stats-row">
        <div className="stat">
          <div className="stat-icon">
            <Flag size={20} />
          </div>
          <div>
            <span>ACTIVE SQUADS</span>
            <strong>{loading ? "—" : (data?.rosters.length ?? 0)}</strong>
          </div>
        </div>
        <div className="stat">
          <div className="stat-icon violet">
            <Users size={20} />
          </div>
          <div>
            <span>ROSTER MEMBERSHIPS</span>
            <strong>{loading ? "—" : count}</strong>
          </div>
        </div>
        <div className="stat">
          <div className="stat-icon blue">
            <Globe2 size={20} />
          </div>
          <div>
            <span>REGION</span>
            <strong className="stat-word">
              Europe <small>EU</small>
            </strong>
          </div>
        </div>
      </div>
      <section>
        <div className="section-toolbar">
          <div>
            <h2>
              Your squads{" "}
              <span className="count-tag">{data?.rosters.length ?? 0}</span>
            </h2>
          </div>
          <div className="filter-group" aria-label="Filter squads">
            {["all", "normal", "pvp", "roleplay"].map((f) => (
              <button
                key={f}
                className={filter === f ? "selected" : ""}
                onClick={() => setFilter(f)}
              >
                {f === "all"
                  ? "All squads"
                  : rulesetLabels[f as keyof typeof rulesetLabels]}
              </button>
            ))}
          </div>
        </div>
        <ErrorNotice error={loadError} />
        {loading ? (
          <Loading />
        ) : visible?.length ? (
          <div className="squad-grid">
            {visible.map(({ squad, characters }) => (
              <Link
                to="/squads/$squadId"
                params={{ squadId: squad.id }}
                className={`squad-card ${squad.ruleset}`}
                key={squad.id}
              >
                <div className="squad-card-top">
                  <div className="squad-emblem">
                    <RulesetIcon ruleset={squad.ruleset} />
                  </div>
                  <span className="ruleset-tag">
                    {rulesetLabels[squad.ruleset]}
                  </span>
                </div>
                <h3>{squad.name}</h3>
                <div className="squad-realm">
                  <Globe2 size={13} /> Europe <span>·</span> Forever
                </div>
                <div className="squad-portraits">
                  {characters.slice(0, 4).map((c) => (
                    <div className="mini-avatar" title={c.name} key={c.id}>
                      {c.name.slice(0, 1)}
                    </div>
                  ))}
                  {characters.length === 0 ? (
                    <span className="muted">No characters yet</span>
                  ) : (
                    <span>
                      {characters.length}{" "}
                      {characters.length === 1 ? "character" : "characters"}
                    </span>
                  )}
                </div>
                <div className="squad-card-footer">
                  <span>
                    <span className="region-dot" />{" "}
                    {characters.length
                      ? "ROSTER READY"
                      : "NO CHARACTERS"}
                  </span>
                  <ArrowUpRight size={19} />
                </div>
              </Link>
            ))}
            {user.role === "admin" && (
              <button
                className="create-squad-card"
                aria-label="Create another squad"
                onClick={() => setCreating(true)}
              >
                <div>
                  <Plus size={25} />
                </div>
                <h3>Create squad</h3>
              </button>
            )}
          </div>
        ) : (
          <Empty
            title={
              filter === "all"
                ? "No squads yet"
                : "No squads in this ruleset"
            }
            icon="users"
          >
            <p>
              {filter === "all"
                ? "Create your first squad, choose a ruleset, and bring your characters together."
                : "Try another ruleset filter."}
            </p>
            {user.role === "admin" && filter === "all" && (
              <Button onClick={() => setCreating(true)}>
                <Plus size={16} /> Create your first squad
              </Button>
            )}
          </Empty>
        )}
      </section>
      {data?.retained.length ? (
        <section className="retained-section">
          <div className="section-toolbar">
            <div>
              <h2>
                Retained characters{" "}
                <span className="count-tag">{data.retained.length}</span>
              </h2>
              <p>
                Characters without a squad. Their records and wishlists are
                preserved.
              </p>
            </div>
          </div>
          <ErrorNotice error={error} />
          {data.retained.map((c) => (
            <div className="retained-character" key={c.id}>
              <Link
                to="/characters/$characterId"
                params={{ characterId: c.id }}
              >
                <strong>{c.name}</strong>
                <small>
                  {rulesetLabels[c.ruleset]} ·{" "}
                  {c.verified ? "Verified" : "Unverified"}
                </small>
              </Link>
              {user.role === "admin" && (
                <button
                  className="danger-button"
                  disabled={busy}
                  onClick={async () => {
                    if (
                      !window.confirm(
                        `Permanently delete ${c.name}? Their record and entire wishlist will be lost. This cannot be undone.`,
                      )
                    )
                      return;
                    setBusy(true);
                    try {
                      await deleteCharacter({ data: { characterId: c.id } });
                      await reload();
                    } catch (e) {
                      setError(message(e));
                    } finally {
                      setBusy(false);
                    }
                  }}
                >
                  Permanently delete
                </button>
              )}
            </div>
          ))}
        </section>
      ) : null}
      {creating && (
        <Modal title="Create squad" onClose={() => setCreating(false)}>
          <p className="modal-intro">
            Enter a squad name and choose a ruleset.
          </p>
          <form
            onSubmit={async (e) => {
              e.preventDefault();
              const f = new FormData(e.currentTarget);
              setBusy(true);
              try {
                await createSquad({
                  data: {
                    name: String(f.get("name")),
                    ruleset: String(f.get("ruleset")) as Squad["ruleset"],
                  },
                });
                setCreating(false);
                setError("");
                await reload();
              } catch (e) {
                setError(message(e));
              } finally {
                setBusy(false);
              }
            }}
          >
            <Field label="Squad name">
              <input
                name="name"
                required
                maxLength={80}
                placeholder="e.g. The Night Watch"
                autoFocus
              />
            </Field>
            <Field label="EU ruleset">
              <select name="ruleset">
                <option value="normal">Normal · EU</option>
                <option value="pvp">PvP · EU</option>
                <option value="roleplay">Roleplay · EU</option>
              </select>
            </Field>
            <p className="field-hint">
              The ruleset can only be changed while the squad is empty.
            </p>
            <ErrorNotice error={error} />
            <div className="form-actions">
              <button
                type="button"
                className="secondary-button"
                onClick={() => setCreating(false)}
              >
                Cancel
              </button>
              <Button disabled={busy}>
                {busy ? "Creating…" : "Create squad"}
              </Button>
            </div>
          </form>
        </Modal>
      )}
    </>
  );
}
