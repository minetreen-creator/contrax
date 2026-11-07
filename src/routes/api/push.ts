import { createFileRoute } from "@tanstack/react-router";
import { getUserFromRequest } from "~/lib/api-auth";
import { parseSubscription } from "~/lib/live-push";
import { vapidPublicKey } from "~/lib/live-push.server";
import { hasPaidBidAccess } from "~/lib/head-start.server";
import { memberDeviceOn, removeMemberSubscription, saveMemberSubscription } from "~/lib/member-push.server";

/**
 * /api/push — Contrax app notifications for members (owner 2026-11-07).
 *   GET  ?endpoint=…  → { signedIn, paid, publicKey, on }
 *   POST { action: "subscribe", subscription } | { action: "unsubscribe", endpoint }
 * Signing up a phone needs a paid plan; the app itself is open to everyone.
 */
async function GET({ request }: { request: Request }) {
  const user = await getUserFromRequest(request);
  if (!user) return Response.json({ signedIn: false, paid: false, publicKey: null, on: false });
  try {
    const paid = await hasPaidBidAccess(user);
    const endpoint = new URL(request.url).searchParams.get("endpoint");
    return Response.json({
      signedIn: true,
      paid,
      publicKey: paid ? await vapidPublicKey() : null,
      on: paid ? await memberDeviceOn(Number(user.id), endpoint ? endpoint.slice(0, 1000) : null) : false,
    });
  } catch (err) {
    console.error("[api/push] status failed:", err);
    return Response.json({ error: "Notifications are unavailable" }, { status: 500 });
  }
}

async function POST({ request }: { request: Request }) {
  const user = await getUserFromRequest(request);
  if (!user) return Response.json({ error: "Not authenticated" }, { status: 401 });
  const body = (await request.json().catch(() => ({}))) as { action?: unknown; subscription?: unknown; endpoint?: unknown };
  try {
    if (body.action === "subscribe") {
      if (!(await hasPaidBidAccess(user))) return Response.json({ error: "Paid plan required", needsPlan: true }, { status: 402 });
      const sub = parseSubscription(body.subscription);
      if (!sub) return Response.json({ error: "Invalid subscription" }, { status: 400 });
      await saveMemberSubscription(Number(user.id), sub);
      return Response.json({ ok: true });
    }
    if (body.action === "unsubscribe") {
      const endpoint = typeof body.endpoint === "string" ? body.endpoint.slice(0, 1000) : "";
      if (!endpoint) return Response.json({ error: "Missing endpoint" }, { status: 400 });
      await removeMemberSubscription(Number(user.id), endpoint);
      return Response.json({ ok: true });
    }
    return Response.json({ error: "Unknown action" }, { status: 400 });
  } catch (err) {
    console.error("[api/push] action failed:", err);
    return Response.json({ error: "Could not update notifications" }, { status: 500 });
  }
}

export const Route = createFileRoute("/api/push")({
  server: { handlers: { GET, POST } },
});
