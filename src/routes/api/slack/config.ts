import { createFileRoute } from "@tanstack/react-router";
import { getUserFromRequest } from "~/lib/api-auth";
import { getSlackConfig } from "~/lib/slack";

/**
 * GET /api/slack/config
 *
 * Returns the current user's Slack connection (webhook URL, enabled flag,
 * latest delivery status) or `{ config: null }` when not connected. The
 * webhook URL is returned to the UI for display (masked there) — it is a
 * write-only Slack credential, but it is the user's own URL on their own
 * page, matching how the existing webhooks list shows URLs.
 */
async function handler({ request }: { request: Request }): Promise<Response> {
  try {
    const user = await getUserFromRequest(request);
    if (!user) return Response.json({ error: "Not authenticated" }, { status: 401 });
    const config = await getSlackConfig(user.id);
    return Response.json({ config });
  } catch (err) {
    console.error("[api/slack] config error:", err instanceof Error ? err.message : err);
    return Response.json({ error: "Failed to load Slack configuration" }, { status: 500 });
  }
}

export const Route = createFileRoute("/api/slack/config")({
  server: { handlers: { GET: handler } },
});
