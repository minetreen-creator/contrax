import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";
import { checkEmailLimit, checkIpLimit, rateLimitedResponse } from "~/lib/rate-limit";
import { isBlockedIp } from "~/lib/request-ip";
import { isBotUa } from "~/lib/radar-lead-capture.server";
import { createBidReminder } from "~/lib/max-reminders.server";

/**
 * POST /api/max/remind — "remind me before it closes" from Max's bid cards
 * (src/lib/max-reminders.server.ts). Body: { email, bid_id, visitor_id? }.
 * Returns { success, lead: "pending" | "confirmed", remindAt, due } or an error
 * the page shows. A pending lead gets the one confirmation email; the reminder
 * only sends once it's confirmed.
 */
const SCHEMA = z.object({
  email: z.string().trim().toLowerCase().regex(/^[^\s@]+@[^\s@]+\.[^\s@]+$/).max(254),
  bid_id: z.number().int().positive(),
  visitor_id: z.string().trim().max(64).optional(),
});

const REASONS = {
  no_bid: "That bid is closed or no longer listed.",
  too_soon: "That bid closes in less than a day, so it's too late for a reminder. Go for it now!",
  unsubscribed: "This email unsubscribed from Contrax emails, so I can't send reminders to it.",
};

async function handler({ request }: { request: Request }) {
  if (isBlockedIp(request)) return Response.json({ error: "Forbidden" }, { status: 403 });
  const parsed = SCHEMA.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: "Please enter a valid email address." }, { status: 400 });
  const d = parsed.data;
  const ip = await checkIpLimit(request, "max_remind_ip", 15, 3600);
  if (!ip.allowed) return rateLimitedResponse(ip);
  const em = await checkEmailLimit(d.email, "max_remind_email", 15, 3600);
  if (!em.allowed) return rateLimitedResponse(em);
  try {
    const r = await createBidReminder({ email: d.email, bidId: d.bid_id, visitorId: d.visitor_id || null, sendConfirmation: !isBotUa(request.headers.get("user-agent")) });
    if (!r.ok) return Response.json({ error: REASONS[r.reason] }, { status: 400 });
    return Response.json({ success: true, lead: r.lead, remindAt: r.remindAt, due: r.due });
  } catch (err) {
    console.error("[api/max/remind] error:", (err as Error)?.message);
    return Response.json({ error: "Something went wrong. Please try again." }, { status: 500 });
  }
}

export const Route = createFileRoute("/api/max/remind")({ server: { handlers: { POST: handler } } });
