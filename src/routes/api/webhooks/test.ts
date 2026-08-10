import { createFileRoute } from "@tanstack/react-router";
import { getUserFromRequest } from "~/lib/api-auth";
import { sendTestEvent } from "~/lib/webhooks";

/**
 * POST /api/webhooks/test
 *
 * Body: { id } — fires a sample `bid_match` event to the webhook URL so the
 * user can verify their Zapier/CRM mapping immediately after setup. Returns
 * the delivery outcome (status code, attempts, delivered).
 */
async function handler({ request }: { request: Request }): Promise<Response> {
  try {
    const user = await getUserFromRequest(request);
    if (!user) return Response.json({ error: "Not authenticated" }, { status: 401 });
    const body = (await request.json().catch(() => null)) as { id?: unknown } | null;
    if (!body || typeof body !== "object" || typeof body.id !== "number") {
      return Response.json({ error: "Invalid request body" }, { status: 400 });
    }
    const result = await sendTestEvent(user.id, body.id);
    if (!result) return Response.json({ error: "Webhook not found." }, { status: 404 });
    return Response.json(result);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Failed to send test event";
    console.error("[api/webhooks] test error:", message);
    return Response.json({ error: message }, { status: 500 });
  }
}

export const Route = createFileRoute("/api/webhooks/test")({
  server: { handlers: { POST: handler } },
});
