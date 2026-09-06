import { createFileRoute } from "@tanstack/react-router";
import { sql } from "~/db";
import { z } from "zod";
import { sendRadarLeadConfirmationEmail } from "~/lib/email";
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
  state: z.string().trim().max(2).optional(),
  cert: z.string().trim().max(16).optional(),
  sizePref: z.string().trim().max(16).optional(),
  visitor_id: z.string().trim().max(64).optional(),
  visit_id: z.string().trim().max(64).optional(),
});

/** Bot user-agents never get a confirmation email (still stored — fail-closed
 *  on deliverability, fail-open on capture). Mirrors the funnel bot filter. */
function isBotUa(ua: string | null): boolean {
  if (!ua) return false;
  const s = ua.toLowerCase();
  return (
    ["bot", "crawler", "spider", "headlesschrome", "puppeteer", "playwright", "python", "curl", "wget", "go-http-client"].some((t) => s.includes(t))
  );
}

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
      ? JSON.stringify({ trade: d.trade || null, state: d.state || null, cert, sizePref })
      : null;

    // First-touch acquisition attribution — same precedence as /api/track-visitor.
    const attr: Attribution = resolveAttribution({
      cookie: request.headers.get("cookie"),
      search: new URL(request.url).search,
      referer: request.headers.get("referer"),
    });

    // Self-healing DDL — identical to db/migrations/031_radar_leads.sql, so any
    // environment gets the table even before the migration runner touches it.
    await sql()`
      CREATE TABLE IF NOT EXISTS radar_leads (
        id BIGSERIAL PRIMARY KEY,
        email TEXT NOT NULL UNIQUE,
        visitor_id TEXT,
        radar_profile JSONB,
        source TEXT NOT NULL DEFAULT 'radar',
        consent BOOLEAN NOT NULL DEFAULT TRUE,
        confirmed_at TIMESTAMPTZ,
        unsubscribed_at TIMESTAMPTZ,
        unsubscribe_token TEXT NOT NULL UNIQUE,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `;

    // Idempotent upsert keyed on email. A repeat submit refreshes the radar
    // profile + visitor link only — confirmed_at / unsubscribed_at /
    // unsubscribe_token are NEVER touched (no double-confirm, no resurrection).
    const rows = (await sql()`
      INSERT INTO radar_leads (email, visitor_id, radar_profile, source, consent, unsubscribe_token)
      VALUES (${d.email}, ${d.visitor_id || null}, CAST(${radarProfile} AS JSONB), ${attr.source || "radar"}, TRUE, ${crypto.randomUUID()})
      ON CONFLICT (email) DO UPDATE SET
        radar_profile = COALESCE(EXCLUDED.radar_profile, radar_leads.radar_profile),
        visitor_id = COALESCE(EXCLUDED.visitor_id, radar_leads.visitor_id),
        updated_at = NOW()
      RETURNING confirmed_at, unsubscribed_at, unsubscribe_token
    `) as Array<{ confirmed_at: string | null; unsubscribed_at: string | null; unsubscribe_token: string }>;
    const lead = rows[0];

    const confirmed = !!lead?.confirmed_at;
    const unsubscribed = !!lead?.unsubscribed_at;

    // ONE confirmation email — ONLY to the person who just submitted; only when
    // the address is new/pending (never after confirmation, never for an
    // unsubscribed address, never for a bot UA). Fire-and-forget, fail-open:
    // an email failure logs but never fails the capture.
    if (!confirmed && !unsubscribed && !isBotUa(request.headers.get("user-agent"))) {
      try {
        await sendRadarLeadConfirmationEmail(d.email, String(lead?.unsubscribe_token ?? ""));
      } catch (e) {
        console.error(
          "[api/radar/lead] confirmation email failed (capture still saved):",
          (e as Error)?.message,
        );
      }
    }

    return Response.json({
      success: true,
      status: unsubscribed ? "unsubscribed" : confirmed ? "confirmed" : "pending",
    });
  } catch (error) {
    console.error("[api/radar/lead] error:", error);
    return Response.json({ error: "Something went wrong. Please try again." }, { status: 500 });
  }
}

export const Route = createFileRoute("/api/radar/lead")({
  server: { handlers: { POST: handler } },
});