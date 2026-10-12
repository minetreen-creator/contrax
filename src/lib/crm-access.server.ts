/**
 * CRM ACCESS — the CRM tier reader (owner handoff 2026-10-10, CRM phase 1 of 3).
 *
 * The owner's spec, reconciled with the house entitlement model. The CRM has
 * exactly three tiers and NO new notion of "entitled" is invented here — this
 * module reads the SAME state every other gate reads:
 *
 *   internal  → professional. An admin account (`user.is_admin`, the same flag
 *               src/lib/plan-gates.server.ts checks first), an ACTIVE full-access
 *               grant (`trial.fullAccess`), or the internal demo tier while it is
 *               not expired. Exactly the internal bypass set of
 *               `hasProfessionalAccess` / `hasBidScoutAccess`.
 *   entitled  → the user is not expired AND (their subscription_status is
 *               'active' OR they are inside the 7-day trial window). This is the
 *               owner's literal predicate: `!expired && (subscription_status ===
 *               'active' || trial.active)`.
 *   tier      → internal ? professional
 *               : entitled && planTier professional|agency → professional
 *               : entitled && planTier starter            → starter
 *               : basic
 *
 * WHY `entitled` MATTERS (the pin): a stored `plan_tier` ALONE never grants
 * anything. A user who picked "Starter" at signup but never started the (lazy)
 * trial and never paid is `basic` — the owner's "selecting a plan alone does not
 * grant" rule, which is also how the existing gates behave (they require
 * `!expired` plus either a paid state or a live tier).
 *
 * PRODUCT-POLICY NOTE (flagged to the lead in the PR, NOT changed here): the
 * owner's spec maps an active full-access grant and the internal demo tier to
 * PROFESSIONAL CRM (1000 contacts, relationship history, reminders, AI drafts).
 * That matches how `plan-gates.server.ts` treats those two states for the existing
 * gates (they bypass every tier), so this module is consistent with current
 * policy — but it means verifying a nonprofit (Nonprofit Free) or flipping the
 * demo account unlocks the full CRM. That is a product decision for the owner, not
 * a reconciliation we are allowed to make unilaterally.
 *
 * FAIL-CLOSED is deliberately NOT added at this layer: unlike the boolean gates,
 * a read failure here must not silently demote a paying user, so the DB errors
 * propagate and /api/crm maps them to 500 ("CRM unavailable" / "Could not save CRM
 * data"). The route never treats an unreadable entitlement as entitled.
 *
 * SERVER-ONLY (imports ~/db). The caller is /api/crm.
 */
import { sql } from "~/db";
import { loadUserTrialStatus, type TrialStatus } from "~/lib/trial";

/** The three CRM tiers, lowest first. */
export type CrmTier = "basic" | "starter" | "professional";

/** What the route may do for this user, and the per-tier limits. */
export interface CrmAccess {
  tier: CrmTier;
  /** Create / edit / archive contacts, and log activities. */
  canEdit: boolean;
  /** Read the activity history of a contact (Professional only). */
  relationshipHistory: boolean;
  /** Reminder scheduling (Professional only; the worker is phase 2). */
  reminders: boolean;
  /** AI-assisted follow-up drafts (Professional only; the endpoint is phase 3). */
  aiDrafts: boolean;
  /** Maximum number of non-archived contacts a Basic/Starter user may hold. */
  contactLimit: number;
}

/**
 * Storage seams — both entitlement reads go through an injectable store so the
 * access LOGIC is unit-tested with literal state and no database. This mirrors
 * src/lib/plan-gates.server.ts's `GateStores` and exists for the same reason: no
 * `mock.module` (bun's mock registry is process-global and leaks across test files
 * in one run). Production always uses the Neon-backed default below.
 */
export interface CrmAccessDeps {
  /** The user's stored trial/tier row, exactly as src/lib/trial.ts reads it. */
  loadTrial(userId: number): Promise<TrialStatus>;
  /** The user's `users.subscription_status`, or null when unset/absent. */
  loadSubscriptionStatus(userId: number): Promise<string | null>;
}

export const neonCrmAccessDeps: CrmAccessDeps = {
  async loadTrial(userId) {
    return loadUserTrialStatus(userId);
  },
  async loadSubscriptionStatus(userId) {
    const rows = (await sql()`
      SELECT subscription_status FROM users WHERE id = ${userId}
    `) as Array<{ subscription_status: string | null }>;
    return rows[0]?.subscription_status ?? null;
  },
};

/**
 * PURE tier computation — split from the DB read exactly the way
 * `computeTrialStatus` is split from `loadUserTrialStatus`, so the whole matrix
 * is unit-tested without a database or a network.
 *
 * `trial` is the already-computed TrialStatus: `expired` is the single gate that
 * decides whether a stored tier is still live (`computeTrialStatus` already drops
 * `fullAccess` and sets `expired` for a lapsed grant, so an expired grant cannot
 * unlock CRM here either).
 */
export function computeCrmAccess(
  trial: Pick<TrialStatus, "active" | "expired" | "planTier" | "fullAccess">,
  subscriptionStatus: string | null | undefined,
  user?: { is_admin?: boolean } | null,
): CrmAccess {
  const internal =
    user?.is_admin === true ||
    trial.fullAccess ||
    (trial.planTier === "demo" && !trial.expired);
  const entitled =
    !trial.expired && (subscriptionStatus === "active" || trial.active);
  const tier: CrmTier = internal
    ? "professional"
    : entitled && ["professional", "agency"].includes(trial.planTier ?? "")
      ? "professional"
      : entitled && trial.planTier === "starter"
        ? "starter"
        : "basic";
  return {
    tier,
    canEdit: tier !== "basic",
    relationshipHistory: tier === "professional",
    reminders: tier === "professional",
    aiDrafts: tier === "professional",
    contactLimit: tier === "professional" ? 1000 : tier === "starter" ? 100 : 0,
  };
}

/**
 * The CRM access for one user. `user` is the AuthUser shape (it carries
 * `is_admin` — see `getUserFromRequest` in src/lib/api-auth.ts), so the admin
 * bypass works off the session row without a second users read.
 *
 * `deps` is the test seam; production callers pass only `user`.
 */
export async function getCrmAccess(
  user: { id: number; is_admin?: boolean },
  deps: CrmAccessDeps = neonCrmAccessDeps,
): Promise<CrmAccess> {
  const trial = await deps.loadTrial(user.id);
  const subscriptionStatus = await deps.loadSubscriptionStatus(user.id);
  return computeCrmAccess(trial, subscriptionStatus, user);
}
