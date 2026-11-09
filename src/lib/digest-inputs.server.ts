/**
 * What the 6 AM email works from, shared by the email job (src/jobs/send-bid-digest.ts, GitHub)
 * and Auto-Pilot's early-morning scoring (src/lib/autopilot-prescore.server.ts, Vercel), so both
 * see the same new bids and the same members (owner 2026-11-09: GitHub isn't reliable, so the
 * AI work runs on Vercel and the email only reads the saved answers).
 */
import { sql } from "~/db";
import { AWARD_EXCLUSION_SQL } from "~/lib/source-class";
import { LOW_CONTENT_SQL } from "~/lib/low-content";
import type { NewBidSummary } from "~/lib/email";
import { digestWindowStart, type DigestUserRow } from "~/lib/digest-recipients";
import type { DigestBidFields, DigestProfile } from "~/lib/digest-match";

export type DigestBid = NewBidSummary & { bid_id: number; match: DigestBidFields };
export type DigestMember = DigestUserRow & DigestProfile & Record<string, any>;

export async function ensureBidDigestLog(): Promise<void> {
  await sql()`
    CREATE TABLE IF NOT EXISTS bid_digest_log (
      id SERIAL PRIMARY KEY,
      sent_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      window_start TIMESTAMPTZ NOT NULL,
      bids INTEGER NOT NULL,
      recipients INTEGER NOT NULL
    )
  `;
}

/** The open bids added since the last digest that was sent, up to `now`. */
export async function loadDigestBids(now = new Date()): Promise<{ since: Date; bids: DigestBid[] }> {
  await ensureBidDigestLog();
  const last = (await sql()`SELECT MAX(sent_at) AS last FROM bid_digest_log`) as { last: string | null }[];
  const since = digestWindowStart(last[0]?.last ?? null, now.getTime());
  const rows = (await sql()`
    SELECT id AS bid_id, title, agency, source_url, location, due_date, set_aside, source,
           description, category, naics_code
    FROM bids
    WHERE created_at > ${since.toISOString()}
      AND created_at <= ${now.toISOString()}
      AND due_date > NOW()
      AND ${sql().unsafe(LOW_CONTENT_SQL)}
      AND ${sql().unsafe(AWARD_EXCLUSION_SQL)}
  `) as any[];
  const bids = rows.map((b) => ({
    bid_id: Number(b.bid_id),
    title: String(b.title ?? ""),
    agency: String(b.agency ?? ""),
    source_url: String(b.source_url ?? ""),
    location: String(b.location ?? ""),
    due_date: b.due_date ? new Date(b.due_date).toISOString() : null,
    set_aside: b.set_aside ?? null,
    source: b.source ?? undefined,
    match: {
      title: b.title ?? null,
      description: b.description ?? null,
      category: b.category ?? null,
      location: b.location ?? null,
      agency: b.agency ?? null,
      naics_code: b.naics_code ?? null,
    },
  }));
  return { since, bids };
}

/**
 * Each member with their primary business profile (the first one created; agencies with several
 * profiles get the email for their primary entity).
 */
export async function loadDigestMembers(): Promise<DigestMember[]> {
  return (await sql()`
    SELECT u.id AS user_id, u.email, u.is_admin, u.plan_tier, u.trial_started_at, u.subscription_status,
           u.access_expires_at, u.full_access,
           EXISTS (
             SELECT 1 FROM bid_scout_subscriptions s
             WHERE s.user_id = u.id AND s.status = 'active'
           ) AS has_bid_scout,
           bp.locations, bp.naics_codes, bp.industry, bp.service_categories,
           bp.business_name, bp.certifications, bp.licenses, bp.years_in_business, bp.employee_count,
           bp.typical_contract_value, bp.past_performance_summary, bp.capability_statement,
           bp.listed_for_primes
    FROM users u
    LEFT JOIN LATERAL (
      SELECT locations, naics_codes, industry, service_categories,
             business_name, certifications, licenses, years_in_business, employee_count,
             typical_contract_value, past_performance_summary, capability_statement,
             -- Read through to_jsonb so the email never fails before Sub Finder adds the column.
             COALESCE((to_jsonb(p)->>'listed_for_primes')::boolean, false) AS listed_for_primes
      FROM business_profiles p WHERE p.user_id = u.id ORDER BY p.id ASC LIMIT 1
    ) bp ON true
  `) as DigestMember[];
}
