/**
 * Loads the /upgrade personal pitch (see upgrade-pitch.ts) for one user, with
 * the same live-match rules as the dashboard feed (profile-match.ts). The
 * full profile is used, not the free-plan scope: the pitch shows what a paid
 * plan covers. Read-only; returns null on any error so /upgrade still renders
 * its plans.
 */
import { sql } from "~/db";
import { LIVE_SQL } from "~/lib/bid-status";
import { STATE_NAMES } from "~/lib/contract-map";
import { LOW_CONTENT_SQL } from "~/lib/low-content";
import { noticeKeySql } from "~/lib/notice-dedupe";
import { bidInStates, profileNaicsCodes, profileSetAsidePred, profileStateCodes, profileTradePred } from "~/lib/profile-match";
import { AWARD_EXCLUSION_SQL } from "~/lib/source-class";
import { headStartSummary, medianAward, type PitchBid, type TypicalAward, type UpgradePitch } from "~/lib/upgrade-pitch";

/** Look back at most this many days, however old the account is. */
const MAX_LOOKBACK_DAYS = 60;

const asStrings = (v: unknown): string[] => (Array.isArray(v) ? v.map(String).filter(Boolean) : []);

export async function loadUpgradePitch(userId: number, accountCreatedAt: string): Promise<UpgradePitch | null> {
  try {
    const [p] = (await sql()`
      SELECT certifications, naics_codes, locations, industry, service_categories
      FROM business_profiles WHERE user_id = ${userId} ORDER BY id DESC LIMIT 1
    `) as Record<string, unknown>[];
    const profile = {
      naics_codes: asStrings(p?.naics_codes),
      locations: asStrings(p?.locations),
      industry: p?.industry ? String(p.industry) : null,
      service_categories: asStrings(p?.service_categories),
    };
    const certs = asStrings(p?.certifications);
    const states = profileStateCodes(profile.locations);

    const floor = Date.now() - MAX_LOOKBACK_DAYS * 86_400_000;
    const created = Date.parse(accountCreatedAt);
    const since = new Date(Number.isNaN(created) ? floor : Math.max(created, floor)).toISOString();

    const rows = (await sql()`
      SELECT * FROM (
        SELECT DISTINCT ON (${sql().unsafe(noticeKeySql("bids"))})
          id, title, agency, location, due_date, created_at
        FROM bids
        WHERE created_at >= ${since}
          AND ${sql().unsafe(LIVE_SQL)}
          AND ${sql().unsafe(LOW_CONTENT_SQL)}
          AND ${sql().unsafe(AWARD_EXCLUSION_SQL)}
          ${profileSetAsidePred(certs, sql)} ${profileTradePred(profile, sql)}
        ORDER BY ${sql().unsafe(noticeKeySql("bids"))}, created_at DESC
      ) m
      ORDER BY created_at DESC
      LIMIT 2000
    `) as { id: number; title: string; agency: string | null; location: string | null; due_date: unknown; created_at: unknown }[];

    const toIso = (v: unknown) => (v instanceof Date ? v.toISOString() : v ? String(v) : null);
    const matched: PitchBid[] = rows
      .filter((b) => bidInStates(b.location, b.agency, profile.locations))
      .map((b) => ({
        id: Number(b.id),
        title: String(b.title ?? ""),
        agency: b.agency ? String(b.agency) : null,
        dueDate: toIso(b.due_date),
        createdAt: toIso(b.created_at) ?? since,
      }));

    return {
      since,
      tradeLabel: profile.industry || profile.service_categories[0] || null,
      placeLabel: states.length === 1 ? STATE_NAMES[states[0]] ?? states[0] : states.length > 1 ? `your ${states.length} states` : null,
      newMatches: matched.length,
      examples: matched.slice(0, 3),
      headStart: headStartSummary(matched),
      typicalAward: await loadTypicalAward(profileNaicsCodes(profile), states),
    };
  } catch (err) {
    console.error("[upgrade-pitch] failed:", err);
    return null;
  }
}

/**
 * Median recent federal award for the profile's NAICS codes (award_leads,
 * USAspending), in the user's states when there are enough, else nationwide.
 * Null without NAICS codes or with too few awards.
 */
async function loadTypicalAward(naics: string[], states: string[]): Promise<TypicalAward | null> {
  if (!naics.length) return null;
  const rows = ((await sql()`
    SELECT amount, pop_state FROM award_leads
    WHERE naics_code = ANY(${naics})
      AND awarded_on > NOW() - INTERVAL '365 days'
  `.catch(() => [])) as { amount: number | string; pop_state: string | null }[]).filter((r) => Number(r.amount) > 0);
  const inStates = states.length ? rows.filter((r) => r.pop_state && states.includes(r.pop_state)) : rows;
  const local = medianAward(inStates.map((r) => Number(r.amount)));
  if (local != null) return { median: local, count: inStates.length, scope: states.length ? "state" : "national" };
  const national = medianAward(rows.map((r) => Number(r.amount)));
  return national != null ? { median: national, count: rows.length, scope: "national" } : null;
}
