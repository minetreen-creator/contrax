/**
 * A member's own numbers for the trial emails and the post-trial dashboard
 * card (owner 2026-10-19): open bids matching their profile (the same matcher
 * the morning digest uses), how many close this week, and their saved bids.
 */
import { sql } from "~/db";
import { AWARD_EXCLUSION_SQL } from "~/lib/source-class";
import { LOW_CONTENT_SQL } from "~/lib/low-content";
import { buildDigestMatcher, type DigestBidFields, type DigestProfile } from "~/lib/digest-match";
import type { TrialRecap } from "~/lib/trial-emails";

const DAY_MS = 24 * 60 * 60 * 1000;

export interface OpenBid {
  id: number;
  title: string;
  dueAt: number;
  match: DigestBidFields;
}

/** Every open bid with the fields the digest matcher reads. Load once per run. */
export async function loadOpenBids(): Promise<OpenBid[]> {
  const rows = (await sql()`
    SELECT id, title, agency, location, due_date, description, category, naics_code
    FROM bids
    WHERE due_date > NOW()
      AND ${sql().unsafe(LOW_CONTENT_SQL)}
      AND ${sql().unsafe(AWARD_EXCLUSION_SQL)}
  `) as any[];
  return rows.map((b) => ({
    id: Number(b.id),
    title: String(b.title ?? ""),
    dueAt: new Date(b.due_date).getTime(),
    match: {
      title: b.title ?? null,
      description: b.description ?? null,
      category: b.category ?? null,
      location: b.location ?? null,
      agency: b.agency ?? null,
      naics_code: b.naics_code ?? null,
    },
  }));
}

/** The member's matching open bids, soonest deadline first. Empty without a trade or states. */
export function matchingBids(profile: DigestProfile, open: readonly OpenBid[]): { bids: OpenBid[]; label: string | null } {
  const matcher = buildDigestMatcher(profile);
  if (!matcher.personal) return { bids: [], label: null };
  const bids = open.filter((b) => matcher.matches(b.match)).sort((a, b) => a.dueAt - b.dueAt);
  return { bids, label: matcher.label || null };
}

export async function trialRecapFor(
  userId: number,
  profile: DigestProfile,
  open: readonly OpenBid[],
  now: number = Date.now(),
): Promise<TrialRecap> {
  const { bids, label } = matchingBids(profile, open);
  const saved = (await sql()`
    SELECT COUNT(*)::int AS n,
           COUNT(*) FILTER (WHERE b.due_date > NOW() AND b.due_date <= NOW() + INTERVAL '10 days')::int AS soon
    FROM saved_matches s LEFT JOIN bids b ON b.id = s.bid_id
    WHERE s.user_id = ${userId} AND s.status = 'saved'
  `) as { n: number; soon: number }[];
  return {
    openMatches: bids.length,
    closingThisWeek: bids.filter((b) => b.dueAt - now <= 7 * DAY_MS).length,
    saved: saved[0]?.n ?? 0,
    savedClosingSoon: saved[0]?.soon ?? 0,
    matchLabel: label,
  };
}

/** The member's primary business profile (first created), as the digest uses. */
export async function primaryProfile(userId: number): Promise<DigestProfile> {
  const rows = (await sql()`
    SELECT locations, naics_codes, industry, service_categories
    FROM business_profiles WHERE user_id = ${userId} ORDER BY id ASC LIMIT 1
  `) as DigestProfile[];
  return rows[0] ?? ({} as DigestProfile);
}
