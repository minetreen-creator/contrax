import { createFileRoute } from "@tanstack/react-router";
import { getUserFromRequest } from "~/lib/api-auth";
import { sendSlackTest } from "~/lib/slack";

/**
 * POST /api/slack/test
 *
 * Fires a sample bid-match Block Kit message to the user's connected Slack
 * channel so they can verify delivery immediately after setup. Returns the
 * delivery outcome (status code, attempts, delivered).
 */
async function handler({ request }: { request: Request }): Promise<Response> {
  try {
    const user = await getUserFromRequest(request);
    if (!user) return Response.json({ error: "Not authenticated" }, { status: 401 });
    const result = await sendSlackTest(user.id);
    if (!result) return Response.json({ error: "No Slack connection. Connect a webhook URL first." }, { status: 404 });
    return Response.json(result);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Failed to send test message";
    console.error("[api/slack] test error:", message);
    return Response.json({ error: message }, { status: 500 });
  }
}

export const Route = createFileRoute("/api/slack/test")({
  server: { handlers: { POST: handler } },
});
