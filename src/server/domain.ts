import type { Region } from "../lib/regions";
import type { User } from "./auth";
import { db, required } from "./db";
import { wishlistSaveInput, wishlistUpdateInput, wishlistDeleteInput, characterInput, squadInput } from "./domain-schemas";
import type { z } from "zod";
import { commitWrite, replayWrite, type WriteContext } from "./domain-writes";

export type JsonValue =
  string | number | boolean | null | JsonValue[] | { [key: string]: JsonValue };
export type CharacterSection = {
  section: string;
  value: JsonValue;
  fetchedAt: number;
  status: string;
  error: string | null;
};
export type Ruleset = "normal" | "pvp" | "roleplay";
export type Squad = {
  id: string;
  name: string;
  region: Region;
  ruleset: Ruleset;
  createdAt: string;
};
export type Character = {
  id: string;
  name: string;
  normalizedName: string;
  region: Region;
  ruleset: Ruleset;
  ownerId: string | null;
  verified: boolean;
  provider: string | null;
  externalId: string | null;
  profile: { [key: string]: JsonValue };
  sections?: CharacterSection[];
  syncStatus: string;
  syncError: string | null;
  lastSyncedAt: string | null;
  createdAt: string;
};
export type WishlistEntry = {
  id: string;
  characterId: string;
  category: "item" | "enchant" | "recipe" | "other";
  priority: "high" | "normal" | "low";
  status: "wanted" | "acquired";
  title: string;
  notes: string;
  sourceUrl: string | null;
  catalogRef: string | null;
  createdAt: string;
  updatedAt: string;
  version: number;
};
export const squadColumns = "id,name,region,ruleset,created_at AS createdAt";
export const characterColumns =
  "id,name,normalized_name AS normalizedName,region,ruleset,owner_id AS ownerId,verified,provider,external_id AS externalId,profile_json AS profileJson,sync_status AS syncStatus,sync_error AS syncError,last_synced_at AS lastSyncedAt,created_at AS createdAt";
const wishlistColumns =
  "id,character_id AS characterId,category,priority,status,title,notes,source_url AS sourceUrl,catalog_ref AS catalogRef,created_at AS createdAt,updated_at AS updatedAt,version";
export function character(row: Record<string, unknown>): Character {
  const { profileJson, ...rest } = row;
  let profile: { [key: string]: JsonValue } = {};
  try {
    profile = JSON.parse(String(profileJson));
  } catch {
    /* Retain a usable page if a provider snapshot is corrupt. */
  }
  return { ...rest, verified: Boolean(row.verified), profile } as Character;
}
export async function fetchCharacter(characterId: string): Promise<Character> {
  const result = character(
    await required<Record<string, unknown>>(
      `SELECT ${characterColumns} FROM characters WHERE id=?`,
      characterId,
    ),
  );
  const sections = await db()
    .prepare(
      "SELECT section,value_json AS valueJson,fetched_at AS fetchedAt,status,error FROM character_sections WHERE character_id=? ORDER BY section",
    )
    .bind(characterId)
    .all<{
      section: string;
      valueJson: string | null;
      fetchedAt: number;
      status: string;
      error: string | null;
    }>();
  result.sections = sections.results.map(({ valueJson, ...row }) => ({
    ...row,
    value: valueJson ? (JSON.parse(valueJson) as JsonValue) : null,
  }));
  return result;
}

export async function activeUser(user: User): Promise<User> {
  const current = await db().prepare("SELECT id,username,role FROM users WHERE id=? AND disabled=0").bind(user.id).first<User>();
  if (!current) throw new Error("Please sign in");
  return current;
}
export async function listSquadsForUser(user: User): Promise<Squad[]> {
  await activeUser(user);
  return (await db().prepare(`SELECT ${squadColumns} FROM squads ORDER BY created_at,id`).all<Squad>()).results;
}
export async function getSquadForUser(user: User, input: z.input<typeof squadInput>) {
  await activeUser(user);
  const { squadId } = squadInput.parse(input);
  const squad = await required<Squad>(`SELECT ${squadColumns} FROM squads WHERE id=?`,squadId);
  const rows = await db().prepare(`SELECT ${characterColumns} FROM characters WHERE id IN (SELECT character_id FROM squad_characters WHERE squad_id=?) ORDER BY name,id`).bind(squadId).all<Record<string,unknown>>();
  return { squad, characters: rows.results.map(character) };
}
export async function listCharactersForUser(user: User): Promise<Character[]> {
  await activeUser(user);
  return (await db().prepare(`SELECT ${characterColumns} FROM characters ORDER BY name,id`).all<Record<string,unknown>>()).results.map(character);
}
export async function getCharacterForUser(user: User, input: z.input<typeof characterInput>): Promise<Character> {
  await activeUser(user);
  return fetchCharacter(characterInput.parse(input).characterId);
}
export async function listWishlistForUser(user: User, input: z.input<typeof characterInput>): Promise<WishlistEntry[]> {
  await activeUser(user);
  const { characterId } = characterInput.parse(input);
  await required("SELECT id FROM characters WHERE id=?",characterId);
  return (await db().prepare(`SELECT ${wishlistColumns} FROM wishlist_entries WHERE character_id=? ORDER BY CASE status WHEN 'wanted' THEN 0 ELSE 1 END,CASE priority WHEN 'high' THEN 0 WHEN 'normal' THEN 1 ELSE 2 END,created_at DESC,id`).bind(characterId).all<WishlistEntry>()).results;
}
async function owner(user: User, characterId: string) {
  await activeUser(user);
  const row = await required<{owner_id:string|null}>("SELECT owner_id FROM characters WHERE id=?",characterId);
  if (row.owner_id !== user.id) throw new Error("Only the character owner can edit this wishlist");
}
const wishlistAllowed = "EXISTS(SELECT 1 FROM characters c JOIN users u ON u.id=c.owner_id WHERE c.id=? AND c.owner_id=? AND u.disabled=0)";
const wishlistJson = "SELECT json_object('id',id,'characterId',character_id,'category',category,'priority',priority,'status',status,'title',title,'notes',notes,'sourceUrl',source_url,'catalogRef',catalog_ref,'version',version,'createdAt',created_at,'updatedAt',updated_at) FROM wishlist_entries WHERE id=?";
export async function saveWishlistForUser(user: User, input: z.input<typeof wishlistSaveInput>, context?: WriteContext): Promise<WishlistEntry> {
  const data = wishlistSaveInput.parse(input);
  if (data.id) return updateWishlistForUser(user,{...data,id:data.id,version:data.version!},context);
  await owner(user,data.characterId);
  const replay = await replayWrite<WishlistEntry>(user,data,context);
  if (replay) return replay;
  const entryId = crypto.randomUUID();
  const statement = db().prepare(`INSERT INTO wishlist_entries(id,character_id,category,priority,status,title,notes,source_url,catalog_ref) SELECT ?,?,?,?,?,?,?,?,? WHERE ${wishlistAllowed} RETURNING ${wishlistColumns}`)
    .bind(entryId,data.characterId,data.category,data.priority,data.status,data.title,data.notes,data.sourceUrl ?? null,data.catalogRef ?? null,data.characterId,user.id);
  const row = await commitWrite<WishlistEntry>(user,statement,entryId,context,{input:data,resultSql:wishlistJson,bindings:[entryId],authorize:() => owner(user,data.characterId)});
  if (!row) throw new Error("Wishlist entry or owner has changed");
  return row;
}
export async function updateWishlistForUser(user: User, input: z.input<typeof wishlistUpdateInput>, context?: WriteContext): Promise<WishlistEntry> {
  const data = wishlistUpdateInput.parse(input);
  await owner(user,data.characterId);
  const current = await required<WishlistEntry>(`SELECT ${wishlistColumns} FROM wishlist_entries WHERE id=? AND character_id=?`,data.id,data.characterId);
  const merged = { ...current, ...data };
  const row = await commitWrite<WishlistEntry>(user,db().prepare(`UPDATE wishlist_entries SET category=?,priority=?,status=?,title=?,notes=?,source_url=?,catalog_ref=?,version=version+1,updated_at=CURRENT_TIMESTAMP WHERE id=? AND character_id=? AND version=? AND ${wishlistAllowed} RETURNING ${wishlistColumns}`)
    .bind(merged.category,merged.priority,merged.status,merged.title,merged.notes,merged.sourceUrl ?? null,merged.catalogRef ?? null,data.id,data.characterId,data.version,data.characterId,user.id),data.id,context);
  if (!row) throw new Error("Wishlist entry changed or owner has changed. Reload the wishlist and try again.");
  return row;
}
export async function deleteWishlistForUser(user: User, input: z.input<typeof wishlistDeleteInput>, context?: WriteContext) {
  const data = wishlistDeleteInput.parse(input);
  await owner(user,data.characterId);
  const row = await commitWrite<{id:string}>(user,db().prepare(`DELETE FROM wishlist_entries WHERE id=? AND character_id=? AND version=? AND ${wishlistAllowed} RETURNING id`).bind(data.id,data.characterId,data.version,data.characterId,user.id),data.id,context);
  if (!row) throw new Error("Wishlist entry changed or owner has changed. Reload the wishlist and try again.");
  return { ok: true };
}
