import handler from "@tanstack/react-start/server-entry";
import { scheduledRefresh } from "./server/refresh";

export default {
  fetch(request) {
    return handler.fetch(request);
  },
  async scheduled(
    _event: ScheduledController,
    env: Env,
    ctx: ExecutionContext,
  ) {
    ctx.waitUntil(scheduledRefresh(env));
  },
} satisfies ExportedHandler<Env>;
