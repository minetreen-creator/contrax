import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";
import { SEO_TRADE_BY_SLUG } from "~/lib/seo-trades";
import { checkEmailLimit, checkIpLimit, rateLimitedResponse } from "~/lib/rate-limit";
import { isBlockedIp } from "~/lib/request-ip";

/**
 * POST /api/coop-alert { email, trade } — "Tell me when my trade opens" on /co-op-contracts (owner
 * 2026-11-13). Saves the alert only; no email is sent now. The daily co-op sync emails once when a new
 * category for that trade opens (src/jobs/coop-sync.ts). Opt-in, rate-limited, one-click unsubscribe.
 */
const SCHEMA = z.object({
  email: z.string().trim().toLowerCase().regex(/^[^\s@]+@[^\s@]+\.[^\s@]+$/).max(254),
  trade: z.string().trim().max(60),
});

async function handler({ request }: { request: Request }) {
  if (isBlockedIp(request)) return Response.json({ error: "Forbidden" }, { status: 403 });
  try {
    const parsed = SCHEMA.safeParse((await request.json().catch(() => null)) ?? {});
    if (!parsed.success || !SEO_TRADE_BY_SLUG[parsed.data.trade]) {
      return Response.json({ error: "Please enter a valid email address and pick a trade." }, { status: 400 });
    }
    const { email, trade } = parsed.data;
    const ip = await checkIpLimit(request, "coop_alert_ip", 20, 3600);
    if (!ip.allowed) return rateLimitedResponse(ip);
    const em = await checkEmailLimit(email, "coop_alert_email", 10, 3600);
    if (!em.allowed) return rateLimitedResponse(em);
    const { openCoopSolicitations } = await import("~/lib/coop-contracts.server");
    const { addCoopAlert } = await import("~/lib/coop-alerts.server");
    const status = await addCoopAlert(email, trade, await openCoopSolicitations(null));
    return Response.json({ success: true, status });
  } catch (error) {
    console.error("[api/coop-alert] error:", (error as Error).message);
    return Response.json({ error: "Something went wrong. Please try again." }, { status: 500 });
  }
}

export const Route = createFileRoute("/api/coop-alert")({
  server: { handlers: { POST: handler } },
});
