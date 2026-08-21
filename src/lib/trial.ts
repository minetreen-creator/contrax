/**
 * Trial tracking helpers for Contrax.
 *
 * Trial lifecycle: a user signs up with `trial_started_at = NOW()` and a
 * `plan_tier` matching the plan they selected (starter/professional/agency).
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
 * Returns the current user's trial status, or an empty status when logged out.
 * Recognizes trials by `trial_started_at` — NOT by plan_tier — so every new
 * signup (which sets plan_tier to starter/professional/agency) sees the
 * 21-day trial countdown instead of being treated as fully paid.
 */
export const checkTrial = createServerFn({ method: "GET" }).handler(async (): Promise<TrialStatus> => {
  const user = await getCurrentUser();
  if (!user) return { active: false, daysLeft: 0, expired: false, endsAt: null, planTier: null, fullAccess: false };
  const rows = await sql()`SELECT plan_tier, trial_started_at, subscription_status, access_expires_at, full_access FROM users WHERE id = ${user.id}`;
  const r = rows[0] as { plan_tier?: string | null; trial_started_at?: string | Date | null; subscription_status?: string | null; access_expires_at?: string | Date | null; full_access?: boolean } | undefined;
  return computeTrialStatus(r?.trial_started_at, r?.plan_tier, r?.subscription_status, r?.access_expires_at, r?.full_access);
});
