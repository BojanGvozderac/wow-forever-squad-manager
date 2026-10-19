import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireUser } from "./auth";
import { db, required } from "./db";
import type { Ruleset } from "./game/provider";

const time = z.number().finite().int().min(-8640000000000000).max(8640000000000000);
const calendarInput = z.object({
  squadId: z.string().min(1).max(100),
  from: time,
  to: time,
}).refine(
  (input) => input.to > input.from && input.to - input.from <= 42 * 86400000,
  "Calendar range must be positive and at most 42 days",
);

export const getSquadGameEvents = createServerFn({ method: "GET" })
  .validator(calendarInput)
  .handler(async ({ data }) => {
    await requireUser();
    const squad = await required<{ region: "eu"; ruleset: Ruleset }>(
      "SELECT region,ruleset FROM squads WHERE id=?",
      data.squadId,
    );
    const { gameData } = await import("./game");
    return gameData(db()).getCalendarEvents({
      region: squad.region,
      ruleset: squad.ruleset,
      from: data.from,
      to: data.to,
    });
  });
