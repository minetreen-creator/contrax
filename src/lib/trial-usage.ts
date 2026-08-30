/**
 * TRIAL USAGE LEDGER — per-trial caps for the 14-day PROFESSIONAL trial.
 * (owner requirements, lazy-start Professional trial)
 *
 * The 14-day trial is an explicit PROFESSIONAL trial that:
 *  - starts LAZILY: `trial_started_at` is set on FIRST premium-feature use
 *    (src/lib/trial.ts `ensureTrialStarted`), NOT at account signup;
 *  - requires NO credit card;
 *  - grants Professional-tier access during the trial (NOT Agency — the Red
 *    Team evaluator stays Agency-only);
 *  - auto-DOWNGRADES to Basic (all gates lock) when the 14 days expire WITHOUT
 *    deleting the user's saved bids / pipeline / checklist progress;
 *  - is capped per-trial by this ledger, keyed to the trial INSTANCE
 *    (`trial_started_at`) so usage NEVER resets at a calendar-month boundary.
 *
 * Caps (per single 14-day trial, one shared ledger):
 *    5  AI Executive Briefs
 *    3  complete bid scores
 *    1  proposal draft
 *    3  incumbent-intelligence looks
 *
 * THIS IS SEPARATE from the MONTHLY `ai_brief_allowance` ledger (which governs
 * the AI Executive Brief per billing month for real paid plans). For an active
 * Professional-trial user the MONTHLY Professional allowance (50/mo) still
 * applies, but the trial's 5-brief cap is the BINDING constraint during the
 * trial. Cached / re-viewed Executive Briefs consume NEITHER ledger.
 */
import { sql } from "~/db";
import { ensureTrialStarted, loadUserTrialStatus } from "~/lib/trial";

/** Per-trial caps — one shared ledger, keyed to the trial instance. */
export const TRIAL_CAPS = {
  briefs: 5,
  scores: 3,
  drafts: 1,
  incumbent: 3,
} as const;
export type TrialUsageKey = keyof typeof TRIAL_CAPS;

/** The 4-item user-visible trial checklist (owner-specified items). */
export const TRIAL_CHECKLIST: ReadonlyArray<{ key: TrialUsageKey; label: string; limit: number }> = [
  { key: "briefs", label: "Generate an Executive Brief", limit: TRIAL_CAPS.briefs },
  { key: "incumbent", label: "Review incumbent pricing", limit: TRIAL_CAPS.incumbent },
  { key: "scores", label: "Score an opportunity", limit: TRIAL_CAPS.scores },
  { key: "drafts", label: "Start a proposal draft", limit: TRIAL_CAPS.drafts },
];

/** SQL column name for a usage key — a CLOSED map, never user input. */
const COLUMN: Record<TrialUsageKey, string> = {
  briefs: "briefs_used",
  scores: "scores_used",
  drafts: "drafts_used",
  incumbent: "incumbent_used",
};

interface TrialUsageRow {
  trial_started_at: Date | string;
  briefs_used: number;
  scores_used: number;
  drafts_used: number;
  incumbent_used: number;
}

const CREATE_TABLE = `
  CREATE TABLE IF NOT EXISTS trial_usage (
    id BIGSERIAL PRIMARY KEY,
    user_id INTEGER NOT NULL REFERENCES users(id),
    trial_started_at TIMESTAMPTZ NOT NULL,  -- keys usage to the trial instance
    briefs_used INTEGER NOT NULL DEFAULT 0,
    scores_used INTEGER NOT NULL DEFAULT 0,
    drafts_used INTEGER NOT NULL DEFAULT 0,
    incumbent_used INTEGER NOT NULL DEFAULT 0,
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE (user_id, trial_started_at)
  )
`;
let initialized = false;
async function ensureTable(): Promise<boolean> {
  if (initialized) return true;
  try {
    const db = sql();
    await db`${db.unsafe(CREATE_TABLE)}`;
    initialized = true;
    return true;
  } catch (e) {
    // Fail-open: a DB blip must never lock a real user out of a premium action.
    console.error("[trial-usage] ensureTable failed (fail-open):", e);
    return false;
  }
}

/** Current usage counts for the user's trial instance. Never throws. */
export interface TrialUsage {
  /** True only while the user is inside an ACTIVE trial window. */
  active: boolean;
  trialStartedAt: string | null;
  briefs: number;
  scores: number;
  drafts: number;
  incumbent: number;
}

const EMPTY: TrialUsage = { active: false, trialStartedAt: null, briefs: 0, scores: 0, drafts: 0, incumbent: 0 };

export async function getTrialUsage(userId: number): Promise<TrialUsage> {
  try {
    const endsAt = await ensureTrialStarted(userId);
    if (!endsAt) return EMPTY; // not started (Basic user who used nothing premium) or paid
    if (!(await ensureTable())) return EMPTY;
    const rows = (await sql()`
      SELECT trial_started_at, briefs_used, scores_used, drafts_used, incumbent_used
      FROM trial_usage
      WHERE user_id = ${userId}
      ORDER BY trial_started_at DESC
      LIMIT 1
    `) as Array<TrialUsageRow>;
    const active = (await isTrialActive(userId));
    if (!rows.length) return { active, trialStartedAt: endsAt, briefs: 0, scores: 0, drafts: 0, incumbent: 0 };
    const r = rows[0];
    return {
      active,
      trialStartedAt: String(r.trial_started_at),
      briefs: Number(r.briefs_used || 0),
      scores: Number(r.scores_used || 0),
      drafts: Number(r.drafts_used || 0),
      incumbent: Number(r.incumbent_used || 0),
    };
  } catch (e) {
    console.error("[trial-usage] getTrialUsage failed (fail-open):", e);
    return EMPTY;
  }
}

/** True only while the user's trial window is still running (and not paid). */
async function isTrialActive(userId: number): Promise<boolean> {
  try {
    return (await loadUserTrialStatus(userId)).active;
  } catch {
    return false;
  }
}

export interface CapStatus {
  /** True while the trial is active (a cap applies). */
  trialActive: boolean;
  /** True when the user may proceed (under the per-trial cap). */
  allowed: boolean;
  used: number;
  limit: number;
  remaining: number;
}

/**
 * Check (WITHOUT consuming) whether the user may use a trial-capped premium
 * action. When the trial is NOT active (paid plan, or locked-out Basic after
 * expiry) no cap applies and `allowed` is true — the caller's normal gating
 * (plan tier / monthly ledger) governs access instead.
 */
export async function checkTrialCap(userId: number, key: TrialUsageKey): Promise<CapStatus> {
  const deadline = await ensureTrialStarted(userId);
  const active = await isTrialActive(userId);
  const limit = TRIAL_CAPS[key];
  if (!active) return { trialActive: false, allowed: true, used: 0, limit, remaining: limit };
  if (!deadline || !(await ensureTable())) return { trialActive: true, allowed: true, used: 0, limit, remaining: limit };
  const used = await readCount(userId, key);
  return {
    trialActive: true,
    allowed: used < limit,
    used,
    limit,
    remaining: Math.max(0, limit - used),
  };
}

async function readCount(userId: number, key: TrialUsageKey): Promise<number> {
  const col = COLUMN[key];
  const rows = (await sql()`
    SELECT ${sql().unsafe(col)} AS used
    FROM trial_usage
    WHERE user_id = ${userId}
    ORDER BY trial_started_at DESC
    LIMIT 1
  `) as Array<{ used: number }>;
  return rows.length ? Number(rows[0].used || 0) : 0;
}

/**
 * Atomically consume ONE unit of a trial-capped premium action, guarded by
 * `col < cap` so concurrent requests can never overshoot. Returns the post
 * increment count, or null when the instance is already at the cap (nothing
 * consumed). Callers invoke this ONLY after a SUCCESSFUL non-cached premium
 * action — cached views and failed generations are free (mirrors the
 * ai_brief_allowance cached-view-exclusion behavior).
 */
export async function consumeTrial(userId: number, key: TrialUsageKey): Promise<number | null> {
  const active = await isTrialActive(userId);
  if (!active) return 0; // no trial cap outside an active trial
  try {
    const deadline = await ensureTrialStarted(userId);
    if (!deadline) return 0;
    if (!(await ensureTable())) return 0; // fail-open
    const col = COLUMN[key];
    const cap = TRIAL_CAPS[key];
    async function ensureRow() {
      await sql()`
        INSERT INTO trial_usage (user_id, trial_started_at)
        VALUES (${userId}, ${deadline})
        ON CONFLICT (user_id, trial_started_at) DO NOTHING
      `;
    }
    await ensureRow();
    const rows = (await sql()`
      UPDATE trial_usage
      SET ${sql().unsafe(col)} = ${sql().unsafe(col)} + 1, updated_at = NOW()
      WHERE user_id = ${userId} AND trial_started_at = ${deadline}
        AND ${sql().unsafe(col)} < ${cap}
      RETURNING ${sql().unsafe(col)} AS used
    `) as Array<{ used: number }>;
    if (!rows.length) return null; // at cap — nothing consumed
    return Number(rows[0].used);
  } catch (e) {
    console.error("[trial-usage] consumeTrial failed (fail-open):", e);
    return 0; // fail-open so a Neon blip never locks a real user out
  }
}
