import { createFileRoute } from "@tanstack/react-router";
import { getUserFromRequest } from "~/lib/api-auth";
import { saveSlackConfig, setSlackEnabled } from "~/lib/slack";

/**
 * POST /api/slack/save
 *
 * Body (either or both):
 *   { webhookUrl: "<your Slack incoming webhook URL>" }  → connect/update
 *   { enabled: true|false }                                 → toggle alerts
 *
 * When webhookUrl is provided the connection is upserted (connecting implies
 * enabling). When only `enabled` is provided the stored URL is left untouched
 * — this is the independent on/off toggle, separate from generic webhooks.
 */
async function handler({ request }: { request: Request }): Promise<Response> {
  try {
    const user = await getUserFromRequest(request);
    if (!user) return Response.json({ error: "Not authenticated" }, { status: 401 });
    const body = (await request.json().catch(() => null)) as {
      webhookUrl?: unknown;
      enabled?: unknown;
    } | null;
    if (!body || typeof body !== "object") {
      return Response.json({ error: "Invalid request body" }, { status: 400 });
    }
    const hasUrl = typeof body.webhookUrl === "string";
    const hasEnabled = typeof body.enabled === "boolean";
    if (!hasUrl && !hasEnabled) {
      return Response.json({ error: "Provide a webhookUrl to connect, or enabled to toggle alerts." }, { status: 400 });
    }
    let config;
    if (hasUrl) {
      config = await saveSlackConfig(user.id, body.webhookUrl as string, hasEnabled ? (body.enabled as boolean) : true);
    } else {
      config = await setSlackEnabled(user.id, body.enabled as boolean);
      if (!config) return Response.json({ error: "No Slack connection to toggle. Connect a webhook URL first." }, { status: 404 });
    }
    return Response.json({ config });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Failed to save Slack configuration";
    const status = message.includes("required") || message.includes("look like") || message.includes("valid") ? 400 : 500;
    console.error("[api/slack] save error:", message);
    return Response.json({ error: message }, { status });
  }
}

export const Route = createFileRoute("/api/slack/save")({
  server: { handlers: { POST: handler } },
});
