import { createFileRoute } from "@tanstack/react-router";
import { getUserFromRequest } from "~/lib/api-auth";
import { deleteWebhook } from "~/lib/webhooks";

/**
 * POST /api/webhooks/delete
 *
 * Body: { id } — deletes the webhook (and its delivery log via CASCADE).
 * Only the owning user can delete a webhook.
 */
async function handler({ request }: { request: Request }): Promise<Response> {
  try {
    const user = await getUserFromRequest(request);
    if (!user) return Response.json({ error: "Not authenticated" }, { status: 401 });
    const body = (await request.json().catch(() => null)) as { id?: unknown } | null;
    if (!body || typeof body !== "object" || typeof body.id !== "number") {
      return Response.json({ error: "Invalid request body" }, { status: 400 });
    }
    const deleted = await deleteWebhook(user.id, body.id);
    if (!deleted) return Response.json({ error: "Webhook not found." }, { status: 404 });
    return Response.json({ ok: true });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Failed to delete webhook";
    console.error("[api/webhooks] delete error:", message);
    return Response.json({ error: message }, { status: 500 });
  }
}

export const Route = createFileRoute("/api/webhooks/delete")({
  server: { handlers: { POST: handler } },
});
