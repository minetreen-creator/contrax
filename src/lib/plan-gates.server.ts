/**
 * PLAN GATES — server-side entitlement readers (owner gating map, 2026-09-26).
 *
 * The house entitlement template is the incumbent-reveal Pro gate
 * (src/routes/awards.tsx → hasProfessionalAccess in src/lib/trial.ts). Both
 * readers here reuse it rather than inventing a second notion of "entitled":
 *
 *   Radar Pro ($79/mo) — exactly `hasProfessionalAccess`, i.e. an admin/demo
 *     account, an ACTIVE full-access grant, or a stored plan_tier at/above
 *     `professional` that has not expired. This is the SAME predicate the
 *     incumbent gate uses, so the two Pro surfaces can never disagree.
 *
 *   Bid Scout ($99/mo) — a separate product with its own subscription table
 *     (bid_scout_subscriptions, written ONLY by the verified Stripe webhook).
 *     Entitlement = an `active` row for this user, plus the same internal
 *     bypasses (admin / demo / active grant) so internal accounts can exercise
 *     every surface.
 *
 * FAIL-CLOSED, like every other gate in this codebase (getTierBilling,
 * isUpgradePromptEnabled): an unreadable entitlement is treated as NOT entitled.
 * A gate that failed open would hand a paid feature to everyone during a DB
 * blip, which is worse than the rare opposite.
 *
 * SERVER-ONLY (imports ~/db). The client-safe constants/copy live in
 * src/lib/plan-gates.ts.
 */
import { sql } from "~/db";
import { hasProfessionalAccess, loadUserTrialStatus, type TrialStatus } from "~/lib/trial";

/** Minimal shape of the caller we need (AuthUser satisfies it structurally). */
export interface GateUser {
  id: number;
  is_admin?: boolean;
}

/**
 * True when the user holds Radar Pro (Professional+) access. Mirrors the
 * incumbent-reveal gate exactly: admin bypass first, then the shared
 * hasProfessionalAccess predicate over the user's stored trial/tier state.
 *
 * NOTE (owner decision 1, hard Pro gate): the lazy 14-day Professional trial is
 * NOT started here. A gated attempt therefore never silently upgrades a free
 * account into trial access — the user gets the Pro prompt at the attempt.
 */
export async function hasRadarProAccess(
  userId: number | null | undefined,
  user?: { is_admin?: boolean } | null,
): Promise<boolean> {
  if (user?.is_admin) return true;
  if (userId == null) return false;
  try {
    return hasProfessionalAccess(await loadUserTrialStatus(userId), user);
  } catch (err) {
    console.error(
      "[plan-gates] Radar Pro entitlement lookup failed (treated as not entitled):",
      (err as Error).message,
    );
    return false;
  }
}

/** Storage seam so the entitlement logic is unit-testable without a database. */
export interface BidScoutEntitlementStore {
  /** True when the user has an `active` Bid Scout subscription row. */
  hasActiveSubscription(userId: number): Promise<boolean>;
}

export const neonBidScoutStore: BidScoutEntitlementStore = {
  async hasActiveSubscription(userId) {
    const rows = (await sql()`
      SELECT 1 FROM bid_scout_subscriptions
      WHERE user_id = ${userId} AND status = 'active'
      LIMIT 1
    `) as Array<{ "?column?": number }>;
    return rows.length > 0;
  },
};

/**
 * True when the user may use the Bid Scout product line (drafting + export).
 *
 * Internal bypasses mirror hasProfessionalAccess: an admin account, the demo
 * tier, or an ACTIVE full-access grant. A paying Bid Scout customer always has
 * an `active` row (the verified webhook is the only writer), so they always
 * qualify. Everything else (signup, expired) → false → the attempt is gated.
 */
export async function hasBidScoutAccess(
  userId: number | null | undefined,
  user?: { is_admin?: boolean } | null,
  store: BidScoutEntitlementStore = neonBidScoutStore,
): Promise<boolean> {
  if (user?.is_admin) return true;
  if (userId == null) return false;
  try {
    const trial: TrialStatus = await loadUserTrialStatus(userId);
    if (trial.fullAccess) return true;
    if (trial.planTier === "demo" && !trial.expired) return true;
    return await store.hasActiveSubscription(userId);
  } catch (err) {
    console.error(
      "[plan-gates] Bid Scout entitlement lookup failed (treated as not entitled):",
      (err as Error).message,
    );
    return false;
  }
}

/** Both entitlements in ONE read — what the client-facing gate context needs. */
export interface GateEntitlements {
  radarPro: boolean;
  bidScout: boolean;
}

export async function loadGateEntitlements(
  userId: number | null | undefined,
  user?: { id: number; is_admin?: boolean } | null,
  deps: { bidScoutStore?: BidScoutEntitlementStore } = {},
): Promise<GateEntitlements> {
  if (userId == null) return { radarPro: false, bidScout: false };
  const [radarPro, bidScout] = await Promise.all([
    hasRadarProAccess(userId, user ?? undefined),
    hasBidScoutAccess(userId, user ?? undefined, deps.bidScoutStore ?? neonBidScoutStore),
  ]);
  return { radarPro, bidScout };
}
