/**
 * TIERED MONTHLY ALLOWANCE ledger for the AI RFP Executive Brief.
 * (owner-ratified 2026-08-29; supersedes the earlier free-tier / ungated call,
 * which passed EVERY signed-up user via isAiBriefEntitled.)
 *
 *   Plan                | Allowance
 *   --------------------+------------------------------
 *   Basic (Free)        |   1 brief / month
 *   Starter ($19)       |   3 briefs / month
 *   Professional ($79)  |  50 briefs / month (full evidence)
 *   Agency ($199)       | 200 briefs / month + team sharing + client-ready export
 *
 * RULES
 *  - Cached views (ai_summary cache hit) do NOT consume allowance.
 *  - A failed (fallback) generation does NOT consume allowance — we don't
 *    charge for a failure.
 *  - An over-limit lower-tier (Basic/Starter) user gets the raw description plus
 *    a locked preview (AI_BRIEF_LOCKED_PREVIEW) and NO generation happens.
 *  - The unit is consumed via a SINGLE atomic `UPDATE ... WHERE briefs_used <
 *    limit` so concurrent requests can never overshoot the cap (consumeAllowance).
 *
 * Honesty: NEVER advertise "unlimited". We surface "You've used N of M AI briefs
 * this month" and the core Professional promise (AI_BRIEF_PROMISE).
 */
import { sql } from "~/db";
import { loadUserTrialStatus } from "~/lib/trial";

/** Per-tier monthly brief allowances (owner-ratified 2026-08-29). */
export const AI_BRIEF_ALLOWANCE: Record<string, number> = {
  basic: 1,
  starter: 3,
  professional: 50,
  agency: 200,
};
/** A covered tier = Professional or Agency (full evidence + workflow connectors). */
export const AI_BRIEF_COVERED = new Set(["professional", "agency"]);

/** Exact owner-specified locked-preview copy — do not change. */
export const AI_BRIEF_LOCKED_PREVIEW =
  "Understand this RFP in minutes, not hours. Upgrade to Professional to reveal its mandatory requirements, critical deadlines and potential red flags.";

/** The core Professional promise shown near the upgrade / locked surface. */
export const AI_BRIEF_PROMISE =
  "Find the right contract, understand every requirement, evaluate your odds and begin your response—all inside Contrax.";

const CREATE_TABLE = `
  CREATE TABLE IF NOT EXISTS ai_brief_allowance (
    id BIGSERIAL PRIMARY KEY,
    user_id INTEGER NOT NULL REFERENCES users(id),
    billing_period TEXT NOT NULL,
    tier TEXT NOT NULL,
    briefs_used INTEGER NOT NULL DEFAULT 0,
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE (user_id, billing_period)
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
    console.error("[ai-brief-allowance] ensureTable failed (fail-open):", e);
    return false;
  }
}

/** YYYY-MM billing period for the current (UTC) month. */
export function billingPeriod(d: Date = new Date()): string {
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, "0");
  return `${y}-${m}`;
}

export interface AllowanceStatus {
  tier: string;
  limit: number;
  used: number;
  remaining: number;
  /** true for Professional / Agency (full evidence + workflow connectors). */
  covered: boolean;
  /** true for a lower-tier user who has exhausted their monthly allowance. */
  overLimit: boolean;
}

/**
 * Effective tier for a user, honoring the SAME grant / demo / admin logic that
 * PlanGate and hasProfessionalAccess use (src/lib/trial.ts): an ACTIVE
 * time-boxed grant (access_expires_at in the future) passes every gate, an
 * expired grant no longer unlocks premium, internal admins and the demo tier
 * are treated as Professional.
 */
export async function effectiveTier(
  userId: number,
  user?: { is_admin?: boolean } | null,
): Promise<{ tier: string; covered: boolean }> {
  if (user?.is_admin) return { tier: "professional", covered: true };
  let trial;
  try {
    trial = await loadUserTrialStatus(userId);
  } catch {
    trial = null;
  }
  const planTier = (trial?.planTier ?? "basic") as string;
  // The internal demo account showcases all features.
  if (planTier === "demo") return { tier: "professional", covered: true };
  // An ACTIVE full-access grant passes every gate; treat as Professional.
  if (trial?.fullAccess) return { tier: "professional", covered: true };
  // Expired trial / expired grant no longer grants premium → use DB tier only.
  const expired = !!trial?.expired;
  const known = planTier in AI_BRIEF_ALLOWANCE;
  const tier = known ? planTier : "basic";
  const covered = !expired && AI_BRIEF_COVERED.has(tier);
  return { tier, covered };
}

/**
 * Current allowance status WITHOUT consuming. Cached views call this so the UI
 * can always show an honest "You've used N of M this month" indicator.
 */
export async function getAllowanceStatus(
  userId: number,
  user?: { is_admin?: boolean } | null,
): Promise<AllowanceStatus> {
  const { tier, covered } = await effectiveTier(userId, user);
  const limit = AI_BRIEF_ALLOWANCE[tier] ?? 1;
  let used = 0;
  try {
    if (await ensureTable()) {
      const period = billingPeriod();
      const rows = (await sql()`
        SELECT briefs_used FROM ai_brief_allowance
        WHERE user_id = ${userId} AND billing_period = ${period}
      `) as Array<{ briefs_used: number }>;
      used = Number(rows?.[0]?.briefs_used ?? 0);
    }
  } catch {
    /* treat as 0 on blip — server stays authoritative elsewhere */
  }
  return {
    tier,
    limit,
    used,
    remaining: Math.max(0, limit - used),
    covered,
    overLimit: !covered && used >= limit,
  };
}

/**
 * Atomically consume ONE brief for the user's current billing period. Uses a
 * single UPDATE guarded by `briefs_used < limit` so concurrent requests can
 * never overshoot the cap: when the row is already at `limit` the UPDATE
 * matches 0 rows and returns null (nothing consumed). Callers invoke this ONLY
 * after a SUCCESSFUL non-cached, non-fallback generation.
 *
 * @returns the new used count, or null when the period is already at the cap
 *          (the caller's generation should still be served — it was within
 *          their allowance when the pre-check passed; the guard prevents any
 *          overshoot going forward).
 */
export async function consumeAllowance(
  userId: number,
  tier: string,
  limit: number,
): Promise<number | null> {
  try {
    if (!(await ensureTable())) return limit; // fail-open
    const period = billingPeriod();
    // Idempotently ensure a ledger row exists for this period.
    await sql()`
      INSERT INTO ai_brief_allowance (user_id, billing_period, tier, briefs_used)
      VALUES (${userId}, ${period}, ${tier}, 0)
      ON CONFLICT (user_id, billing_period)
      DO UPDATE SET tier = EXCLUDED.tier, updated_at = NOW()
    `;
    // Atomic guarded increment — cannot overshoot.
    const rows = (await sql()`
      UPDATE ai_brief_allowance
      SET briefs_used = briefs_used + 1, updated_at = NOW()
      WHERE user_id = ${userId} AND billing_period = ${period} AND briefs_used < ${limit}
      RETURNING briefs_used
    `) as Array<{ briefs_used: number }>;
    if (!rows.length) return null; // at cap — nothing consumed
    return Number(rows[0].briefs_used);
  } catch (e) {
    console.error("[ai-brief-allowance] consumeAllowance failed (fail-open):", e);
    return limit; // fail-open so a Neon blip never locks a real user out
  }
}

/** Compact allowance shape safe to include in API responses (no PII). */
export function serializeAllowance(a: AllowanceStatus) {
  return {
    tier: a.tier,
    limit: a.limit,
    used: a.used,
    remaining: a.remaining,
    covered: a.covered,
  };
}
