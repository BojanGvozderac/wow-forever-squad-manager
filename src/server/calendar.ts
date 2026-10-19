import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { assertMutationOrigin, requireUser, type User } from "./auth";
import { activeUser } from "./domain";
import { commitWrite, replayWrite, type WriteContext } from "./domain-writes";
import { db, required } from "./db";
import { DomainError } from "./domain-errors";

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
export const calendarDetails = z.object({
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

export const calendarRangeInput = z.object({ squadId: id, from: time, to: time }).refine(
  (data) => data.to > data.from && data.to - data.from <= 42 * day,
  "Calendar range must be positive and at most 42 days",
);
export const calendarCreateInput = calendarDetails.extend({ squadId: id }).refine(validInterval, "Availability must last more than zero and at most 48 hours");
export const calendarUpdateInput = calendarDetails.omit({ characterId: true }).partial().extend({ characterId: id.nullable().optional(), id, version });
export const calendarDeleteInput = z.object({ id, version });
export async function getSquadCalendarForUser(user: User, input: z.input<typeof calendarRangeInput>) {
    await activeUser(user);
    const data = calendarRangeInput.parse(input);
    await required("SELECT id FROM squads WHERE id=?", data.squadId);
    const rows = await db().prepare(
      `SELECT ${columns},(SELECT username FROM users WHERE id=user_id) AS username FROM availability_entries WHERE squad_id=? AND starts_at<? AND ends_at>? ORDER BY starts_at,id`,
    ).bind(data.squadId, data.to, data.from).all<AvailabilityRow & { username: string }>();
    const allowed = await db().prepare(`SELECT ${eligible} AS allowed`)
      .bind(user.id, data.squadId).first<{ allowed: number }>();
    const ownedCharacters = await db().prepare(
      "SELECT c.id,c.name FROM characters c JOIN squad_characters sc ON sc.character_id=c.id WHERE sc.squad_id=? AND c.owner_id=? ORDER BY c.name,c.id",
    ).bind(data.squadId, user.id).all<{ id: string; name: string }>();
    return { ownedCharacters: ownedCharacters.results,
      entries: rows.results.map(({ username, ...row }) => availability(row, username)),
      canCreate: Boolean(allowed?.allowed) };
}
const resultJson = "SELECT json_object('id',id,'squadId',squad_id,'userId',user_id,'startsAt',starts_at,'endsAt',ends_at,'activitiesJson',activities_json,'characterId',character_id,'characterName',(SELECT name FROM characters WHERE id=character_id),'note',note,'version',version,'createdAt',created_at,'updatedAt',updated_at) FROM availability_entries WHERE id=?";
export async function createAvailabilityForUser(user: User, input: z.input<typeof calendarCreateInput>, context?: WriteContext): Promise<Availability> {
    user = await activeUser(user);
    const data = calendarCreateInput.parse(input);
    // Recheck current eligibility and character ownership before an idempotent replay.
    const allowed = await db().prepare(`SELECT EXISTS(SELECT 1 FROM squads WHERE id=?) AND ${eligible} AND ${validCharacter} AS allowed`)
      .bind(data.squadId,user.id,data.squadId,data.characterId,data.characterId,user.id,data.squadId).first<{allowed:number}>();
    if (!allowed?.allowed) throw new DomainError("forbidden", "You must own a character in this squad to create availability, and any selected character must be yours and in this squad");
    const replay = await replayWrite<AvailabilityRow>(user,data,context);
    if (replay) return availability(replay,user.username);
    const entryId = crypto.randomUUID();
    const row = await commitWrite<AvailabilityRow>(user,db().prepare(
      `INSERT INTO availability_entries(id,squad_id,user_id,starts_at,ends_at,activities_json,note,character_id) SELECT ?,?,?,?,?,?,?,? WHERE EXISTS(SELECT 1 FROM squads WHERE id=?) AND ${eligible} AND ${validCharacter} RETURNING ${columns}`,
    ).bind(entryId, data.squadId, user.id, data.startsAt, data.endsAt,
      JSON.stringify(data.activities), data.note, data.characterId, data.squadId, user.id, data.squadId, data.characterId, data.characterId, user.id, data.squadId),entryId,context,{input:data,resultSql:resultJson,bindings:[entryId],authorize:async () => {
      await activeUser(user);
      const stillAllowed = await db().prepare(`SELECT EXISTS(SELECT 1 FROM squads WHERE id=?) AND ${eligible} AND ${validCharacter} AS allowed`).bind(data.squadId,user.id,data.squadId,data.characterId,data.characterId,user.id,data.squadId).first<{allowed:number}>();
      if (!stillAllowed?.allowed) throw new DomainError("forbidden", "You must own a character in this squad to create availability, and any selected character must be yours and in this squad");
    }});
    if (!row) throw new DomainError("forbidden", "You must own a character in this squad to create availability, and any selected character must be yours and in this squad");
    return availability(row, user.username);
}
export async function updateAvailabilityForUser(user: User, input: z.input<typeof calendarUpdateInput>, context?: WriteContext): Promise<Availability> {
    user = await activeUser(user);
    const patch = calendarUpdateInput.parse(input);
    const current = await db().prepare(`SELECT ${columns} FROM availability_entries WHERE id=? AND user_id=?`).bind(patch.id,user.id).first<AvailabilityRow>();
    if (!current) throw new DomainError("forbidden", "Availability changed or you are not its author. Reload the calendar and try again.");
    const data = { ...calendarDetails.parse({...current,activities:JSON.parse(current.activitiesJson)}), ...patch };
    if (!validInterval(data)) throw new DomainError("invalid_input", "Availability must last more than zero and at most 48 hours");
    const row = await commitWrite<AvailabilityRow>(user,db().prepare(
      `UPDATE availability_entries SET starts_at=?,ends_at=?,activities_json=?,note=?,character_id=?,version=version+1,updated_at=CURRENT_TIMESTAMP WHERE id=? AND user_id=? AND version=? AND EXISTS(SELECT 1 FROM users WHERE id=? AND disabled=0) AND (? IS NULL OR EXISTS(SELECT 1 FROM characters c JOIN squad_characters sc ON sc.character_id=c.id WHERE c.id=? AND c.owner_id=? AND sc.squad_id=availability_entries.squad_id)) RETURNING ${columns}`,
    ).bind(data.startsAt, data.endsAt, JSON.stringify(data.activities), data.note, data.characterId, data.id, user.id, data.version, user.id, data.characterId, data.characterId, user.id),data.id,context);
    if (!row) throw new DomainError("conflict", "Availability changed, you are not its author, or the selected character is no longer yours in this squad. Reload the calendar and try again.");
    return availability(row, user.username);
}
export async function deleteAvailabilityForUser(user: User, input: z.input<typeof calendarDeleteInput>, context?: WriteContext) {
    await activeUser(user);
    const data = calendarDeleteInput.parse(input);
    const current = await db().prepare("SELECT id FROM availability_entries WHERE id=? AND user_id=?").bind(data.id,user.id).first<{id:string}>();
    if (!current) throw new DomainError("forbidden", "Availability changed or you are not its author. Reload the calendar and try again.");
    const row = await commitWrite<{id:string}>(user,db().prepare(
      "DELETE FROM availability_entries WHERE id=? AND user_id=? AND version=? AND EXISTS(SELECT 1 FROM users WHERE id=? AND disabled=0) RETURNING id",
    ).bind(data.id, user.id, data.version,user.id),data.id,context);
    if (!row) throw new DomainError("conflict", "Availability changed or you are not its author. Reload the calendar and try again.");
    return { ok: true };
}
export const getSquadCalendar = createServerFn({ method: "GET" }).validator(calendarRangeInput)
  .handler(async ({ data }) => getSquadCalendarForUser(await requireUser(),data));
export const createAvailability = createServerFn({ method: "POST" }).validator(calendarCreateInput)
  .handler(async ({ data }) => { assertMutationOrigin(); return createAvailabilityForUser(await requireUser(),data); });
export const updateAvailability = createServerFn({ method: "POST" }).validator(calendarDetails.extend({id,version}).refine(validInterval,"Availability must last more than zero and at most 48 hours"))
  .handler(async ({ data }) => { assertMutationOrigin(); return updateAvailabilityForUser(await requireUser(),data); });
export const deleteAvailability = createServerFn({ method: "POST" }).validator(calendarDeleteInput)
  .handler(async ({ data }) => { assertMutationOrigin(); return deleteAvailabilityForUser(await requireUser(),data); });
