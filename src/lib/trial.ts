/**
 * Trial tracking helpers for Contrax.
 *
 * Trial lifecycle: a user signs up with `trial_started_at = NOW()` and a
 * `plan_tier` matching the plan they selected (starter/professional/agency).
 * The free Basic package (plan_tier='basic') is exempt — its trial_started_at
 * is NULL, so it never expires and stays free forever.
 * They are "in trial" for TRIAL_DAYS (21) days from that timestamp — the
 * plan_tier value does NOT determine trial state. Paying via Stripe clears
 * `trial_started_at` and sets `subscription_status = 'active'`, ending the
 * trial for good.
 */
import { createServerFn } from "@tanstack/react-start";
import { sql } from "~/db";
import { getCurrentUser } from "~/lib/auth";
export const TRIAL_DAYS = 21;
const DAY_MS = 24 * 60 * 60 * 1000;
/** Tier ladder — higher is more capable. Shared by PlanGate and premium gates.
 * `basic` (0) is the free tier (below Starter); `starter`, `professional` and
 * `agency` are the paid tiers. `savings_premium` is an unrelated one-time price
 * and is not on the ladder (resolves to 0). */
export const TIER_ORDER: Record<string, number> = { basic: 0, starter: 1, professional: 2, agency: 3 };
/**
 * Number of bids a free BASIC user may actively track ("save") in their
 * pipeline. Unlimited bid tracking is a Starter+ feature per the owner's
 * pricing matrix; a Basic (free) user reaching this cap is asked to upgrade to
 * Starter. Starter/Professional/Agency, admins, demo and active-grant users
 * bypass the cap.
 */
export const FREE_SAVE_LIMIT = 3;
/**
 * Shared premium-access predicate used by BOTH premium paywalls (the
 * Incumbent Intelligence reveal and the saved-bid limit). A user "has
 * professional access" iff they are an admin/internal account, OR they are on
 * the internal demo tier, OR they hold an active full-access grant, OR their
 * plan tier is professional/agency AND not expired — the same qualification
 * PlanGate's professional gate uses. Passing `user` (when known) lets admins
 * and the demo account bypass the paywalls even when their DB tier columns
 * wouldn't otherwise qualify (e.g. the owner runs as plan_tier='starter' with
 * is_admin=true).
 */
export function hasProfessionalAccess(
  trial: Pick<TrialStatus, "fullAccess" | "planTier" | "expired"> | null | undefined,
  user?: { is_admin?: boolean } | null,
): boolean {
  // Internal/admin accounts always bypass premium gates.
  if (user?.is_admin) return true;
  if (!trial) return false;
  // A user with an ACTIVE full-access grant passes every tier gate. (expired &&
  // fullAccess=true can never happen: computeTrialStatus drops fullAccess to
  // false once access_expires_at passes, so an expired grant cannot unlock
  // premium features.)
  if (trial.fullAccess) return true;
  // The internal demo account (plan_tier='demo') showcases all features, so it
  // bypasses the premium paywalls.
  if (trial.planTier === "demo" && !trial.expired) return true;
  // At or above Professional AND not expired. The `!expired` guard ensures a
  // time-boxed per-user grant (access_expires_at) stops granting premium
  // features once the date passes: a grant user keeps plan_tier set (e.g.
  // 'professional'), so without this guard a Professional grant would unlock
  // premium features forever after expiry.
  return !!trial.planTier && !trial.expired && (TIER_ORDER[trial.planTier] ?? 0) >= TIER_ORDER.professional;
}
/**
 * Unlimited-saved-bids predicate — the save-limit gate moved from the
 * Professional boundary to the Starter+ boundary (owner's pricing matrix,
 * reconciled in the free Basic Package build). A user "has unlimited saves"
 * iff they are an admin/internal account, OR they hold an active full-access
 * grant, OR they are on the internal demo tier, OR their plan tier is at or
 * above Starter (basic/excluded) AND not expired.
 *
 * Because the limit now maps to Starter+ (not Professional+), a Basic (free,
 * plan_tier='basic') user is capped at FREE_SAVE_LIMIT, while Starter AND
 * Professional (and Agency) users get unlimited saves. Incumbent Intelligence
 * / AI Match Scoring / Draft Tools remain gated on hasProfessionalAccess
 * (Professional+) — this predicate does NOT grant those.
 */
export function hasUnlimitedSaves(
  trial: Pick<TrialStatus, "fullAccess" | "planTier" | "expired"> | null | undefined,
  user?: { is_admin?: boolean } | null,
): boolean {
  // Internal/admin accounts always bypass tier gates.
  if (user?.is_admin) return true;
  if (!trial) return false;
  // An active full-access grant unlocks every tier gate (same as above; an
  // expired grant cannot unlock because computeTrialStatus drops fullAccess).
  if (trial.fullAccess) return true;
  // The internal demo account showcases all features, so it bypasses the cap.
  if (trial.planTier === "demo" && !trial.expired) return true;
  // At or above Starter AND not expired. The `!expired` guard ensures a
  // time-boxed grant stops granting unlimited saves once it passes.
  return !!trial.planTier && !trial.expired && (TIER_ORDER[trial.planTier] ?? 0) >= TIER_ORDER.starter;
}
/**
 * Agency-access predicate — the gate for the Agency plan's Proposal Evaluator
 * "Red Team" and the server-side integration endpoints. A user "has agency
 * access" iff they are an admin/internal account, OR they hold an active
 * full-access grant, OR they are on the internal demo tier, OR their plan tier
 * is at or above Agency (the top of the ladder) AND not expired — the same
 * qualification the other premium predicates use, with TIER_ORDER.agency (3)
 * at the boundary. Because agency is the highest tier, the tier comparison is
 * equivalent to `=== "agency"`. The `!expired` guard ensures a time-boxed
 * per-user grant (access_expires_at) stops granting agency features once the
 * date passes — computeTrialStatus sets expired=true, so no separate time
 * check is needed beyond what hasProfessionalAccess does. Passing `user`
 * (when known) lets admins bypass even when their DB tier wouldn't qualify.
 */
export function hasAgencyAccess(
  trial: Pick<TrialStatus, "fullAccess" | "planTier" | "expired"> | null | undefined,
  user?: { is_admin?: boolean } | null,
): boolean {
  // Internal/admin accounts always bypass tier gates.
  if (user?.is_admin) return true;
  if (!trial) return false;
  // An active full-access grant unlocks every tier gate (same as above; an
  // expired grant cannot unlock because computeTrialStatus drops fullAccess).
  if (trial.fullAccess) return true;
  // The internal demo account showcases all features, so it bypasses the gate.
  if (trial.planTier === "demo" && !trial.expired) return true;
  // At or above Agency AND not expired. The `!expired` guard ensures a
  // time-boxed grant stops granting agency features once it passes.
  return !!trial.planTier && !trial.expired && (TIER_ORDER[trial.planTier] ?? 0) >= TIER_ORDER.agency;
}
export interface TrialStatus {
  /** True while the user is inside the 21-day trial window. */
  active: boolean;
  /** Whole days remaining in the trial (>= 0). */
  daysLeft: number;
  /** True when the trial window has passed and the user has not paid. */
  expired: boolean;
  /** ISO timestamp of when the trial ends, or null when not in trial. */
  endsAt: string | null;
  /** The user's plan_tier (starter/professional/agency/…), or null. */
  planTier: string | null;
  /**
   * True while a per-user full-access grant is active (a user with
   * access_expires_at still in the future and full_access=true). While true,
   * the user passes every plan-tier gate. Flipped back to false the moment the
   * grant expires, so an expired grant never keeps premium features unlocked.
   */
  fullAccess: boolean;
}
/**
 * Pure helper — computes trial state from the raw DB columns. Kept separate so
 * it can be unit-tested and reused by server functions and loaders.
 */
export function computeTrialStatus(
  trialStartedAt: string | Date | null | undefined,
  planTier: string | null | undefined,
  subscriptionStatus: string | null | undefined,
  accessExpiresAt?: string | Date | null | undefined,
  fullAccess?: boolean,
): TrialStatus {
  const tier = planTier ?? null;
  // Per-user time-boxed access grant. When access_expires_at is set it is the
  // single source of truth for access: it overrides BOTH the trial window and
  // any subscription status, so a grant can never be accidentally extended by
  // flipping subscription_status to 'active'. NULL => no effect (existing
  // behavior for every other user). Active while `now < access_expires_at`,
  // expired once `now >= access_expires_at` — the gate genuinely locks.
  if (accessExpiresAt) {
    const expires = new Date(accessExpiresAt).getTime();
    if (!Number.isNaN(expires)) {
      const now = Date.now();
      const ended = now >= expires;
      const daysLeft = Math.max(0, Math.ceil((expires - now) / DAY_MS));
      return {
        // A grant user is not "in trial" — active=false mirrors a paid account
        // (no misleading 21-day trial banner/callout), access is granted via
        // expired=false and fullAccess below.
        active: false,
        daysLeft,
        expired: ended,
        endsAt: new Date(expires).toISOString(),
        planTier: tier,
        // Honored only while the grant is still active. Once it expires the
        // user is expired (locked) AND fullAccess drops to false so an expired
        // grant cannot keep any premium PlanGate feature unlocked.
        fullAccess: !ended && !!fullAccess,
      };
    }
  }
  // No trial start date → never entered a trial (or already paid; checkout
  // clears trial_started_at). Not in trial, not expired.
  if (!trialStartedAt) {
    return { active: false, daysLeft: 0, expired: false, endsAt: null, planTier: tier, fullAccess: false };
  }
  // An active subscription always outranks trial state (defensive: checkout
  // normally clears trial_started_at, but never treat a paying customer as
  // expired/trial regardless of stored state).
  if (subscriptionStatus === "active") {
    return { active: false, daysLeft: 0, expired: false, endsAt: null, planTier: tier, fullAccess: false };
  }
  const started = new Date(trialStartedAt).getTime();
  if (Number.isNaN(started)) {
    return { active: false, daysLeft: 0, expired: false, endsAt: null, planTier: tier, fullAccess: false };
  }
  const endsAt = new Date(started + TRIAL_DAYS * DAY_MS);
  const msLeft = endsAt.getTime() - Date.now();
  const daysLeft = Math.max(0, Math.ceil(msLeft / DAY_MS));
  return {
    active: msLeft > 0,
    daysLeft,
    expired: msLeft <= 0,
    endsAt: endsAt.toISOString(),
    planTier: tier,
    fullAccess: false,
  };
}
/**
 * Server helper — loads a single user's trial columns by id and computes their
 * TrialStatus. Used by server API routes (e.g. /api/bids-save) whose auth user
 * object does not include plan_tier/full_access columns.
 */
export async function loadUserTrialStatus(userId: number): Promise<TrialStatus> {
  const rows = await sql()`SELECT plan_tier, trial_started_at, subscription_status, access_expires_at, full_access FROM users WHERE id = ${userId}`;
  const r = rows[0] as { plan_tier?: string | null; trial_started_at?: string | Date | null; subscription_status?: string | null; access_expires_at?: string | Date | null; full_access?: boolean } | undefined;
  return computeTrialStatus(r?.trial_started_at, r?.plan_tier, r?.subscription_status, r?.access_expires_at, r?.full_access);
}
/**
 * Returns the current user's trial status, or an empty status when logged out.
 * Recognizes trials by `trial_started_at` — NOT by plan_tier — so paid-plan
 * signups (starter/professional/agency) see the 21-day trial countdown, while
 * free Basic users (trial_started_at NULL) are never in trial and never expire.
 */
export const checkTrial = createServerFn({ method: "GET" }).handler(async (): Promise<TrialStatus> => {
  const user = await getCurrentUser();
  if (!user) return { active: false, daysLeft: 0, expired: false, endsAt: null, planTier: null, fullAccess: false };
  return loadUserTrialStatus(user.id);
});

/**
 * LAZY TRIAL START (owner requirement).
 *
 * The 21-day trial is an explicit PROFESSIONAL trial. The clock does NOT begin
 * at account signup — it begins on the user's FIRST use of a premium feature.
 * Until they touch a premium feature they are effectively free Basic and the
 * clock is not running.
 *
 * This helper sets `trial_started_at = COALESCE(trial_started_at, NOW())` and
 * flips `plan_tier = 'professional'` on first premium use (for a non-paying
 * user who hasn't started yet), then returns the (now-)active trial start time.
 *
 * Why `plan_tier = 'professional'`: during the active trial the user must pass
 * the Professional-tier gates (hasProfessionalAccess / PlanGate) while the
 * Red-Team Agency features must NOT unlock (professional < agency on the
 * ladder). Setting plan_tier='professional' achieves exactly that — the gates
 * already require `!expired`, so when the 21 days pass the same plan_tier
 * stops granting premium (downgrade to Basic) with NO deletion of saved work.
 *
 * Reentrancy / semantics:
 *  - Already set (or already paid) → no-op; returns the existing start.
 *  - Paid user (subscription_status = 'active') → never starts a trial.
 *  - A user who already consumed their trial and expired is NOT restarted
 *    (COALESCE keeps the old timestamp → still expired).
 *
 * Call this at the START of each premium action (generate executive brief,
 * score, proposal draft, incumbent reveal). Fail-open: a DB blip never blocks
 * the premium action.
 *
 * @returns ISO timestamp of the trial start, or null when no trial applies.
 */
export async function ensureTrialStarted(userId: number): Promise<string | null> {
  try {
    const rows = (await sql()`
      SELECT plan_tier, subscription_status, trial_started_at
      FROM users WHERE id = ${userId}
    `) as Array<{
      plan_tier?: string | null;
      subscription_status?: string | null;
      trial_started_at?: string | Date | null;
    }>;
    const r = rows[0];
    if (!r) return null;
    // A paying (active-subscription) user has no trial to start.
    if (r.subscription_status === "active") return null;
    // Demo / admin internal accounts should not lazily start trials.
    if (r.plan_tier === "demo") return null;
    // If the trial already started, reuse it (expired stays expired).
    if (r.trial_started_at) return new Date(r.trial_started_at).toISOString();
    const updated = (await sql()`
      UPDATE users
      SET trial_started_at = NOW(), plan_tier = 'professional'
      WHERE id = ${userId} AND trial_started_at IS NULL
        AND COALESCE(subscription_status, '') <> 'active'
      RETURNING trial_started_at
    `) as Array<{ trial_started_at: Date }>;
    return updated.length ? new Date(updated[0].trial_started_at).toISOString() : null;
  } catch (e) {
    // Fail-open: never block a premium action because the trial-start write failed.
    console.error("[trial] ensureTrialStarted failed (fail-open):", e);
    return null;
  }
}
