import { createFileRoute } from "@tanstack/react-router";
import { getUserFromRequest } from "~/lib/api-auth";
import { createWebhook, listWebhooks } from "~/lib/webhooks";

/**
 * Webhook management API.
 *
 *   GET  /api/webhooks        → { webhooks: Webhook[] } (public shape — no secret)
 *   POST /api/webhooks        → create { name, url } → { webhook, secret }
 *                              (secret is returned once, at creation only)
 *
 * A GET to this endpoint also answers "verification pings" with 200, which
 * keeps the endpoint Zapier-friendly during setup/testing.
 */
async function getHandler({ request }: { request: Request }): Promise<Response> {
  try {
    const user = await getUserFromRequest(request);
    if (!user) return Response.json({ error: "Not authenticated" }, { status: 401 });
    const webhooks = await listWebhooks(user.id);
    return Response.json({ webhooks });
  } catch (err) {
    console.error("[api/webhooks] list error:", err);
    return Response.json({ error: err instanceof Error ? err.message : "Failed to load webhooks" }, { status: 500 });
  }
}

async function postHandler({ request }: { request: Request }): Promise<Response> {
  try {
    const user = await getUserFromRequest(request);
    if (!user) return Response.json({ error: "Not authenticated" }, { status: 401 });
    const body = (await request.json().catch(() => null)) as { name?: unknown; url?: unknown } | null;
    if (!body || typeof body !== "object") {
      return Response.json({ error: "Invalid request body" }, { status: 400 });
    }
    const { webhook, secret } = await createWebhook({
      userId: user.id,
      name: typeof body.name === "string" ? body.name : "",
      url: typeof body.url === "string" ? body.url : "",
    });
    return Response.json({ webhook, secret });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Failed to create webhook";
    const status = message.includes("required") || message.includes("valid") ? 400 : 500;
    console.error("[api/webhooks] create error:", message);
    return Response.json({ error: message }, { status });
  }
}

export const Route = createFileRoute("/api/webhooks/")({
  server: {
    handlers: {
      GET: getHandler,
      POST: postHandler,
    },
  },
});
