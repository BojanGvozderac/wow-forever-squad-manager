import { useState } from "react";
import { Button, ErrorNotice, Field, message } from "./app";
import type { Activity, Availability } from "../server/calendar";
import {
  localDateTime,
  localTimeCandidates,
  timezoneOffset,
} from "../lib/calendar";

export type AvailabilityInput = {
  characterId: string | null;
  startsAt: number;
  endsAt: number;
  activities: Activity[];
  note: string;
};
export function AvailabilityForm({
  entry,
  timezone,
  characters,
  onSave,
  onCancel,
}: {
  entry?: Availability;
  timezone: string;
  characters: { id: string; name: string }[];
  onSave: (value: AvailabilityInput) => Promise<void>;
  onCancel: () => void;
}) {
  const [start, setStart] = useState(() =>
    localDateTime(entry?.startsAt ?? Date.now(), timezone),
  );
  const [end, setEnd] = useState(() =>
    localDateTime(entry?.endsAt ?? Date.now() + 3600000, timezone),
  );
  const [startOffset, setStartOffset] = useState(
    entry ? String(entry.startsAt) : "",
  );
  const [endOffset, setEndOffset] = useState(entry ? String(entry.endsAt) : "");
  const [activities, setActivities] = useState<Activity[]>(
    entry?.activities ?? [],
  );
  const [characterId, setCharacterId] = useState(entry?.characterId ?? "");
  const unavailableCharacter = !!characterId && !characters.some((c) => c.id === characterId);
  const [note, setNote] = useState(entry?.note ?? "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const starts = localTimeCandidates(start, timezone),
    ends = localTimeCandidates(end, timezone);
  const offsetField = (
    label: string,
    candidates: number[],
    value: string,
    change: (value: string) => void,
  ) =>
    candidates.length > 1 && (
      <Field label={label}>
        <select required value={value} onChange={(e) => change(e.target.value)}>
          <option value="">Choose a UTC offset</option>
          {candidates.map((epoch) => (
            <option key={epoch} value={epoch}>
              {timezoneOffset(epoch, timezone)}
            </option>
          ))}
        </select>
      </Field>
    );
  return (
    <form
      onSubmit={async (event) => {
        event.preventDefault();
        setError("");
        const startsAt =
          starts.length === 1
            ? starts[0]
            : starts.find((value) => String(value) === startOffset);
        const endsAt =
          ends.length === 1
            ? ends[0]
            : ends.find((value) => String(value) === endOffset);
        if (!starts.length || !ends.length)
          return setError(
            "A selected local time does not exist in this timezone. Choose another time.",
          );
        if (startsAt === undefined || endsAt === undefined)
          return setError(
            "Choose an offset for each ambiguous daylight saving time.",
          );
        if (endsAt <= startsAt)
          return setError(
            "End must be after start. For overnight availability, choose the following date.",
          );
        if (endsAt - startsAt > 48 * 3600000)
          return setError("Availability cannot exceed 48 hours.");
        if (unavailableCharacter) return setError("Choose one of your current squad characters or select no character.");
        setBusy(true);
        try {
          await onSave({
            characterId: characterId || null,
            startsAt,
            endsAt,
            activities: activities.map((a) => ({ ...a, name: a.name.trim() })),
            note: note.trim(),
          });
        } catch (e) {
          setError(
            `${message(e)} Your draft is kept; close and reopen to load the latest saved version if another session changed it.`,
          );
        } finally {
          setBusy(false);
        }
      }}
    >
      <p className="field-hint">
        Timezone: <strong>{timezone}</strong>. Times use your local timezone.
        For overnight slots, set the end date to the next day.
      </p>
      <Field label="Character (optional)">
        <select aria-label="Character (optional)" value={characterId} onChange={(e) => setCharacterId(e.target.value)}>
          <option value="">No character selected</option>
          {unavailableCharacter && <option value={characterId} disabled>{entry?.characterName ?? "Previous character"} (no longer available)</option>}
          {characters.map((character) => <option key={character.id} value={character.id}>{character.name}</option>)}
        </select>
      </Field>
      <p className="field-hint">Only characters you own in this squad are available.</p>
      <Field label="Start (local date and time)">
        <input
          type="datetime-local"
          required
          value={start}
          onChange={(e) => {
            setStart(e.target.value);
            setStartOffset("");
          }}
        />
      </Field>
      {offsetField("Start offset", starts, startOffset, setStartOffset)}
      <Field label="End (local date and time)">
        <input
          type="datetime-local"
          required
          value={end}
          onChange={(e) => {
            setEnd(e.target.value);
            setEndOffset("");
          }}
        />
      </Field>
      {offsetField("End offset", ends, endOffset, setEndOffset)}
      <fieldset className="activity-fields">
        <legend>Activities (optional)</legend>
        <p className="field-hint">Leave empty for general availability.</p>
        {activities.map((activity, index) => (
          <div className="activity-row" key={index}>
            <Field label="Category">
              <select
                value={activity.category}
                onChange={(e) =>
                  setActivities(
                    activities.map((a, i) =>
                      i === index
                        ? {
                            ...a,
                            category: e.target.value as Activity["category"],
                          }
                        : a,
                    ),
                  )
                }
              >
                <option value="dungeon">Dungeon</option>
                <option value="raid">Raid</option>
                <option value="battleground">Battleground</option>
              </select>
            </Field>
            <Field label="Activity name">
              <input
                required
                maxLength={120}
                value={activity.name}
                onChange={(e) =>
                  setActivities(
                    activities.map((a, i) =>
                      i === index ? { ...a, name: e.target.value } : a,
                    ),
                  )
                }
              />
            </Field>
            <button
              type="button"
              className="secondary-button"
              aria-label={`Remove activity ${index + 1}`}
              onClick={() =>
                setActivities(activities.filter((_, i) => i !== index))
              }
            >
              Remove
            </button>
          </div>
        ))}
        <button
          type="button"
          className="secondary-button"
          disabled={activities.length >= 10}
          onClick={() =>
            setActivities([...activities, { category: "dungeon", name: "" }])
          }
        >
          Add activity
        </button>
      </fieldset>
      <Field label="Note (optional)">
        <textarea
          rows={3}
          maxLength={2000}
          value={note}
          onChange={(e) => setNote(e.target.value)}
        />
      </Field>
      <ErrorNotice error={error} />
      <div className="form-actions">
        <button
          className="secondary-button"
          type="button"
          onClick={onCancel}
          disabled={busy}
        >
          Cancel
        </button>
        <Button disabled={busy}>
          {busy ? "Saving…" : "Save availability"}
        </Button>
      </div>
    </form>
  );
}
