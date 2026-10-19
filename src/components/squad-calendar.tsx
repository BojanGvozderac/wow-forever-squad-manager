import { useCallback, useEffect, useRef, useState } from "react";
import { ChevronLeft, ChevronRight, Plus } from "lucide-react";
import { Button, ErrorNotice, Field, Modal, message, useUser } from "./app";
import { AvailabilityForm, type AvailabilityInput } from "./availability-form";
import {
  createAvailability,
  deleteAvailability,
  getSquadCalendar,
  updateAvailability,
  type Availability,
} from "../server/calendar";
import { getSquadGameEvents } from "../server/game-calendar";
import {
  addDays,
  localDateTime,
  mondayOf,
  localTimeCandidates,
  weekRange,
} from "../lib/calendar";

type GameResult = Awaited<ReturnType<typeof getSquadGameEvents>>;
export function SquadCalendar({ squadId }: { squadId: string }) {
  const user = useUser();
  const [timezone] = useState(
    () => Intl.DateTimeFormat().resolvedOptions().timeZone,
  );
  const today = localDateTime(Date.now(), timezone).slice(0, 10);
  const [week, setWeek] = useState(() => mondayOf(today));
  const [player, setPlayer] = useState("");
  const [activity, setActivity] = useState("");
  const [data, setData] = useState<{
    entries: Availability[];
    canCreate: boolean;
    ownedCharacters: { id: string; name: string }[];
  } | null>(null);
  const [events, setEvents] = useState<GameResult | null>(null);
  const [error, setError] = useState("");
  const [eventError, setEventError] = useState("");
  const [mutationError, setMutationError] = useState("");
  const [modal, setModal] = useState<Availability | "new" | null>(null);
  const [deleting, setDeleting] = useState<string | null>(null);
  const [revision, setRevision] = useState(0);
  const generation = useRef(0);
  const refresh = useCallback(() => setRevision((r) => r + 1), []);
  useEffect(() => {
    const refreshVisible = () => {
      if (document.visibilityState === "visible") refresh();
    };
    const timer = window.setInterval(refreshVisible, 60000);
    window.addEventListener("focus", refreshVisible);
    document.addEventListener("visibilitychange", refreshVisible);
    return () => {
      clearInterval(timer);
      window.removeEventListener("focus", refreshVisible);
      document.removeEventListener("visibilitychange", refreshVisible);
    };
  }, [refresh]);
  useEffect(() => {
    const request = ++generation.current;
    let active = true;
    const current = () => active && generation.current === request;
    let range: { from: number; to: number };
    try {
      range = weekRange(week, timezone);
    } catch (e) {
      setError(message(e));
      return;
    }
    void getSquadCalendar({ data: { squadId, ...range } })
      .then((result) => {
        if (current()) {
          setData(result);
          setError("");
        }
      })
      .catch((e) => {
        if (current()) setError(message(e));
      });
    void getSquadGameEvents({ data: { squadId, ...range } })
      .then((result) => {
        if (current()) {
          setEvents(result);
          setEventError("");
        }
      })
      .catch((e) => {
        if (current()) setEventError(message(e));
      });
    return () => {
      active = false;
    };
  }, [squadId, week, timezone, revision]);
  const days = Array.from({ length: 7 }, (_, index) => addDays(week, index));
  const entries = (data?.entries ?? [])
    .filter(
      (entry) =>
        (!player || entry.userId === player) &&
        (!activity || entry.activities.some((a) => a.category === activity)),
    )
    .sort(
      (a, b) =>
        a.startsAt - b.startsAt ||
        a.username.localeCompare(b.username) ||
        a.id.localeCompare(b.id),
    );
  const players = [
    ...new Map(
      (data?.entries ?? []).map((entry) => [entry.userId, entry.username]),
    ).entries(),
  ].sort((a, b) => a[1].localeCompare(b[1]));
  const formatDay = (day: string, options: Intl.DateTimeFormatOptions) =>
    new Intl.DateTimeFormat(undefined, { ...options, timeZone: "UTC" }).format(
      new Date(`${day}T12:00:00Z`),
    );
  const time = (epoch: number) =>
    new Intl.DateTimeFormat(undefined, {
      timeZone: timezone,
      month: "short",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
      timeZoneName: "short",
    }).format(epoch);
  function moveWeek(next: string) {
    refresh();
    setWeek(next);
    setData(null);
    setEvents(null);
    setError("");
    setEventError("");
  }
  async function save(value: AvailabilityInput) {
    if (!modal) return;
    const saved =
      modal === "new"
        ? await createAvailability({ data: { squadId, ...value } })
        : await updateAvailability({
            data: { id: modal.id, version: modal.version, ...value },
          });
    // Invalidate reads started before this mutation so they cannot restore an old version.
    generation.current += 1;
    setData(
      (current) =>
        current && {
          ...current,
          entries: [
            ...current.entries.filter((entry) => entry.id !== saved.id),
            saved,
          ],
        },
    );
    setModal(null);
    refresh();
  }
  function slots(day: string) {
    const from = localTimeCandidates(`${day}T00:00`, timezone)[0];
    const to = localTimeCandidates(`${addDays(day, 1)}T00:00`, timezone)[0];
    const dayEntries = entries.filter(
      (entry) => entry.startsAt < to && entry.endsAt > from,
    );
    return dayEntries.length ? (
      dayEntries.map((entry) => (
        <article className="availability-card" key={entry.id}>
          <strong>{entry.username}</strong>
          {entry.characterName && <p>Character: {entry.characterName}</p>}
          <p className="slot-time">
            {time(entry.startsAt)} – {time(entry.endsAt)}
          </p>
          {entry.activities.length ? (
            <ul className="slot-activities">
              {entry.activities.map((a, index) => (
                <li key={index}>
                  <span>{a.category}</span> {a.name}
                </li>
              ))}
            </ul>
          ) : (
            <p>General availability</p>
          )}
          {entry.note && <p className="slot-note">{entry.note}</p>}
          {entry.userId === user.id && (
            <div className="slot-actions">
              <button
                type="button"
                className="secondary-button"
                aria-label={`Edit availability by ${entry.username}`}
                onClick={() => setModal(entry)}
              >
                Edit
              </button>
              <button
                type="button"
                className="secondary-button danger"
                disabled={deleting === entry.id}
                aria-label={`Delete availability by ${entry.username}`}
                onClick={async () => {
                  if (!window.confirm("Delete this availability?")) return;
                  setDeleting(entry.id);
                  setMutationError("");
                  try {
                    await deleteAvailability({
                      data: { id: entry.id, version: entry.version },
                    });
                    generation.current += 1;
                    setData(
                      (current) =>
                        current && {
                          ...current,
                          entries: current.entries.filter(
                            (item) => item.id !== entry.id,
                          ),
                        },
                    );
                    refresh();
                  } catch (e) {
                    setMutationError(message(e));
                    refresh();
                  } finally {
                    setDeleting(null);
                  }
                }}
              >
                {deleting === entry.id ? "Deleting…" : "Delete"}
              </button>
            </div>
          )}
        </article>
      ))
    ) : (
      <p className="calendar-empty">No availability</p>
    );
  }
  return (
    <section className="squad-calendar" aria-label="Squad calendar">
      <div className="section-toolbar">
        <div>
          <h2>Squad calendar</h2>
          <p className="field-hint">
            Timezone: {timezone} · refreshes every 60 seconds
          </p>
        </div>
        {data?.canCreate && (
          <Button onClick={() => setModal("new")}>
            <Plus size={16} /> Add availability
          </Button>
        )}
      </div>
      <section className="game-events" aria-label="Automatic game events">
        <h3>Game events</h3>
        <ErrorNotice error={eventError} />
        {!events && !eventError && <p role="status">Loading game events…</p>}
        {events?.status === "unsupported" && (
          <p>Automatic Forever game events are not available yet.</p>
        )}
        {events &&
          events.status !== "ok" &&
          events.status !== "unsupported" && (
            <p role="status">
              Game events unavailable ({events.status.replaceAll("_", " ")}).{" "}
              {events.message}
            </p>
          )}
        {events?.status === "ok" && (
          <>
            {events.fetchedAt && (
              <p className="field-hint">
                Game events checked: {time(events.fetchedAt * 1000)}
              </p>
            )}
            {events.stale && (
              <p role="status">
                Showing cached game events. The provider could not refresh them.
              </p>
            )}
            {events.data.length ? (
              <div className="game-event-list">
                {[...events.data]
                  .sort((a, b) => a.startsAt - b.startsAt)
                  .map((event) => (
                    <article key={event.id}>
                      <strong>{event.title}</strong>
                      <p>
                        {event.category} · {time(event.startsAt)} –{" "}
                        {time(event.endsAt)}
                      </p>
                      <a
                        href={event.sourceUrl}
                        target="_blank"
                        rel="noreferrer"
                      >
                        Official source
                      </a>
                    </article>
                  ))}
              </div>
            ) : (
              <p>No game events this week.</p>
            )}
          </>
        )}
        {eventError && (
          <button className="secondary-button" onClick={refresh}>
            Retry game events
          </button>
        )}
      </section>
      <div className="calendar-controls">
        <div className="calendar-navigation">
          <button
            className="secondary-button"
            aria-label="Previous week"
            onClick={() => moveWeek(addDays(week, -7))}
          >
            <ChevronLeft size={16} />
          </button>
          <button
            className="secondary-button"
            onClick={() => {
              moveWeek(mondayOf(today));
            }}
          >
            Today
          </button>
          <button
            className="secondary-button"
            aria-label="Next week"
            onClick={() => moveWeek(addDays(week, 7))}
          >
            <ChevronRight size={16} />
          </button>
          <strong>
            {formatDay(week, {
              month: "short",
              day: "numeric",
              year: "numeric",
            })}{" "}
            – {formatDay(addDays(week, 6), { month: "short", day: "numeric" })}
          </strong>
        </div>
        <div className="calendar-filters">
          <Field label="Filter by player">
            <select value={player} onChange={(e) => setPlayer(e.target.value)}>
              <option value="">All players</option>
              {players.map(([id, username]) => (
                <option key={id} value={id}>
                  {username}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Filter by activity">
            <select
              value={activity}
              onChange={(e) => setActivity(e.target.value)}
            >
              <option value="">All activities</option>
              <option value="dungeon">Dungeon</option>
              <option value="raid">Raid</option>
              <option value="battleground">Battleground</option>
            </select>
          </Field>
        </div>
      </div>
      <ErrorNotice error={error} />
      <ErrorNotice error={mutationError} />
      {error && (
        <button className="secondary-button" onClick={refresh}>
          Retry availability
        </button>
      )}
      {!data && !error && <p role="status">Loading availability…</p>}
      {data && (
        <>
          {!data.canCreate && (
            <p className="field-hint">
              Read-only calendar: an administrator or a player who owns a
              character in this squad can add availability. You can still edit
              your existing entries.
            </p>
          )}
          {!entries.length && (
            <p className="calendar-empty" role="status">
              No availability this week
              {player || activity ? " matches these filters" : " yet"}.
            </p>
          )}
          <div className="calendar-week">
            {days.map((day) => (
              <section
                className={`calendar-day${day === today ? " is-today" : ""}`}
                key={day}
              >
                <h3>
                  {formatDay(day, {
                    weekday: "short",
                    day: "numeric",
                    month: "short",
                  })}
                </h3>
                {slots(day)}
              </section>
            ))}
          </div>
        </>
      )}
      {modal && (
        <Modal
          title={modal === "new" ? "Add availability" : "Edit availability"}
          onClose={() => setModal(null)}
        >
          <AvailabilityForm
            entry={modal === "new" ? undefined : modal}
            characters={data?.ownedCharacters ?? []}
            timezone={timezone}
            onSave={save}
            onCancel={() => setModal(null)}
          />
        </Modal>
      )}
    </section>
  );
}
