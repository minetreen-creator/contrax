import { createFileRoute } from "@tanstack/react-router";
import { sql } from "~/db";
import { resolveAttribution, type Attribution } from "~/lib/attribution";
import { checkEmailLimit, checkIpLimit, rateLimitedResponse } from "~/lib/rate-limit";
/**
 * POST /api/radar-save — anonymous email opt-in for the Contract Radar
 * "Save your matches" capture (option A, owner-approved).
 *
 * The dead-end this fixes: a contract seeker (often from a Facebook ad) answers
 * the radar's four questions, watches their FREE matches reveal, then bounces —
 * and because there's no account, we never learn who they were. This endpoint
 * converts that engagement into an EXPLICIT opt-in: the visitor submits just an
 * email (optionally a phone) AFTER they've engaged the free matches, and we
 * persist their email + the exact criteria they searched, so a future alert job
 * can email them when NEW matching bids open.
 *
 * No account required — this is a lead-capture, not a signup. It is a real,
 * honest opt-in with a unique-email constraint and ON CONFLICT upsert, so a
 * returning visitor / repeated submit UPDATEs their row rather than erroring or
 * duplicating.
 *
 * Body: { email, phone?, trade?, state?, cert?, sizePref?, matchedCount?,
 *         visitor_id?, visit_id? }
 * Headers used: user-agent, x-forwarded-for / cf-connecting-ip / x-real-ip,
 *               cookie (for first-touch attribution), referer.
 *
 * Success: 200 { created: boolean, updated: boolean } — data REALLY saved.
 */

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const CERTS = new Set(["sdvosb", "8a", "wosb", "hubzone", "sb"]);
const SIZE_PREFS = new Set(["under250k", "under1m", "under10m", "any"]);
// Spam guard — mirrors /api/lead-capture's caps. Fail-open; generic 429.
const SAVE_IP_LIMIT = 20;      // captures per IP per hour
const SAVE_IP_WINDOW = 60 * 60;
const SAVE_EMAIL_LIMIT = 10;   // captures per email per hour
const SAVE_EMAIL_WINDOW = 60 * 60;

async function handler({ request }: { request: Request }) {
  try {
    const body =
      ((await request.json().catch(() => null)) as Record<string, unknown> | null) ?? {};
    const rawEmail = typeof body.email === "string" ? body.email : "";
    const email = rawEmail.trim().toLowerCase();
    if (!EMAIL_PATTERN.test(email) || email.length > 254) {
      return Response.json({ error: "Please enter a valid email address." }, { status: 400 });
    }

    const ipLimit = await checkIpLimit(request, "radar_save_ip", SAVE_IP_LIMIT, SAVE_IP_WINDOW);
    if (!ipLimit.allowed) return rateLimitedResponse(ipLimit);
    const acctLimit = await checkEmailLimit(email, "radar_save_email", SAVE_EMAIL_LIMIT, SAVE_EMAIL_WINDOW);
    if (!acctLimit.allowed) return rateLimitedResponse(acctLimit);

    // Optional phone (never required) — free-text, bounded length.
    const phone = typeof body.phone === "string" ? body.phone.trim().slice(0, 40) : null;
    // Radar criteria the visitor used — store exactly what they searched so a
    // future alert job matches new bids against it. All bounded + whitelisted.
    const trade = typeof body.trade === "string" ? body.trade.trim().slice(0, 64) : null;
    const state = typeof body.state === "string" ? body.state.trim().toUpperCase().slice(0, 2) : null;
    const certRaw = typeof body.cert === "string" ? body.cert : "";
    const cert = CERTS.has(certRaw) ? certRaw : null;
    const sizeRaw = typeof body.sizePref === "string" ? body.sizePref : "";
    const sizePref = SIZE_PREFS.has(sizeRaw) ? sizeRaw : null;
    const rawCount = typeof body.matchedCount === "number" ? Math.floor(body.matchedCount) : null;
    const matchedCount = rawCount != null && rawCount >= 0 && rawCount <= 1000 ? rawCount : null;
    // Persistent per-visitor / per-session ids (optional — never fail the insert).
    const visitorId = typeof body.visitor_id === "string" ? body.visitor_id.trim().slice(0, 64) : null;
    const visitId = typeof body.visit_id === "string" ? body.visit_id.trim().slice(0, 64) : null;

    // First-touch acquisition attribution — same precedence as /api/event:
    // cookie (contrax_attr) → query params → referer. Lets us measure this
    // capture against the Facebook drop-off.
    const attr: Attribution = resolveAttribution({
      cookie: request.headers.get("cookie"),
      search: new URL(request.url).search,
      referer: request.headers.get("referer"),
    });

    // Ensure table exists lazily (self-healing, mirrors /api/event pattern).
    await sql()`CREATE TABLE IF NOT EXISTS radar_saves (
      id BIGSERIAL PRIMARY KEY,
      email TEXT NOT NULL,
      trade TEXT, state TEXT, cert TEXT, size_pref TEXT, phone TEXT,
      visitor_id TEXT, visit_id TEXT,
      source TEXT, medium TEXT, campaign TEXT,
      matched_count INTEGER,
      created_at TIMESTAMPTZ DEFAULT NOW(),
      updated_at TIMESTAMPTZ DEFAULT NOW(),
      UNIQUE (email)
    )`;

    // UPSERT keyed on email: first-time = INSERT, returning visitor = UPDATE
    // (fresh criteria + attribution, original created_at preserved).
    const result = await sql()`
      INSERT INTO radar_saves (email, trade, state, cert, size_pref, phone, visitor_id, visit_id, source, medium, campaign, matched_count)
      VALUES (${email}, ${trade || null}, ${state || null}, ${cert || null}, ${sizePref || null}, ${phone || null}, ${visitorId || null}, ${visitId || null}, ${attr.source}, ${attr.medium}, ${attr.campaign}, ${matchedCount})
      ON CONFLICT (email) DO UPDATE SET
        trade = EXCLUDED.trade,
        state = EXCLUDED.state,
        cert = EXCLUDED.cert,
        size_pref = EXCLUDED.size_pref,
        phone = COALESCE(EXCLUDED.phone, radar_saves.phone),
        visitor_id = COALESCE(EXCLUDED.visitor_id, radar_saves.visitor_id),
        visit_id = COALESCE(EXCLUDED.visit_id, radar_saves.visit_id),
        source = COALESCE(EXCLUDED.source, radar_saves.source),
        medium = COALESCE(EXCLUDED.medium, radar_saves.medium),
        campaign = COALESCE(EXCLUDED.campaign, radar_saves.campaign),
        matched_count = COALESCE(EXCLUDED.matched_count, radar_saves.matched_count),
        updated_at = NOW()
      RETURNING (xmax = 0) AS inserted
    `;
    const inserted = (result as any[])[0]?.inserted === true;

    return Response.json({ success: true, created: inserted, updated: !inserted });
  } catch (error) {
    console.error("[api/radar-save] error:", error);
    return Response.json({ error: "Something went wrong. Please try again." }, { status: 500 });
  }
}

export const Route = createFileRoute("/api/radar-save")({
  server: { handlers: { POST: handler } },
});
