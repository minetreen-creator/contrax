import { createFileRoute } from "@tanstack/react-router";
import { getUserFromRequest } from "~/lib/api-auth";
import { parseSubscription } from "~/lib/live-push";
import {
  deviceStatus,
  removeSubscription,
  saveSubscription,
  sendTest,
  setSubscriptionEnabled,
  vapidPublicKey,
} from "~/lib/live-push.server";

/**
 * /api/admin/push — Mission Control live alerts (issue #788), admin only.
 *   GET  ?endpoint=…  → { publicKey, devices, thisDevice }
 *   POST { action: "subscribe", subscription } | { action: "unsubscribe", endpoint }
 *        | { action: "enable" | "disable", endpoint } | { action: "test" }
 * Subscriptions are bound to the signed-in admin; the VAPID private key never
 * leaves the server.
 */
async function admin(request: Request) {
  const user = await getUserFromRequest(request);
  if (!user) return { denied: Response.json({ error: "Not authenticated" }, { status: 401 }) };
  if (!user.is_admin) return { denied: Response.json({ error: "Admin access required" }, { status: 403 }) };
  return { userId: Number(user.id) };
}

async function GET({ request }: { request: Request }) {
  const a = await admin(request);
  if ("denied" in a) return a.denied;
  const endpoint = new URL(request.url).searchParams.get("endpoint");
  try {
    return Response.json({ publicKey: await vapidPublicKey(), ...(await deviceStatus(a.userId, endpoint)) });
  } catch (err) {
    console.error("[api/admin/push] status failed:", err);
    return Response.json({ error: "Live alerts are unavailable" }, { status: 500 });
  }
}

async function POST({ request }: { request: Request }) {
  const a = await admin(request);
  if ("denied" in a) return a.denied;
  const body = (await request.json().catch(() => ({}))) as { action?: unknown; subscription?: unknown; endpoint?: unknown };
  const endpoint = typeof body.endpoint === "string" ? body.endpoint.slice(0, 1000) : "";
  try {
    switch (body.action) {
      case "subscribe": {
        const sub = parseSubscription(body.subscription);
        if (!sub) return Response.json({ error: "Invalid subscription" }, { status: 400 });
        await saveSubscription(a.userId, sub);
        return Response.json({ ok: true });
      }
      case "unsubscribe":
        if (!endpoint) return Response.json({ error: "Missing endpoint" }, { status: 400 });
        await removeSubscription(a.userId, endpoint);
        return Response.json({ ok: true });
      case "enable":
      case "disable":
        if (!endpoint) return Response.json({ error: "Missing endpoint" }, { status: 400 });
        await setSubscriptionEnabled(a.userId, endpoint, body.action === "enable");
        return Response.json({ ok: true });
      case "test":
        return Response.json({ ok: true, delivered: await sendTest(a.userId) });
      default:
        return Response.json({ error: "Unknown action" }, { status: 400 });
    }
  } catch (err) {
    console.error("[api/admin/push] action failed:", err);
    return Response.json({ error: "Could not update live alerts" }, { status: 500 });
  }
}

export const Route = createFileRoute("/api/admin/push")({
  server: { handlers: { GET, POST } },
});
