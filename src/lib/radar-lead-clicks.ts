import { sql } from "~/db";
import { createHash } from "node:crypto";

/**
 * PII-safe click plumbing for Radar match-alert emails (owner 2026-09-07).
 *
 * The email's per-bid "View opportunity →" CTA points at
 *   /api/radar/opportunity-click?bid=<id>&token=<unsubscribe_token>
 * instead of the raw source_url, so the redirect can:
 *
 *   1. resolve the lead from the token (server-side — the token never leaves
 *      the lead's own email; the raw email address is NEVER in the URL),
 *   2. log the click (lead_id resolved server-side, bid_id, timestamp, the
 *      lead's visitor_id when carried — NEVER the raw email, NEVER the raw
 *      token; the token is SHA-256-hashed if stored),
 *   3. record an `opportunity_clicked` funnel event (same funnel_events
 *      plumbing as every other surface — no parallel system),
 *   4. 302 to the bid's real source_url — fail-open, ALWAYS, even when every
 *      write above failed.
 *
 * Idempotent: the same click twice does NOT double-count the lead's
 * click_count (the (lead_id, bid_id) PK on the log table absorbs it). Basic
 * per-IP rate limit via the shared rate limiter (fail-open).
 *
 * Storage (migration 033, self-healed here like every guard):
 *   radar_leads.click_count / .last_clicked_at — counters for the masked admin
 *     lead table (no per-click PII on the lead row itself);
 *   radar_lead_opportunity_clicks — the per-click log. DISTINCT NAME: the
 *     legacy migration-019 `radar_alerts_sent` and the 032
 *     `radar_leads_alerts_sent` sent-logs must never be touched by this path.
 */

export const CLICK_SCOPE = "radar_click_ip";
export const CLICK_IP_LIMIT = 120; // clicks per IP per hour — generous, real humans click rarely
export const CLICK_IP_WINDOW = 60 * 60;

/** Self-healing DDL guard — identical to db/migrations/033_radar_leads_clicks.sql. */
export async function ensureRadarLeadsClickLog(): Promise<void> {
  await sql()`ALTER TABLE radar_leads ADD COLUMN IF NOT EXISTS click_count INT NOT NULL DEFAULT 0`;
  await sql()`ALTER TABLE radar_leads ADD COLUMN IF NOT EXISTS last_clicked_at TIMESTAMPTZ`;
  const cols = (await sql()`
    SELECT column_name FROM information_schema.columns
    WHERE table_name = 'radar_lead_opportunity_clicks' AND table_schema = 'public'
  `) as Array<{ column_name: string }>;
  if (cols.length === 0) {
    await sql()`CREATE TABLE IF NOT EXISTS radar_lead_opportunity_clicks (
      lead_id BIGINT NOT NULL REFERENCES radar_leads(id) ON DELETE CASCADE,
      bid_id INTEGER NOT NULL REFERENCES bids(id) ON DELETE CASCADE,
      clicked_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      token_hash TEXT,
      PRIMARY KEY (lead_id, bid_id)
    )`;
    await sql()`CREATE INDEX IF NOT EXISTS radar_lead_opportunity_clicks_lead_idx ON radar_lead_opportunity_clicks (lead_id)`;
  } else {
    // Guard against partially-applied 033 (columns added but index missing).
    await sql()`CREATE INDEX IF NOT EXISTS radar_lead_opportunity_clicks_lead_idx ON radar_lead_opportunity_clicks (lead_id)`;
  }
}

/** SHA-256 of the raw token — the only token-derived value ever stored. */
export function hashClickToken(token: string): string {
  return createHash("sha256").update(token, "utf8").digest("hex");
}

/**
 * ONE source of truth for the per-bid "View opportunity →" CTA URL. Both the
 * sender (radar-lead-alerts.ts, which builds each email's click_url) and the
 * redirect route (opportunity-click.ts, which consumes it) derive from this
 * function so the URL can never drift between them.
 *
 * PII-safe by construction: the only lead-specific value in the URL is the
 * one-click unsubscribe_token (a random UUID the lead already has) — the raw
 * email address NEVER appears. The route resolves the lead server-side from
 * the token and stores only the sha256 hash.
 */
export function buildOpportunityClickUrl(bidId: number, token: string): string {
  const bid = Number.isFinite(Number(bidId)) && Number(bidId) > 0 ? Number(bidId) : 0;
  return `https://www.contrax.company/api/radar/opportunity-click?bid=${bid}&token=${encodeURIComponent(token)}`;
}
