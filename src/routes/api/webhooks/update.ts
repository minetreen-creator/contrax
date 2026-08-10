import { createFileRoute } from "@tanstack/react-router";
import { getUserFromRequest } from "~/lib/api-auth";
import { updateWebhook } from "~/lib/webhooks";

/**
 * POST /api/webhooks/update
 *
 * Body: { id, name?, url?, isActive? } — updates the fields provided.
 * Only the owning user can update a webhook.
 */
async function handler({ request }: { request: Request }): Promise<Response> {
  try {
    const user = await getUserFromRequest(request);
    if (!user) return Response.json({ error: "Not authenticated" }, { status: 401 });
    const body = (await request.json().catch(() => null)) as {
      id?: unknown;
      name?: unknown;
      url?: unknown;
      isActive?: unknown;
    } | null;
    if (!body || typeof body !== "object" || typeof body.id !== "number") {
      return Response.json({ error: "Invalid request body" }, { status: 400 });
    }
    const webhook = await updateWebhook(user.id, body.id, {
      name: typeof body.name === "string" ? body.name : undefined,
      url: typeof body.url === "string" ? body.url : undefined,
      isActive: typeof body.isActive === "boolean" ? body.isActive : undefined,
    });
    return Response.json({ webhook });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Failed to update webhook";
    const status = message === "Webhook not found." ? 404 : message.includes("required") || message.includes("valid") ? 400 : 500;
    console.error("[api/webhooks] update error:", message);
    return Response.json({ error: message }, { status });
  }
}

export const Route = createFileRoute("/api/webhooks/update")({
  server: { handlers: { POST: handler } },
});
