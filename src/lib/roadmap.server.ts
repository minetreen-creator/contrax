/** Loads a member's roadmap inputs and saves the milestones they check off. */
import { sql } from "~/db";
import { eligibilityFor, parseAutopilotVerdict, profileList } from "~/lib/autopilot";
import { profileStateCodes } from "~/lib/profile-match";
import { MILESTONE_KEYS, profileTradeSlug, type RoadmapInput, type RoadmapPick, type RoadmapProfile } from "~/lib/roadmap";

export async function ensureRoadmapTable(): Promise<void> {
  await sql()`
    CREATE TABLE IF NOT EXISTS roadmap_milestones (
      user_id INTEGER NOT NULL,
      key TEXT NOT NULL,
      done_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      PRIMARY KEY (user_id, key)
    )
  `;
}

async function loadProfile(userId: number): Promise<RoadmapProfile | null> {
  const rows = (await sql()`
    SELECT business_name, industry, service_categories, naics_codes, locations, certifications, uei, sam_expiration,
           years_in_business, past_performance_summary, capability_statement
    FROM business_profiles WHERE user_id = ${userId} ORDER BY id ASC LIMIT 1
  `) as Record<string, any>[];
  const p = rows[0];
  if (!p) return null;
  return {
    businessName: p.business_name ?? null,
    industry: p.industry ?? null,
    services: profileList(p.service_categories),
    naics: profileList(p.naics_codes),
    states: profileStateCodes(profileList(p.locations)),
    certifications: profileList(p.certifications),
    uei: p.uei ? String(p.uei) : null,
    samExpiration: p.sam_expiration ? new Date(p.sam_expiration).toISOString().slice(0, 10) : null,
    yearsInBusiness: p.years_in_business ?? null,
    pastPerformance: p.past_performance_summary ?? null,
    capabilityStatement: p.capability_statement ?? null,
  };
}

/** Auto-Pilot's recent pursue/partner answers for open bids (saved by the morning scoring). */
async function loadPicks(userId: number, certifications: string[]): Promise<RoadmapPick[]> {
  let rows: { bid_id: number; raw: string; title: string; set_aside: string | null }[] = [];
  try {
    rows = (await sql()`
      SELECT v.bid_id, v.raw, b.title, b.set_aside
      FROM autopilot_verdicts v JOIN bids b ON b.id = v.bid_id
      WHERE v.user_id = ${userId} AND v.created_at > NOW() - INTERVAL '21 days' AND b.due_date > NOW()
      ORDER BY v.created_at DESC LIMIT 60
    `) as typeof rows;
  } catch {
    return []; // no Auto-Pilot answers saved yet
  }
  const out: RoadmapPick[] = [];
  for (const r of rows) {
    const v = parseAutopilotVerdict(r.raw, { bid_id: Number(r.bid_id), title: r.title }, eligibilityFor(r.set_aside, certifications));
    if (v && v.decision !== "pass" && v.fit >= 60) out.push({ bidId: v.bid_id, title: r.title, decision: v.decision, fit: v.fit, missing: v.missing });
  }
  return out.sort((a, b) => (a.decision === b.decision ? b.fit - a.fit : a.decision === "pursue" ? -1 : 1));
}

export async function loadRoadmap(userId: number): Promise<RoadmapInput | null> {
  const profile = await loadProfile(userId);
  if (!profile) return null;
  const trade = profileTradeSlug(profile);
  const state = profile.states?.[0] ?? null;
  let market: RoadmapInput["market"] = null;
  let primes: RoadmapInput["primes"] = [];
  if (trade && state) {
    try {
      const { loadGapMap } = await import("~/lib/gap-map.server");
      const s = (await loadGapMap(trade)).states.find((x) => x.state === state);
      if (s) market = { spend: s.spend, setAsideShare: s.setAsideShare, topAgencies: s.topAgencies, ending12: s.ending12, label: s.label };
    } catch (e) {
      console.warn(`[roadmap] market failed: ${(e as Error).message}`);
    }
    try {
      const { loadPrimes } = await import("~/lib/prime-finder.server");
      primes = (await loadPrimes(trade, state))
        .filter((p) => p.hasPlan)
        .slice(0, 3)
        .map((p) => ({ name: p.name, value: p.value, agencies: p.agencies, nextEnd: p.nextEnd }));
    } catch (e) {
      console.warn(`[roadmap] primes failed: ${(e as Error).message}`);
    }
  }
  const picks = await loadPicks(userId, profile.certifications ?? []);
  await ensureRoadmapTable();
  const done = ((await sql()`SELECT key FROM roadmap_milestones WHERE user_id = ${userId}`) as { key: string }[]).map((r) => r.key);
  return { profile, trade, state, market, primes, picks: picks.slice(0, 5), done };
}

/** Check or uncheck one milestone for the member. Only known keys are accepted. */
export async function setMilestone(userId: number, key: string, done: boolean): Promise<boolean> {
  if (!MILESTONE_KEYS.includes(key)) return false;
  await ensureRoadmapTable();
  if (done) {
    await sql()`INSERT INTO roadmap_milestones (user_id, key) VALUES (${userId}, ${key}) ON CONFLICT (user_id, key) DO NOTHING`;
  } else {
    await sql()`DELETE FROM roadmap_milestones WHERE user_id = ${userId} AND key = ${key}`;
  }
  return true;
}
