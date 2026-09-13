import { createFileRoute } from "@tanstack/react-router";
import { sql } from "~/db";
import {
  ensureRadarLeadsClickLog,
  hashClickToken,
  CLICK_SCOPE,
  CLICK_IP_LIMIT,
  CLICK_IP_WINDOW,
} from "~/lib/radar-lead-clicks";
import { checkIpLimit } from "~/lib/rate-limit";

/**
 * GET /api/radar/opportunity-click?bid=<id>&token=<unsubscribe_token>
 *
 * The per-bid "View opportunity →" CTA target in every Radar match-alert email
 * (owner 2026-09-07). Instead of linking straight to the bid's source_url, the
 * email routes the click here so we can:
 *
 *   1. resolve the lead server-side from the token (a random UUID the address
 *      owner already has) — the raw email address NEVER appears in any URL or
 *      log; only the SHA-256 token hash is ever stored,
 *   2. count the click ONLY when this (lead, bid) pair was genuinely emailed —
 *      the sender pre-seeds radar_lead_opportunity_clicks with every pair it
 *      mails (PK lead_id × bid_id), so a repeat click never double-counts,
 *   3. record an `opportunity_clicked` funnel event (stage 4 of the admin
 *      radar-leads funnel),
 *   4. 302 to the bid's REAL source_url — fail-open, ALWAYS, even when every
 *      write above failed.
 *
 * PII-SAFE / FAIL-OPEN CONTRACT (owner-exact, non-negotiable):
 *   - Unknown token, unsubscribed lead, or unconfirmed lead → plain 302 to the
 *     bid's source_url (or /radar when the bid is absent/invalid). NO reveal of
 *     why, NO click logging, NO raw token/email anywhere.
 *   - Every DB/funnel write on the redirect path is wrapped in try/catch — a
 *     failure is logged (generic, no PII) and the 302 still fires.
 *   - Shared per-IP rate limit (radar_click_ip, 120/hr) is enforced fail-open:
 *     a limiter error never blocks the redirect (rate-limit's checkRateLimit
 *     already returns allowed on DB failure).
 *
 * The URL itself is built by buildOpportunityClickUrl in radar-lead-clicks.ts
 * (single source of truth shared with the sender — see that module).
 */
const PAGE = (title: string, body: string) =>
  `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>${title} — Contrax</title>
</head>
<body style="margin:0;padding:0;background-color:#020617;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;">
  <div style="max-width:520px;margin:0 auto;padding:48px 20px;text-align:center;">
    <p style="margin:0 0 8px;font-size:13px;font-weight:700;letter-spacing:0.12em;color:#fbbf24;text-transform:uppercase;">Contrax</p>
    <h1 style="margin:0 0 12px;font-size:24px;font-weight:800;color:#ffffff;">${title}</h1>
    <p style="margin:0;font-size:15px;line-height:1.6;color:#cbd5e1;">${body}</p>
    <a href="https://www.contrax.company/radar" style="display:inline-block;margin-top:28px;background:#fbbf24;color:#020617;text-decoration:none;padding:12px 28px;border-radius:10px;font-size:15px;font-weight:700;">Back to Contract Radar</a>
    <p style="margin-top:24px;font-size:12px;color:#64748b;">No account required · unsubscribe anytime with one click</p>
  </div>
</body>
</html>`;

const redirect = (location: string) =>
  new Response(null, { status: 302, headers: { location } });

/** Numeric bid id from the query string — absent/invalid → null. */
function parseBidId(raw: string | null): number | null {
  if (!raw) return null;
  const n = Number(raw.trim());
  return Number.isInteger(n) && n > 0 ? n : null;
}

async function handler({ request }: { request: Request }) {
  try {
    const url = new URL(request.url);
    const token = (url.searchParams.get("token") ?? "").trim();
    const bidId = parseBidId(url.searchParams.get("bid"));
    const rad = "https://www.contrax.company/radar";
    if (!token || token.length > 200) return redirect(rad);
    if (!bidId) return redirect(rad);

    // Resolve the bid's REAL destination FIRST — the redirect never depends on
    // any write below (fail-open: unknown bid still 302s to radar, never a 500).
    let sourceUrl: string | null = null;
    try {
      const bid = (await sql()`
        SELECT source_url FROM bids WHERE id = ${bidId} LIMIT 1
      `) as Array<{ source_url: string | null }>;
      sourceUrl = bid[0]?.source_url ?? null;
    } catch (e) {
      console.error("[api/radar/opportunity-click] bid lookup failed (redirecting anyway):", (e as Error).message);
    }
    const destination = sourceUrl && /^https?:\/\//i.test(sourceUrl) ? sourceUrl : rad;

    // Resolve the lead. Unknown/unsubscribed/unconfirmed → plain 302 (no
    // reveal of why, no click logging — fail-open ALWAYS).
    let lead: { id: number; visitor_id: string | null; unsubscribed_at: string | null; confirmed_at: string | null } | null = null;
    try {
      const rows = (await sql()`
        SELECT id, visitor_id, unsubscribed_at, confirmed_at
        FROM radar_leads WHERE unsubscribe_token = ${token} LIMIT 1
      `) as Array<{ id: number; visitor_id: string | null; unsubscribed_at: string | null; confirmed_at: string | null }>;
      lead = rows[0] ?? null;
    } catch (e) {
      console.error("[api/radar/opportunity-click] lead lookup failed (redirecting anyway):", (e as Error).message);
    }
    if (!lead || lead.unsubscribed_at || !lead.confirmed_at) return redirect(destination);

    // Shared per-IP rate limit (120/hr) — the ONLY gate that can short-circuit
    // the writes, and it must fail-open: a limiter error still redirects.
    try {
      const ipLimit = await checkIpLimit(request, CLICK_SCOPE, CLICK_IP_LIMIT, CLICK_IP_WINDOW);
      if (!ipLimit.allowed) return redirect(destination);
    } catch (e) {
      console.error("[api/radar/opportunity-click] rate limit failed (redirecting anyway):", (e as Error).message);
    }

    // 1) Self-heal the click-log schema (same guard as every route; identity
    //    with db/migrations/033_radar_leads_clicks.sql).
    try {
      await ensureRadarLeadsClickLog();
    } catch (e) {
      console.error("[api/radar/opportunity-click] ensure click log failed (redirecting anyway):", (e as Error).message);
    }

    // 2) Idempotent click row — PK (lead_id, bid_id) absorbs repeat clicks, so
    //    a second click on the same emailed bid NEVER double-counts. Fires only
    //    for pairs the sender actually emailed (pre-seeded rows). clicked_at is
    //    refreshed on repeat clicks so the admin table shows the LATEST click
    //    time; token_hash is the sha256 — never the raw token.
    let inserted = false;
    try {
      const rows = (await sql()`
        INSERT INTO radar_lead_opportunity_clicks (lead_id, bid_id, clicked_at, token_hash)
        VALUES (${lead.id}, ${bidId}, NOW(), ${hashClickToken(token)})
        ON CONFLICT (lead_id, bid_id) DO UPDATE SET clicked_at = NOW()
        RETURNING (xmax = 0) AS did_insert
      `) as Array<{ did_insert: boolean }>;
      inserted = rows[0]?.did_insert === true;
    } catch (e) {
      console.error("[api/radar/opportunity-click] click insert failed (redirecting anyway):", (e as Error).message);
    }

    // 3) Per-lead counter — incremented ONLY when this click actually inserted
    //    (never on a repeat click). Fail-open; the 302 never waits on this.
    if (inserted) {
      try {
        await sql()`
          UPDATE radar_leads SET click_count = click_count + 1, last_clicked_at = NOW()
          WHERE id = ${lead.id}
        `;
      } catch (e) {
        console.error("[api/radar/opportunity-click] click_count update failed (redirecting anyway):", (e as Error).message);
      }
    }

    // 4) Funnel event (stage 4 — opportunity_clicked). Fire-and-log; a funnel
    //    failure never blocks the redirect.
    try {
      await sql()`
        INSERT INTO funnel_events (event_name, label, path, user_agent, visitor_id)
        VALUES ('opportunity_clicked', ${String(bidId)}, ${"/api/radar/opportunity-click"}, ${"radar-click-redirect"}, ${lead.visitor_id})
        ON CONFLICT DO NOTHING
      `;
    } catch (e) {
      console.error("[api/radar/opportunity-click] funnel event failed (redirecting anyway):", (e as Error).message);
    }

    return redirect(destination);
  } catch (err) {
    // Absolute last resort — fail-open to the Radar landing, never a 5xx the
    // lead stares at from an email link.
    console.error("[api/radar/opportunity-click] error (falling back to /radar):", (err as Error).message);
    return redirect("https://www.contrax.company/radar");
  }
}

export const Route = createFileRoute("/api/radar/opportunity-click")({
  server: { handlers: { GET: handler } },
});