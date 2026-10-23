import { createFileRoute } from "@tanstack/react-router";
import { expandTrade } from "~/lib/trade-registry";
import { normalizeStateInput } from "~/lib/location-state";
import { z } from "zod";
import { captureRadarLead, isBotUa } from "~/lib/radar-lead-capture.server";
import { resolveAttribution, type Attribution } from "~/lib/attribution";
import {
  checkEmailLimit,
  checkIpLimit,
  rateLimitedResponse,
} from "~/lib/rate-limit";
import { isBlockedIp } from "~/lib/request-ip";

/**
 * POST /api/radar/lead — anonymous Radar match-alert capture (owner 2026-09-06).
 *
 * An anonymous visitor who COMPLETED a Radar scan can voluntarily leave an
 * email to be alerted when new matching opportunities open. NO account
 * required. This is strict OPT-IN capture:
 *
 *   - the confirmation email goes ONLY to the address that just submitted it
 *     (never any other address),
 *   - the capture stores explicit consent (TRUE at submit) + the visitor's
 *     radar profile snapshot (trade/state/cert/sizePref) + the persistent
 *     visitor_id from the tracking context,
 *   - exactly ONE confirmation email is sent per lead (deliverability +
 *     real-address verification before any match-alert sending — the periodic
 *     sender is a separate, queued follow-up),
 *   - idempotent: a repeat submit refreshes the radar profile but NEVER
 *     double-sends the confirmation (if already confirmed) and NEVER
 *     resurrects an unsubscribed address,
 *   - fail-open: an email-send failure never fails the capture (the lead is
 *     still saved); the Radar UX is never blocked by this endpoint.
 *
 * PII-safe: the email address is never logged raw (the email module logs a
 * generic line for this path), and admin read surfaces mask it.
 *
 * Body: { email, trade?, state?, cert?, sizePref?, visitor_id?, visit_id? }
 * Success: 200 { success: true, status: "pending" | "confirmed" | "unsubscribed" }
 */

// Spam guard — mirrors /api/radar-save's caps. Fail-open; generic 429.
const LEAD_IP_LIMIT = 20; // submissions per IP per hour
const LEAD_IP_WINDOW = 60 * 60;
const LEAD_EMAIL_LIMIT = 10; // submissions per email per hour
const LEAD_EMAIL_WINDOW = 60 * 60;

const CERTS = new Set(["sdvosb", "8a", "wosb", "hubzone", "sb"]);
const SIZE_PREFS = new Set(["under250k", "under1m", "under10m", "any"]);

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

const LEAD_SCHEMA = z.object({
  email: z.string().trim().toLowerCase().regex(EMAIL_PATTERN).max(254),
  trade: z.string().trim().max(120).optional(),
  state: z.string().trim().max(40).optional(),
  cert: z.string().trim().max(16).optional(),
  sizePref: z.string().trim().max(16).optional(),
  visitor_id: z.string().trim().max(64).optional(),
  visit_id: z.string().trim().max(64).optional(),
  /** Email unlock on the Radar results screen: also unlock this scan's locked matches. */
  unlock: z.boolean().optional(),
});

async function handler({ request }: { request: Request }) {
  // Throttle a known hostile IP before any write. Exact-match only; generic 403.
  if (isBlockedIp(request)) {
    return Response.json({ error: "Forbidden" }, { status: 403 });
  }
  try {
    const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
    const parsed = LEAD_SCHEMA.safeParse(body ?? {});
    if (!parsed.success) {
      return Response.json({ error: "Please enter a valid email address." }, { status: 400 });
    }
    const d = parsed.data;

    // Rate limits (per-IP + per-email) run before any write. Fail-open.
    const ipLimit = await checkIpLimit(request, "radar_lead_ip", LEAD_IP_LIMIT, LEAD_IP_WINDOW);
    if (!ipLimit.allowed) return rateLimitedResponse(ipLimit);
    const acctLimit = await checkEmailLimit(d.email, "radar_lead_email", LEAD_EMAIL_LIMIT, LEAD_EMAIL_WINDOW);
    if (!acctLimit.allowed) return rateLimitedResponse(acctLimit);

    // Radar profile snapshot — exactly what the visitor searched (whitelisted).
    const cert = d.cert && CERTS.has(d.cert) ? d.cert : null;
    const sizePref = d.sizePref && SIZE_PREFS.has(d.sizePref) ? d.sizePref : null;
    const radarProfile = d.trade || d.state || cert || sizePref
      ? JSON.stringify({
          // state normalized to the 2-letter USPS code (full names accepted —
          // owner 09-13 state breadth): the snapshot mirrors what the visitor
          // searched, normalized like the matcher input.
          trade: d.trade || null, state: d.state ? normalizeStateInput(d.state) : null, cert, sizePref,
          // Trade-query expansion snapshot (owner 2026-09-07) — WHAT the
          // visitor's trade expanded to; refreshed on every capture.
          expanded: d.trade && !/^\d{6}$/.test(d.trade)
            ? (() => { const e = expandTrade(d.trade); return { terms: e.terms.slice(0, 12), naicsCodes: e.naicsCodes }; })()
            : null,
        })
      : null;

    // First-touch acquisition attribution — same precedence as /api/track-visitor.
    const attr: Attribution = resolveAttribution({
      cookie: request.headers.get("cookie"),
      search: new URL(request.url).search,
      referer: request.headers.get("referer"),
    });

    // Upsert + the ONE confirmation email (shared with Launchpad's opt-in).
    const status = await captureRadarLead({
      email: d.email,
      visitorId: d.visitor_id || null,
      radarProfile,
      source: attr.source || "radar",
      sendConfirmation: !isBotUa(request.headers.get("user-agent")),
    });

    // Email unlock (owner 2026-10-23): sign the unlock cookie for this
    // browser's visitor id; runRadarScan honors it for the scan it belongs to.
    if (d.unlock && status !== "unsubscribed") {
      try {
        const { visitorIdFromCookieHeader } = await import("~/lib/free-score-limit.server");
        const vid = visitorIdFromCookieHeader(request.headers.get("cookie"));
        if (vid) {
          const { signRadarUnlock, RADAR_UNLOCK_COOKIE, RADAR_UNLOCK_MAX_AGE_S } = await import("~/lib/radar-handoff.server");
          const cookie = `${RADAR_UNLOCK_COOKIE}=${signRadarUnlock(vid)}; Path=/; Max-Age=${RADAR_UNLOCK_MAX_AGE_S}; HttpOnly; Secure; SameSite=Lax`;
          return Response.json({ success: true, status, unlocked: true }, { headers: { "Set-Cookie": cookie } });
        }
      } catch (err) {
        if (err instanceof Error && err.message.includes("RADAR_HANDOFF_SECRET is required")) {
          console.error("[api/radar/lead] unlock unavailable: missing server configuration (RADAR_HANDOFF_SECRET)");
        }
      }
      return Response.json({ success: true, status, unlocked: false });
    }
    return Response.json({ success: true, status });
  } catch (error) {
    console.error("[api/radar/lead] error:", error);
    return Response.json({ error: "Something went wrong. Please try again." }, { status: 500 });
  }
}

export const Route = createFileRoute("/api/radar/lead")({
  server: { handlers: { POST: handler } },
});