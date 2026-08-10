import { createFileRoute } from "@tanstack/react-router";
import { getUserFromRequest } from "~/lib/api-auth";
import { disconnectSlack } from "~/lib/slack";

/**
 * POST /api/slack/disconnect
 *
 * Removes the user's Slack connection (webhook URL + config). The delivery
 * log is kept (no cascade) so history survives reconnecting.
 */
async function handler({ request }: { request: Request }): Promise<Response> {
  try {
    const user = await getUserFromRequest(request);
    if (!user) return Response.json({ error: "Not authenticated" }, { status: 401 });
    const removed = await disconnectSlack(user.id);
    if (!removed) return Response.json({ error: "No Slack connection to disconnect." }, { status: 404 });
    return Response.json({ ok: true });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Failed to disconnect Slack";
    console.error("[api/slack] disconnect error:", message);
    return Response.json({ error: message }, { status: 500 });
  }
}

export const Route = createFileRoute("/api/slack/disconnect")({
  server: { handlers: { POST: handler } },
});
