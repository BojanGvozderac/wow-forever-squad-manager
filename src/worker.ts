import handler from "@tanstack/react-start/server-entry";
import { handleMcpRequest } from "./server/mcp";
import { scheduledRefresh } from "./server/refresh";

export default {
  fetch(request) {
    if (new URL(request.url).pathname === "/mcp") return handleMcpRequest(request);
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
