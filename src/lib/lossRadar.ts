/**
 * Loss Radar — internal admin tool that identifies companies active in
 * government-contract NAICS spaces so Contrax can target them for outreach.
 *
 * It combines:
 *   - award activity from the legacy `awarded_contracts` table, grouped by
 *     (winning_company, naics_code): award count, total awarded value, and the
 *     number of contract records won;
 *   - loss signals from `bid_losses` (the firms named as the winner of bids our
 *     users logged as losses), grouped by (awarded_to, naics_code).
 *
 * Every prospect gets a transparent 0–100 score (see computeProspectScore).
 *
 * Server-only module: import it only from inside `createServerFn` handlers or
 * route loaders — never from client components.
 */
import { sql } from "~/db";

export interface LossRadarProspect {
  company: string;
  /** Primary NAICS code for this company's activity group. */
  naics: string;
  /** Award records found for this company + NAICS pair. */
  awardCount: number;
  /** Distinct contract records counted (one awarded_contracts row per contract). */
  contractCount: number;
  /** Total awarded value in USD, parsed from the award_amount text column. */
  totalValue: number;
  lastAwardDate: string | null;
  /** Loss signals: number of tracked bid losses this firm won. */
  lossCount: number;
  lastLossDate: string | null;
  /** Newest of lastAwardDate / lastLossDate — drives the recency component. */
  lastActivityDate: string | null;
  prospectScore: number;
  scoreBreakdown: {
    value: number;
    activity: number;
    recency: number;
    competition: number;
  };
}

export interface LossRadarData {
  prospects: LossRadarProspect[];
  totalProspects: number;
  /** Prospects at or above HIGH_VALUE_THRESHOLD — the outreach shortlist. */
  highValueCount: number;
  /** Distinct firms appearing as winners of user-tracked bid losses. */
  companiesWithLossSignals: number;
  /** False when the legacy awarded_contracts table is missing in this DB. */
  awardTablePresent: boolean;
  lastUpdated: string;
}

/** A prospect at or above this score counts as a "high-value" outreach target. */
export const HIGH_VALUE_THRESHOLD = 50;

const DAY_MS = 86_400_000;
const RECENCY_WINDOW_DAYS = 180;

/**
 * Deterministic, transparent prospect score (0–100):
 *   - value       (max 40): log-scaled total award value for the pair
 *   - activity    (max 30): 6 pts per known award, capped at 30
 *   - recency     (max 10): last award or loss signal within 180 days
 *   - competition (max 20): 10 pts per tracked loss signal, capped at 20
 *
 * Companies with big, recent award volume in a NAICS space where our users are
 * losing bids score highest — exactly the firms worth targeting for outreach.
 */
export function computeProspectScore(input: {
  totalValue: number;
  awardCount: number;
  lossCount: number;
  lastActivityDate: string | null;
}): { prospectScore: number; scoreBreakdown: LossRadarProspect["scoreBreakdown"] } {
  const value = Math.min(40, Math.round(Math.log10(Math.max(input.totalValue, 0) + 1) * 4));
  const activity = Math.min(30, input.awardCount * 6);
  const last = input.lastActivityDate ? new Date(input.lastActivityDate).getTime() : 0;
  const recency =
    last > 0 && Number.isFinite(last) && Date.now() - last <= RECENCY_WINDOW_DAYS * DAY_MS ? 10 : 0;
  const competition = Math.min(20, input.lossCount * 10);
  const scoreBreakdown = { value, activity, recency, competition };
  return {
    prospectScore: Math.min(100, value + activity + recency + competition),
    scoreBreakdown,
  };
}

interface AwardGroup {
  company: string;
  naics: string;
  award_count: number;
  total_value: number;
  last_award_date: string | null;
}

interface LossGroup {
  company: string;
  naics: string;
  loss_count: number;
  last_loss_date: string | null;
}

/** True when the given table exists (guards legacy tables missing in some DBs). */
async function hasTable(table: string): Promise<boolean> {
  try {
    const rows = await sql()`SELECT to_regclass(${table}) AS t`;
    return !!rows[0]?.t;
  } catch {
    return false;
  }
}

/** Award activity grouped by (winning_company, naics_code). */
async function loadAwardGroups(): Promise<AwardGroup[]> {
  if (!(await hasTable("public.awarded_contracts"))) return [];
  const rows = await sql()`
    SELECT winning_company AS company,
           naics_code AS naics,
           COUNT(*)::int AS award_count,
           COALESCE(SUM(NULLIF(regexp_replace(award_amount, '[^0-9.]', '', 'g'), '')::numeric), 0)::float AS total_value,
           MAX(award_date)::text AS last_award_date
    FROM awarded_contracts
    WHERE winning_company IS NOT NULL
      AND BTRIM(winning_company) <> ''
      AND naics_code IS NOT NULL
    GROUP BY winning_company, naics_code
  `;
  return (rows as any[]).map((r) => ({
    company: String(r.company).trim(),
    naics: String(r.naics).trim(),
    award_count: Number(r.award_count) || 0,
    total_value: Number(r.total_value) || 0,
    last_award_date: r.last_award_date ? String(r.last_award_date) : null,
  }));
}

/** Loss signals: firms named as the winner of bids our users logged as losses. */
async function loadLossGroups(): Promise<LossGroup[]> {
  if (!(await hasTable("public.bid_losses"))) return [];
  // Self-heal: DBs created before the awarded_to column existed get it added
  // on first load, so loss signals populate instead of silently staying empty.
  try {
    const colCheck = await sql()`SELECT column_name FROM information_schema.columns WHERE table_name = 'bid_losses' AND column_name = 'awarded_to'`;
    if (!colCheck.length) {
      await sql()`ALTER TABLE bid_losses ADD COLUMN IF NOT EXISTS awarded_to TEXT`;
    }
  } catch { return []; }
  try {
    const rows = await sql()`
      SELECT awarded_to AS company,
             naics_code AS naics,
             COUNT(*)::int AS loss_count,
             MAX(created_at)::text AS last_loss_date
      FROM bid_losses
      WHERE awarded_to IS NOT NULL
        AND BTRIM(awarded_to) <> ''
      GROUP BY awarded_to, naics_code
    `;
    return (rows as any[]).map((r) => ({
      company: String(r.company).trim(),
      naics: r.naics ? String(r.naics).trim() : "",
      loss_count: Number(r.loss_count) || 0,
      last_loss_date: r.last_loss_date ? String(r.last_loss_date) : null,
    }));
  } catch {
    return [];
  }
}

/**
 * Loads and scores every (company, NAICS) prospect. Merges award activity with
 * tracked loss signals; firms that only appear in bid_losses (no award records
 * yet) are still surfaced so no loss signal is dropped.
 */
export async function loadLossRadar(): Promise<LossRadarData> {
  const [awards, losses] = await Promise.all([loadAwardGroups(), loadLossGroups()]);

  const pairKey = (company: string, naics: string) =>
    `${company.toLowerCase()}|${naics.toLowerCase()}`;

  const byKey = new Map<string, LossRadarProspect>();

  for (const a of awards) {
    const k = pairKey(a.company, a.naics);
    byKey.set(k, {
      company: a.company,
      naics: a.naics,
      awardCount: a.award_count,
      contractCount: a.award_count, // one awarded_contracts row per contract
      totalValue: a.total_value,
      lastAwardDate: a.last_award_date,
      lossCount: 0,
      lastLossDate: null,
      lastActivityDate: a.last_award_date,
      prospectScore: 0,
      scoreBreakdown: { value: 0, activity: 0, recency: 0, competition: 0 },
    });
  }

  for (const l of losses) {
    const k = pairKey(l.company, l.naics);
    const existing = byKey.get(k);
    if (existing) {
      existing.lossCount += l.loss_count;
      if (l.last_loss_date && (!existing.lastLossDate || l.last_loss_date > existing.lastLossDate)) {
        existing.lastLossDate = l.last_loss_date;
      }
      if (l.last_loss_date && (!existing.lastActivityDate || l.last_loss_date > existing.lastActivityDate)) {
        existing.lastActivityDate = l.last_loss_date;
      }
    } else {
      byKey.set(k, {
        company: l.company,
        naics: l.naics || "—",
        awardCount: 0,
        contractCount: 0,
        totalValue: 0,
        lastAwardDate: null,
        lossCount: l.loss_count,
        lastLossDate: l.last_loss_date,
        lastActivityDate: l.last_loss_date,
        prospectScore: 0,
        scoreBreakdown: { value: 0, activity: 0, recency: 0, competition: 0 },
      });
    }
  }

  const prospects = [...byKey.values()].map((p) => {
    const { prospectScore, scoreBreakdown } = computeProspectScore(p);
    return { ...p, prospectScore, scoreBreakdown };
  });
  prospects.sort(
    (a, b) =>
      b.prospectScore - a.prospectScore ||
      b.totalValue - a.totalValue ||
      b.awardCount - a.awardCount ||
      a.company.localeCompare(b.company),
  );

  return {
    prospects,
    totalProspects: prospects.length,
    highValueCount: prospects.filter((p) => p.prospectScore >= HIGH_VALUE_THRESHOLD).length,
    companiesWithLossSignals: new Set(losses.map((l) => l.company.toLowerCase())).size,
    awardTablePresent: awards.length > 0,
    lastUpdated: new Date().toISOString(),
  };
}
