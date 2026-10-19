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

export type { JsonValue, CharacterSection, Ruleset, Squad, Character, WishlistEntry } from "./domain";
import { fetchCharacter, character, squadColumns, characterColumns, listSquadsForUser, getSquadForUser, listCharactersForUser, getCharacterForUser, listWishlistForUser, saveWishlistForUser, deleteWishlistForUser } from "./domain";
import type { Squad } from "./domain";
import { wishlistSaveInput, wishlistDeleteInput } from "./domain-schemas";
const ruleset = z.enum(["normal", "pvp", "roleplay"]);
const id = z.string().min(1).max(100);
const squadInput = z.object({ squadId: id });
const characterInput = z.object({ characterId: id });
const membershipInput = squadInput.extend({ characterId: id });
const name = z.string().trim().min(1).max(80);
export { fetchCharacter } from "./domain";
async function adminMutation() {
  assertMutationOrigin();
  return requireUser(true);
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
export const listSquads = createServerFn({ method: "GET" }).handler(async () => listSquadsForUser(await requireUser()));
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
export const getSquad = createServerFn({ method: "GET" }).validator(squadInput)
  .handler(async ({ data }) => getSquadForUser(await requireUser(), data));
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
export const getCharacter = createServerFn({ method: "GET" }).validator(characterInput)
  .handler(async ({ data }) => getCharacterForUser(await requireUser(), data));
export const listCharacters = createServerFn({ method: "GET" }).handler(async () => listCharactersForUser(await requireUser()));
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
  .handler(async ({ data }) => listWishlistForUser(await requireUser(), data));
export const saveWishlistEntry = createServerFn({ method: "POST" })
  .validator(wishlistSaveInput)
  .handler(async ({ data }) => {
    assertMutationOrigin();
    return saveWishlistForUser(await requireUser(), data);
  });
export const deleteWishlistEntry = createServerFn({ method: "POST" })
  .validator(wishlistDeleteInput)
  .handler(async ({ data }) => {
    assertMutationOrigin();
    return deleteWishlistForUser(await requireUser(), data);
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
