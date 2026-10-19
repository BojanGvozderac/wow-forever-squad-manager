import { regions, type Region } from "../lib/regions";
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import {
  assertMutationOrigin,
  attemptLogin,
  endSession,
  requireUser,
  sessionUser,
  randomKey,
  sha256,
} from "./auth";
import { db, required } from "./db";
export type { User } from "./auth";

export const createPlayer = createServerFn({ method: "POST" })
  .validator(z.object({ username: z.string().trim().regex(/^[a-z0-9_-]{1,80}$/, "Use 1–80 lowercase letters, numbers, underscores, or hyphens.").refine((value) => value !== "admin", "The username admin is reserved.") }))
  .handler(async ({ data }) => {
    await adminMutation();
    const key = randomKey();
    const user = await db().prepare(
      "INSERT INTO users(id,username,key_hash,role) VALUES (?,?,?,'player') ON CONFLICT(username) DO NOTHING RETURNING id,username,role",
    ).bind(crypto.randomUUID(), data.username, await sha256(key)).first<import("./auth").User>();
    if (!user) throw new Error("That username is already taken.");
    return { user, key };
  });

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
};
const ruleset = z.enum(["normal", "pvp", "roleplay"]);
const id = z.string().min(1).max(100);
const squadInput = z.object({ squadId: id });
const characterInput = z.object({ characterId: id });
const membershipInput = squadInput.extend({ characterId: id });
const name = z.string().trim().min(1).max(80);
const squadColumns = "id,name,region,ruleset,created_at AS createdAt";
const characterColumns =
  "id,name,normalized_name AS normalizedName,region,ruleset,owner_id AS ownerId,verified,provider,external_id AS externalId,profile_json AS profileJson,sync_status AS syncStatus,sync_error AS syncError,last_synced_at AS lastSyncedAt,created_at AS createdAt";
const wishlistColumns =
  "id,character_id AS characterId,category,priority,status,title,notes,source_url AS sourceUrl,catalog_ref AS catalogRef,created_at AS createdAt,updated_at AS updatedAt";
function character(row: Record<string, unknown>): Character {
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
async function adminMutation() {
  assertMutationOrigin();
  return requireUser(true);
}
async function ownerMutation(characterId: string) {
  assertMutationOrigin();
  const user = await requireUser();
  const row = await required<{ owner_id: string | null }>(
    "SELECT owner_id FROM characters WHERE id=?",
    characterId,
  );
  if (row.owner_id !== user.id)
    throw new Error("Only the character owner can edit this wishlist");
  return user;
}
export const getSession = createServerFn({ method: "GET" }).handler(
  async () => ({ user: await sessionUser() }),
);
export const login = createServerFn({ method: "POST" })
  .validator(
    z.object({
      username: z.string().trim().toLowerCase().min(1).max(80),
      key: z.string().min(1).max(200),
    }),
  )
  .handler(({ data }) => attemptLogin(data.username, data.key));
export const logout = createServerFn({ method: "POST" }).handler(() =>
  endSession(),
);
export const listSquads = createServerFn({ method: "GET" }).handler(
  async () => {
    await requireUser();
    return (
      await db()
        .prepare(`SELECT ${squadColumns} FROM squads ORDER BY created_at,id`)
        .all<Squad>()
    ).results;
  },
);
export const createSquad = createServerFn({ method: "POST" })
  .validator(z.object({ name, ruleset, region: z.enum(regions).default("eu") }))
  .handler(async ({ data }) => {
    await adminMutation();
    const squadId = crypto.randomUUID();
    await db()
      .prepare("INSERT INTO squads(id,name,region,ruleset) VALUES (?,?,?,?)")
      .bind(squadId, data.name, data.region, data.ruleset)
      .run();
    return required<Squad>(
      `SELECT ${squadColumns} FROM squads WHERE id=?`,
      squadId,
    );
  });
export const updateSquad = createServerFn({ method: "POST" })
  .validator(squadInput.extend({ name, ruleset }))
  .handler(async ({ data }) => {
    await adminMutation();
    const result = await db()
      .prepare(
        "UPDATE squads SET name=?,ruleset=? WHERE id=? AND (ruleset=? OR NOT EXISTS(SELECT 1 FROM squad_characters WHERE squad_id=?))",
      )
      .bind(data.name, data.ruleset, data.squadId, data.ruleset, data.squadId)
      .run();
    if (!result.meta.changes)
      throw new Error(
        "Squad not found or ruleset cannot change while it contains characters",
      );
    return required<Squad>(
      `SELECT ${squadColumns} FROM squads WHERE id=?`,
      data.squadId,
    );
  });
export const deleteSquad = createServerFn({ method: "POST" })
  .validator(squadInput)
  .handler(async ({ data }) => {
    await adminMutation();
    await db()
      .prepare("DELETE FROM squads WHERE id=?")
      .bind(data.squadId)
      .run();
    return { ok: true };
  });
export const getSquad = createServerFn({ method: "GET" })
  .validator(squadInput)
  .handler(async ({ data }) => {
    await requireUser();
    const squad = await required<Squad>(
      `SELECT ${squadColumns} FROM squads WHERE id=?`,
      data.squadId,
    );
    const rows = await db()
      .prepare(
        `SELECT ${characterColumns} FROM characters WHERE id IN (SELECT character_id FROM squad_characters WHERE squad_id=?) ORDER BY name,id`,
      )
      .bind(data.squadId)
      .all<Record<string, unknown>>();
    return { squad, characters: rows.results.map(character) };
  });
export const addPlaceholder = createServerFn({ method: "POST" })
  .validator(squadInput.extend({ name }))
  .handler(async ({ data }) => {
    await adminMutation();
    const squad = await required<Squad>(
      `SELECT ${squadColumns} FROM squads WHERE id=?`,
      data.squadId,
    );
    const normalized = data.name.normalize("NFKC").toLowerCase();
    // A single batch both creates/reuses a placeholder and associates it with the squad.
    await db().batch([
      db()
        .prepare(
          "INSERT INTO characters(id,name,normalized_name,region,ruleset) SELECT ?,?,?,?,? WHERE NOT EXISTS(SELECT 1 FROM characters WHERE region=? AND ruleset=? AND normalized_name=? AND verified=0)",
        )
        .bind(
          crypto.randomUUID(),
          data.name,
          normalized,
          squad.region,
          squad.ruleset,
          squad.region,
          squad.ruleset,
          normalized,
        ),
      db()
        .prepare(
          "INSERT OR IGNORE INTO squad_characters(squad_id,character_id) SELECT ?,id FROM characters WHERE region=? AND ruleset=? AND normalized_name=? AND verified=0",
        )
        .bind(data.squadId, squad.region, squad.ruleset, normalized),
    ]);
    return character(
      await required<Record<string, unknown>>(
        `SELECT ${characterColumns} FROM characters WHERE region=? AND ruleset=? AND normalized_name=? AND verified=0`,
        squad.region,
        squad.ruleset,
        normalized,
      ),
    );
  });
export const addCharacterToSquad = createServerFn({ method: "POST" })
  .validator(membershipInput)
  .handler(async ({ data }) => {
    await adminMutation();
    await db()
      .prepare(
        "INSERT OR IGNORE INTO squad_characters(squad_id,character_id) VALUES (?,?)",
      )
      .bind(data.squadId, data.characterId)
      .run();
    return { ok: true };
  });
export const removeCharacterFromSquad = createServerFn({ method: "POST" })
  .validator(membershipInput)
  .handler(async ({ data }) => {
    await adminMutation();
    await db()
      .prepare(
        "DELETE FROM squad_characters WHERE squad_id=? AND character_id=?",
      )
      .bind(data.squadId, data.characterId)
      .run();
    return { ok: true };
  });
export const assignOwner = createServerFn({ method: "POST" })
  .validator(characterInput.extend({ ownerId: id.nullable() }))
  .handler(async ({ data }) => {
    await adminMutation();
    if (data.ownerId)
      await required(
        "SELECT id FROM users WHERE id=? AND disabled=0",
        data.ownerId,
      );
    await required("SELECT id FROM characters WHERE id=?", data.characterId);
    await db()
      .prepare("UPDATE characters SET owner_id=? WHERE id=?")
      .bind(data.ownerId, data.characterId)
      .run();
    return { ok: true };
  });
export const listUsers = createServerFn({ method: "GET" }).handler(async () => {
  await requireUser();
  return (
    await db()
      .prepare(
        "SELECT id,username,role FROM users WHERE disabled=0 ORDER BY username",
      )
      .all<import("./auth").User>()
  ).results;
});
export const getCharacter = createServerFn({ method: "GET" })
  .validator(characterInput)
  .handler(async ({ data }) => {
    await requireUser();
    return fetchCharacter(data.characterId);
  });
export const listCharacters = createServerFn({ method: "GET" }).handler(
  async () => {
    await requireUser();
    return (
      await db()
        .prepare(`SELECT ${characterColumns} FROM characters ORDER BY name,id`)
        .all<Record<string, unknown>>()
    ).results.map(character);
  },
);
export const deleteCharacter = createServerFn({ method: "POST" })
  .validator(characterInput)
  .handler(async ({ data }) => {
    await adminMutation();
    const result = await db()
      .prepare(
        "DELETE FROM characters WHERE id=? AND NOT EXISTS(SELECT 1 FROM squad_characters WHERE character_id=?)",
      )
      .bind(data.characterId, data.characterId)
      .run();
    if (!result.meta.changes)
      throw new Error(
        "Remove the character from all squads before permanently deleting it",
      );
    return { ok: true };
  });
export const listWishlist = createServerFn({ method: "GET" })
  .validator(characterInput)
  .handler(async ({ data }) => {
    await requireUser();
    return (
      await db()
        .prepare(
          `SELECT ${wishlistColumns} FROM wishlist_entries WHERE character_id=? ORDER BY CASE status WHEN 'wanted' THEN 0 ELSE 1 END,CASE priority WHEN 'high' THEN 0 WHEN 'normal' THEN 1 ELSE 2 END,created_at DESC,id`,
        )
        .bind(data.characterId)
        .all<WishlistEntry>()
    ).results;
  });
const wishlistInput = characterInput.extend({
  id: id.optional(),
  category: z.enum(["item", "enchant", "recipe", "other"]),
  priority: z.enum(["high", "normal", "low"]),
  status: z.enum(["wanted", "acquired"]),
  title: z.string().trim().min(1).max(200),
  notes: z.string().max(4000).optional().default(""),
  sourceUrl: z
    .string()
    .url()
    .max(2000)
    .refine(
      (value) => new URL(value).protocol === "https:",
      "Source URL must use HTTPS",
    )
    .nullable()
    .optional(),
  catalogRef: z.string().max(2000).nullable().optional(),
});
export const saveWishlistEntry = createServerFn({ method: "POST" })
  .validator(wishlistInput)
  .handler(async ({ data }) => {
    const user = await ownerMutation(data.characterId);
    const entryId = data.id ?? crypto.randomUUID();
    // Repeat ownership in SQL so a concurrent reassignment cannot authorize stale writes.
    const result = await db()
      .prepare(
        `INSERT INTO wishlist_entries(id,character_id,category,priority,status,title,notes,source_url,catalog_ref) SELECT ?,?,?,?,?,?,?,?,? WHERE EXISTS(SELECT 1 FROM characters WHERE id=? AND owner_id=?) ON CONFLICT(id) DO UPDATE SET category=excluded.category,priority=excluded.priority,status=excluded.status,title=excluded.title,notes=excluded.notes,source_url=excluded.source_url,catalog_ref=excluded.catalog_ref,updated_at=CURRENT_TIMESTAMP WHERE wishlist_entries.character_id=excluded.character_id`,
      )
      .bind(
        entryId,
        data.characterId,
        data.category,
        data.priority,
        data.status,
        data.title,
        data.notes,
        data.sourceUrl ?? null,
        data.catalogRef ?? null,
        data.characterId,
        user.id,
      )
      .run();
    if (!result.meta.changes)
      throw new Error("Wishlist entry or owner has changed");
    return required<WishlistEntry>(
      `SELECT ${wishlistColumns} FROM wishlist_entries WHERE id=? AND character_id=?`,
      entryId,
      data.characterId,
    );
  });
export const deleteWishlistEntry = createServerFn({ method: "POST" })
  .validator(characterInput.extend({ id }))
  .handler(async ({ data }) => {
    const user = await ownerMutation(data.characterId);
    await db()
      .prepare(
        "DELETE FROM wishlist_entries WHERE id=? AND character_id=? AND EXISTS(SELECT 1 FROM characters WHERE id=? AND owner_id=?)",
      )
      .bind(data.id, data.characterId, data.characterId, user.id)
      .run();
    return { ok: true };
  });

export const getGameCapabilities = createServerFn({ method: "GET" }).handler(
  async () => {
    await requireUser();
    const { gameData } = await import("./game");
    return gameData(db()).getCapabilities();
  },
);
export const searchCatalog = createServerFn({ method: "GET" })
  .validator(
    z.object({
      query: z.string().trim().min(1).max(200),
      category: z.enum(["item", "enchant", "recipe", "other"]),
    }),
  )
  .handler(async ({ data }) => {
    await requireUser();
    const { gameData } = await import("./game");
    return gameData(db()).searchCatalog(data);
  });
export const getAcquisitionSources = createServerFn({ method: "GET" })
  .validator(
    z.object({
      provider: id,
      externalId: id,
      category: z.enum(["item", "enchant", "recipe", "other"]),
    }),
  )
  .handler(async ({ data }) => {
    await requireUser();
    const { gameData } = await import("./game");
    return gameData(db()).getAcquisitionSources(data);
  });
const lookupInput = squadInput.extend({ fullName: name });
const previewInput = z.union([
  lookupInput,
  characterInput.extend({ fullName: name }),
]);
export const lookupCharacter = createServerFn({ method: "POST" })
  .validator(previewInput)
  .handler(async ({ data }) => {
    await adminMutation();
    const selected =
      "squadId" in data
        ? (
            await required<Squad>(
              `SELECT ${squadColumns} FROM squads WHERE id=?`,
              data.squadId,
            )
          )
        : await fetchCharacter(data.characterId);
    const { gameData } = await import("./game");
    return gameData(db()).lookupCharacter({
      region: selected.region,
      ruleset: selected.ruleset,
      fullName: data.fullName,
    });
  });
export const addVerifiedCharacter = createServerFn({ method: "POST" })
  .validator(lookupInput)
  .handler(async ({ data }) => {
    await adminMutation();
    const squad = await required<Squad>(
      `SELECT ${squadColumns} FROM squads WHERE id=?`,
      data.squadId,
    );
    const { gameData } = await import("./game");
    const result = await gameData(db()).lookupCharacter({
      region: squad.region,
      ruleset: squad.ruleset,
      fullName: data.fullName,
    });
    if (result.status !== "ok") return result;
    const identity = result.data;
    if (
      identity.region !== squad.region ||
      identity.ruleset !== squad.ruleset ||
      !identity.provider ||
      !identity.externalId
    )
      throw new Error("Provider returned an invalid character identity");
    await db().batch([
      db()
        .prepare(
          "INSERT INTO characters(id,name,normalized_name,region,ruleset,verified,provider,external_id) SELECT ?,?,?,?,?,1,?,? WHERE NOT EXISTS(SELECT 1 FROM characters WHERE provider=? AND region=? AND ruleset=? AND external_id=? AND verified=1)",
        )
        .bind(
          crypto.randomUUID(),
          identity.fullName,
          identity.fullName.normalize("NFKC").toLowerCase(),
          identity.region,
          identity.ruleset,
          identity.provider,
          identity.externalId,
          identity.provider,
          identity.region,
          identity.ruleset,
          identity.externalId,
        ),
      db()
        .prepare(
          "INSERT OR IGNORE INTO squad_characters(squad_id,character_id) SELECT ?,id FROM characters WHERE provider=? AND region=? AND ruleset=? AND external_id=? AND verified=1",
        )
        .bind(
          data.squadId,
          identity.provider,
          identity.region,
          identity.ruleset,
          identity.externalId,
        ),
    ]);
    const row = await required<Record<string, unknown>>(
      `SELECT ${characterColumns} FROM characters WHERE provider=? AND region=? AND ruleset=? AND external_id=? AND verified=1`,
      identity.provider,
      identity.region,
      identity.ruleset,
      identity.externalId,
    );
    return { status: "ok" as const, data: character(row) };
  });
export const linkPlaceholder = createServerFn({ method: "POST" })
  .validator(characterInput.extend({ fullName: name }))
  .handler(async ({ data }) => {
    await adminMutation();
    const current = await fetchCharacter(data.characterId);
    if (current.verified) throw new Error("Character is already verified");
    const { gameData } = await import("./game");
    const result = await gameData(db()).lookupCharacter({
      region: current.region,
      ruleset: current.ruleset,
      fullName: data.fullName,
    });
    if (result.status !== "ok") return result;
    const identity = result.data;
    if (
      identity.region !== current.region ||
      identity.ruleset !== current.ruleset ||
      !identity.provider ||
      !identity.externalId
    )
      throw new Error("Provider returned an invalid character identity");
    await db()
      .prepare(
        "UPDATE characters SET name=?,normalized_name=?,verified=1,provider=?,external_id=?,sync_status='idle',sync_error=NULL WHERE id=? AND verified=0",
      )
      .bind(
        identity.fullName,
        identity.fullName.normalize("NFKC").toLowerCase(),
        identity.provider,
        identity.externalId,
        current.id,
      )
      .run();
    return { status: "ok" as const, data: await fetchCharacter(current.id) };
  });
