import { beforeEach, expect, it, vi } from "vitest";
const state = vi.hoisted(() => ({ current: null as Record<string, unknown> | null, first: vi.fn() }));
vi.mock("@tanstack/react-start", () => ({ createServerFn: () => ({ validator: () => ({ handler: () => undefined }) }) }));
vi.mock("./auth", () => ({ assertMutationOrigin: vi.fn(), requireUser: vi.fn() }));
vi.mock("./domain", () => ({ activeUser: async (user: unknown) => user }));
vi.mock("./domain-writes", () => ({ commitWrite: vi.fn(), replayWrite: vi.fn() }));
vi.mock("./db", () => ({ db: () => ({ prepare: () => ({ bind: () => ({ first: state.first }) }) }), required: vi.fn() }));
import { updateAvailabilityForUser, deleteAvailabilityForUser } from "./calendar";
const user = { id: "owner", username: "owner", role: "player" as const };
beforeEach(() => { state.first.mockReset(); });
it("marks missing authored availability as forbidden for update and delete", async () => {
  state.first.mockResolvedValue(null);
  await expect(updateAvailabilityForUser(user, { id: "entry", version: 1, note: "Changed" })).rejects.toMatchObject({ code: "forbidden", message: expect.stringContaining("author") });
  await expect(deleteAvailabilityForUser(user, { id: "entry", version: 1 })).rejects.toMatchObject({ code: "forbidden", message: expect.stringContaining("author") });
});
it("marks an invalid interval after merging a partial update as invalid input", async () => {
  state.first.mockResolvedValue({ id: "entry", version: 1, characterId: null, startsAt: 1000, endsAt: 2000, activitiesJson: "[]", note: "" });
  await expect(updateAvailabilityForUser(user, { id: "entry", version: 1, endsAt: 500 })).rejects.toMatchObject({ code: "invalid_input", message: expect.stringContaining("48 hours") });
});
