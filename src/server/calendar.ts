import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { assertMutationOrigin, requireUser } from "./auth";
import { db, required } from "./db";

export type Activity = {
  category: "dungeon" | "raid" | "battleground";
  name: string;
};
export type Availability = {
  id: string;
  squadId: string;
  userId: string;
  username: string;
  characterId: string | null;
  characterName: string | null;
  startsAt: number;
  endsAt: number;
  activities: Activity[];
  note: string;
  version: number;
  createdAt: string;
  updatedAt: string;
};
type AvailabilityRow = Omit<Availability, "activities" | "username"> & {
  activitiesJson: string;
};
const day = 24 * 60 * 60 * 1000;
const id = z.string().min(1).max(100);
const time = z.number().finite().int().min(-8640000000000000).max(8640000000000000);
const version = z.number().int().min(1).max(Number.MAX_SAFE_INTEGER);
const details = z.object({
  characterId: id.nullable().optional().default(null),
  startsAt: time,
  endsAt: time,
  activities: z.array(z.object({
    category: z.enum(["dungeon", "raid", "battleground"]),
    name: z.string().trim().min(1).max(120),
  })).max(10),
  note: z.string().max(2000),
});
const validInterval = (data: { startsAt: number; endsAt: number }) =>
  data.endsAt > data.startsAt && data.endsAt - data.startsAt <= 2 * day;
const columns = "id,squad_id AS squadId,user_id AS userId,starts_at AS startsAt,ends_at AS endsAt,activities_json AS activitiesJson,character_id AS characterId,(SELECT name FROM characters WHERE id=character_id) AS characterName,note,version,created_at AS createdAt,updated_at AS updatedAt";
const eligible = "EXISTS(SELECT 1 FROM users u WHERE u.id=? AND u.disabled=0 AND (u.role='admin' OR EXISTS(SELECT 1 FROM squad_characters sc JOIN characters c ON c.id=sc.character_id WHERE sc.squad_id=? AND c.owner_id=u.id)))";
const validCharacter = "(? IS NULL OR EXISTS(SELECT 1 FROM characters c JOIN squad_characters sc ON sc.character_id=c.id WHERE c.id=? AND c.owner_id=? AND sc.squad_id=?))";
function availability(row: AvailabilityRow, username: string): Availability {
  const { activitiesJson, ...entry } = row;
  return { ...entry, username, activities: JSON.parse(activitiesJson) as Activity[] };
}

export const getSquadCalendar = createServerFn({ method: "GET" })
  .validator(z.object({ squadId: id, from: time, to: time }).refine(
    (data) => data.to > data.from && data.to - data.from <= 42 * day,
    "Calendar range must be positive and at most 42 days",
  ))
  .handler(async ({ data }) => {
    const user = await requireUser();
    await required("SELECT id FROM squads WHERE id=?", data.squadId);
    const rows = await db().prepare(
      `SELECT ${columns},(SELECT username FROM users WHERE id=user_id) AS username FROM availability_entries WHERE squad_id=? AND starts_at<? AND ends_at>? ORDER BY starts_at,id`,
    ).bind(data.squadId, data.to, data.from).all<AvailabilityRow & { username: string }>();
    const allowed = await db().prepare(`SELECT ${eligible} AS allowed`)
      .bind(user.id, data.squadId).first<{ allowed: number }>();
    const ownedCharacters = await db().prepare(
      "SELECT c.id,c.name FROM characters c JOIN squad_characters sc ON sc.character_id=c.id WHERE sc.squad_id=? AND c.owner_id=? ORDER BY c.name,c.id",
    ).bind(data.squadId, user.id).all<{ id: string; name: string }>();
    return {
      ownedCharacters: ownedCharacters.results,
      entries: rows.results.map(({ username, ...row }) => availability(row, username)),
      canCreate: Boolean(allowed?.allowed),
    };
  });

export const createAvailability = createServerFn({ method: "POST" })
  .validator(details.extend({ squadId: id }).refine(validInterval, "Availability must last more than zero and at most 48 hours"))
  .handler(async ({ data }) => {
    assertMutationOrigin();
    const user = await requireUser();
    const row = await db().prepare(
      `INSERT INTO availability_entries(id,squad_id,user_id,starts_at,ends_at,activities_json,note,character_id) SELECT ?,?,?,?,?,?,?,? WHERE EXISTS(SELECT 1 FROM squads WHERE id=?) AND ${eligible} AND ${validCharacter} RETURNING ${columns}`,
    ).bind(crypto.randomUUID(), data.squadId, user.id, data.startsAt, data.endsAt,
      JSON.stringify(data.activities), data.note, data.characterId, data.squadId, user.id, data.squadId, data.characterId, data.characterId, user.id, data.squadId).first<AvailabilityRow>();
    if (!row) throw new Error("You must own a character in this squad to create availability, and any selected character must be yours and in this squad");
    return availability(row, user.username);
  });

export const updateAvailability = createServerFn({ method: "POST" })
  .validator(details.extend({ id, version }).refine(validInterval, "Availability must last more than zero and at most 48 hours"))
  .handler(async ({ data }) => {
    assertMutationOrigin();
    const user = await requireUser();
    const row = await db().prepare(
      `UPDATE availability_entries SET starts_at=?,ends_at=?,activities_json=?,note=?,character_id=?,version=version+1,updated_at=CURRENT_TIMESTAMP WHERE id=? AND user_id=? AND version=? AND (? IS NULL OR EXISTS(SELECT 1 FROM characters c JOIN squad_characters sc ON sc.character_id=c.id WHERE c.id=? AND c.owner_id=? AND sc.squad_id=availability_entries.squad_id)) RETURNING ${columns}`,
    ).bind(data.startsAt, data.endsAt, JSON.stringify(data.activities), data.note, data.characterId, data.id, user.id, data.version, data.characterId, data.characterId, user.id).first<AvailabilityRow>();
    if (!row) throw new Error("Availability changed, you are not its author, or the selected character is no longer yours in this squad. Reload the calendar and try again.");
    return availability(row, user.username);
  });

export const deleteAvailability = createServerFn({ method: "POST" })
  .validator(z.object({ id, version }))
  .handler(async ({ data }) => {
    assertMutationOrigin();
    const user = await requireUser();
    const result = await db().prepare(
      "DELETE FROM availability_entries WHERE id=? AND user_id=? AND version=?",
    ).bind(data.id, user.id, data.version).run();
    if (!result.meta.changes) throw new Error("Availability changed or you are not its author. Reload the calendar and try again.");
    return { ok: true };
  });
