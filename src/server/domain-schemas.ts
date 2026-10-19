import { z } from "zod";
export const id = z.string().min(1).max(100);
export const version = z.number().int().min(1).max(Number.MAX_SAFE_INTEGER);
export const characterInput = z.object({ characterId: id });
export const squadInput = z.object({ squadId: id });
export const wishlistDetails = z.object({
  category: z.enum(["item", "enchant", "recipe", "other"]),
  priority: z.enum(["high", "normal", "low"]),
  status: z.enum(["wanted", "acquired"]),
  title: z.string().trim().min(1).max(200),
  notes: z.string().max(4000).default(""),
  sourceUrl: z.string().url().max(2000).refine(value => new URL(value).protocol === "https:", "Source URL must use HTTPS").nullable().optional(),
  catalogRef: z.string().max(2000).nullable().optional(),
});
export const wishlistCreateInput = wishlistDetails.extend({ characterId: id });
export const wishlistSaveInput = wishlistCreateInput.extend({ id: id.optional(), version: version.optional() }).refine(data => !data.id || data.version !== undefined, "Wishlist version is required when editing");
export const wishlistUpdateInput = wishlistDetails.omit({ notes: true }).partial().extend({ notes: z.string().max(4000).optional(), characterId: id, id, version });
export const wishlistDeleteInput = characterInput.extend({ id, version });
