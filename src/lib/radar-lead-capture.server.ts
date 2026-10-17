import { sql } from "~/db";
import { sendRadarLeadConfirmationEmail } from "~/lib/email";

/**
 * Shared match-alert capture (moved out of /api/radar/lead so Launchpad's
 * "email me my statement" opt-in uses the exact same rules, owner 2026-10-17):
 *
 *   - idempotent upsert keyed on email; a repeat refreshes the profile and
 *     visitor link only — confirmed_at / unsubscribed_at / unsubscribe_token
 *     are NEVER touched (no double-confirm, no resurrection),
 *   - ONE confirmation email, only to the address that submitted, only while
 *     pending, never to a bot UA; a send failure never fails the capture.
 */
export type RadarLeadStatus = "pending" | "confirmed" | "unsubscribed";

export async function captureRadarLead(input: {
  email: string;
  visitorId: string | null;
  radarProfile: string | null;
  source: string;
  sendConfirmation: boolean;
}): Promise<RadarLeadStatus> {
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
  const rows = (await sql()`
    INSERT INTO radar_leads (email, visitor_id, radar_profile, source, consent, unsubscribe_token)
    VALUES (${input.email}, ${input.visitorId}, CAST(${input.radarProfile} AS JSONB), ${input.source}, TRUE, ${crypto.randomUUID()})
    ON CONFLICT (email) DO UPDATE SET
      radar_profile = COALESCE(EXCLUDED.radar_profile, radar_leads.radar_profile),
      visitor_id = COALESCE(EXCLUDED.visitor_id, radar_leads.visitor_id),
      updated_at = NOW()
    RETURNING confirmed_at, unsubscribed_at, unsubscribe_token
  `) as Array<{ confirmed_at: string | null; unsubscribed_at: string | null; unsubscribe_token: string }>;
  const lead = rows[0];
  const confirmed = !!lead?.confirmed_at;
  const unsubscribed = !!lead?.unsubscribed_at;

  if (!confirmed && !unsubscribed && input.sendConfirmation) {
    try {
      await sendRadarLeadConfirmationEmail(input.email, String(lead?.unsubscribe_token ?? ""));
    } catch (e) {
      console.error("[radar-lead-capture] confirmation email failed (capture still saved):", (e as Error)?.message);
    }
  }
  return unsubscribed ? "unsubscribed" : confirmed ? "confirmed" : "pending";
}

/** Bot user-agents never get an email (still stored). Mirrors the funnel bot filter. */
export function isBotUa(ua: string | null): boolean {
  if (!ua) return false;
  const s = ua.toLowerCase();
  return ["bot", "crawler", "spider", "headlesschrome", "puppeteer", "playwright", "python", "curl", "wget", "go-http-client"].some((t) => s.includes(t));
}
