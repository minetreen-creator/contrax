/**
 * CRM ACCESS — the tier matrix (owner handoff 2026-10-10, CRM phase 1 of 3).
 *
 * This suite pins src/lib/crm-access.server.ts. It is DETERMINISTIC, ZERO NETWORK
 * and ZERO DATABASE: `computeCrmAccess` is the pure half (the same split
 * `computeTrialStatus` / `loadUserTrialStatus` uses in src/lib/trial.ts), and the
 * async `getCrmAccess` is driven through its injectable `CrmAccessDeps` with
 * literal state. Nothing here reads the live `users` table and nothing uses
 * `mock.module` (bun's mock registry is process-global and leaks across test files
 * in one run — see src/lib/plan-gates.test.ts).
 *
 * Real trial states are produced with the REAL `computeTrialStatus`, so these
 * tests also pin the interaction with the house trial model rather than a
 * hand-written stub of it.
 */
import { describe, expect, test } from "bun:test";
import {
  AGENCY_CONTACT_LIMIT,
  computeCrmAccess,
  getCrmAccess,
  type CrmAccessDeps,
  type CrmTier,
} from "./crm-access.server";
import { computeTrialStatus, type TrialStatus } from "./trial";

const DAY_MS = 24 * 60 * 60 * 1000;
/** A trial that started `days` ago (negative = in the future, never used here). */
function startedDaysAgo(days: number): string {
  return new Date(Date.now() - days * DAY_MS).toISOString();
}
/** An active trial row (started yesterday, 13 days left). */
function activeTrial(planTier: string): TrialStatus {
  return computeTrialStatus(startedDaysAgo(1), planTier, null);
}
/** A trial whose 14 days ran out 16 days ago. */
function expiredTrial(planTier: string): TrialStatus {
  return computeTrialStatus(startedDaysAgo(30), planTier, null);
}
/** A user who never entered a trial (free Basic, or a paid signup after checkout). */
function noTrial(planTier: string): TrialStatus {
  return computeTrialStatus(null, planTier, null);
}
const TIERS: CrmTier[] = ["basic", "starter", "professional"];

describe("computeCrmAccess — the tier ladder", () => {
  test("no entitlement at all → basic: cannot edit, zero contacts", () => {
    // plan_tier 'basic', never trialled, never paid.
    const access = computeCrmAccess(noTrial("basic"), null);
    expect(access.tier).toBe("basic");
    expect(access.canEdit).toBe(false);
    expect(access.relationshipHistory).toBe(false);
    expect(access.reminders).toBe(false);
    expect(access.aiDrafts).toBe(false);
    expect(access.contactLimit).toBe(0);
  });

  test("an expired trial → basic, even with a paid-tier plan_tier stored", () => {
    const access = computeCrmAccess(expiredTrial("professional"), null);
    expect(access.tier).toBe("basic");
    expect(access.canEdit).toBe(false);
    expect(access.contactLimit).toBe(0);
  });

  test("PLAN ALONE DOES NOT GRANT: a stored plan_tier with no trial and no payment → basic", () => {
    // The owner's "selecting a plan alone does not grant" pin. Every paid tier
    // name is checked, because a checkout that was abandoned leaves plan_tier set
    // while trial_started_at stays NULL and subscription_status stays unset.
    for (const planTier of ["starter", "professional", "agency"]) {
      const access = computeCrmAccess(noTrial(planTier), null);
      expect(access.tier).toBe("basic");
      expect(access.canEdit).toBe(false);
      expect(access.contactLimit).toBe(0);
    }
  });

  test("a live starter trial → starter: editable, 100 contacts, no professional features", () => {
    const access = computeCrmAccess(activeTrial("starter"), null);
    expect(access.tier).toBe("starter");
    expect(access.canEdit).toBe(true);
    expect(access.contactLimit).toBe(100);
    expect(access.relationshipHistory).toBe(false);
    expect(access.reminders).toBe(false);
    expect(access.aiDrafts).toBe(false);
  });

  test("a live professional trial → professional: 1000 contacts + history/reminders/drafts", () => {
    const access = computeCrmAccess(activeTrial("professional"), null);
    expect(access.tier).toBe("professional");
    expect(access.canEdit).toBe(true);
    expect(access.contactLimit).toBe(1000);
    expect(access.relationshipHistory).toBe(true);
    expect(access.reminders).toBe(true);
    expect(access.aiDrafts).toBe(true);
  });

  test("a live agency trial → professional FEATURES with the raised 2500 contact cap", () => {
    // Owner decision 2026-10-20 (Agency multi-client workspaces): the Agency plan keeps
    // every Professional CRM feature and raises the contact cap from 1000 to 2500. It is
    // still the "professional" TIER — nothing about what Agency can DO changes, only the
    // cap it is held to.
    const access = computeCrmAccess(activeTrial("agency"), null);
    expect(access.tier).toBe("professional");
    expect(access.contactLimit).toBe(2500);
    expect(access.contactLimit).toBe(AGENCY_CONTACT_LIMIT);
    expect(access.relationshipHistory).toBe(true);
  });

  test("Agency 2500 vs Professional 1000 vs Starter 100 — the caps move ONLY for Agency", () => {
    expect(computeCrmAccess(activeTrial("agency"), null).contactLimit).toBe(2500);
    expect(computeCrmAccess(activeTrial("professional"), null).contactLimit).toBe(1000);
    expect(computeCrmAccess(activeTrial("starter"), null).contactLimit).toBe(100);
    // A paid Agency subscription (no trial) takes the same cap, and a downgrade to
    // Starter drops it back to 100 — the SIZE changes, the account's data never does.
    expect(computeCrmAccess(noTrial("agency"), "active").contactLimit).toBe(2500);
    expect(computeCrmAccess(noTrial("starter"), "active").contactLimit).toBe(100);
    // The internal bypass is NOT an Agency customer: it keeps Professional's 1000.
    expect(computeCrmAccess(noTrial("professional"), null, { is_admin: true }).contactLimit).toBe(1000);
  });

  test("an ACTIVE subscription entitles without a trial (checkout cleared trial_started_at)", () => {
    const professional = computeCrmAccess(noTrial("professional"), "active");
    expect(professional.tier).toBe("professional");
    expect(professional.contactLimit).toBe(1000);
    const starter = computeCrmAccess(noTrial("starter"), "active");
    expect(starter.tier).toBe("starter");
    expect(starter.contactLimit).toBe(100);
  });

  test("a non-active subscription status does NOT entitle (past_due / canceled / unset)", () => {
    for (const status of ["past_due", "canceled", "unpaid", "incomplete", "", null, undefined]) {
      const access = computeCrmAccess(noTrial("professional"), status);
      expect(access.tier).toBe("basic");
      expect(access.canEdit).toBe(false);
    }
  });

  test("the 14-day trial is what entitles: expired=false outranks a paid plan_tier on its own", () => {
    // Same stored plan_tier, three trial states → three different tiers. This is
    // the whole point of reading trial state instead of plan_tier.
    expect(computeCrmAccess(activeTrial("professional"), null).tier).toBe("professional");
    expect(computeCrmAccess(expiredTrial("professional"), null).tier).toBe("basic");
    expect(computeCrmAccess(noTrial("professional"), null).tier).toBe("basic");
  });

  test("every tier name in the ladder is handled, and only professional gets the extras", () => {
    const seen = new Set<CrmTier>();
    seen.add(computeCrmAccess(activeTrial("starter"), null).tier);
    seen.add(computeCrmAccess(activeTrial("professional"), null).tier);
    seen.add(computeCrmAccess(activeTrial("basic"), null).tier);
    expect([...seen].sort()).toEqual(["basic", "professional", "starter"]);
    for (const tier of TIERS) {
      const access = computeCrmAccess(
        { active: true, expired: false, planTier: tier, fullAccess: false },
        null,
      );
      expect(access.relationshipHistory).toBe(tier === "professional");
      expect(access.reminders).toBe(tier === "professional");
      expect(access.aiDrafts).toBe(tier === "professional");
      expect(access.canEdit).toBe(tier !== "basic");
    }
  });
});

describe("computeCrmAccess — internal bypasses", () => {
  test("an admin account is professional regardless of stored billing state", () => {
    const access = computeCrmAccess(noTrial("basic"), null, { is_admin: true });
    expect(access.tier).toBe("professional");
    expect(access.contactLimit).toBe(1000);
    expect(access.aiDrafts).toBe(true);
  });

  test("an admin account is professional even after an expired trial", () => {
    const access = computeCrmAccess(expiredTrial("starter"), null, { is_admin: true });
    expect(access.tier).toBe("professional");
  });

  test("an ACTIVE full-access grant is professional (verified nonprofit / internal grant)", () => {
    // Derived through the REAL trial model: access_expires_at in the future.
    const granted = computeTrialStatus(
      null,
      "professional",
      null,
      new Date(Date.now() + 30 * DAY_MS).toISOString(),
      true,
    );
    expect(granted.fullAccess).toBe(true);
    expect(granted.expired).toBe(false);
    const access = computeCrmAccess(granted, null);
    expect(access.tier).toBe("professional");
    expect(access.contactLimit).toBe(1000);
  });

  test("a LAPSED full-access grant does NOT unlock the CRM (the grant genuinely locks)", () => {
    const lapsed = computeTrialStatus(
      null,
      "professional",
      null,
      new Date(Date.now() - DAY_MS).toISOString(),
      true,
    );
    expect(lapsed.fullAccess).toBe(false);
    expect(lapsed.expired).toBe(true);
    const access = computeCrmAccess(lapsed, null);
    expect(access.tier).toBe("basic");
    expect(access.canEdit).toBe(false);
  });

  test("the internal demo tier is professional while it is not expired", () => {
    const access = computeCrmAccess(noTrial("demo"), null);
    expect(access.tier).toBe("professional");
    expect(access.contactLimit).toBe(1000);
  });

  test("an EXPIRED demo tier is not provisioned (demo is internal only while live)", () => {
    const access = computeCrmAccess(expiredTrial("demo"), null, null);
    expect(access.tier).toBe("basic");
  });

  test("PRODUCT-POLICY PIN: an expired trial outranks an 'active' subscription in the literal spec", () => {
    // The owner's predicate is `!expired && (subscription_status === 'active' ||
    // trial.active)`, so `expired` wins. NOTE: this state is NOT reachable through
    // the real read path — computeTrialStatus returns expired=false whenever
    // subscription_status is 'active' (an active subscription always outranks
    // trial state). This test documents the spec's precedence; it does not claim
    // the DB can produce the combination.
    const access = computeCrmAccess(
      { active: false, expired: true, planTier: "professional", fullAccess: false },
      "active",
    );
    expect(access.tier).toBe("basic");
  });
});

describe("getCrmAccess — the DB seam", () => {
  function deps(trial: TrialStatus, status: string | null): CrmAccessDeps {
    return {
      async loadTrial() {
        return trial;
      },
      async loadSubscriptionStatus() {
        return status;
      },
    };
  }

  test("reads the user's stored trial + subscription through the injected stores", async () => {
    const access = await getCrmAccess({ id: 42 }, deps(activeTrial("starter"), null));
    expect(access.tier).toBe("starter");
    expect(access.contactLimit).toBe(100);
  });

  test("an admin caller needs no readable billing row at all", async () => {
    const access = await getCrmAccess({ id: 7, is_admin: true }, deps(noTrial("basic"), null));
    expect(access.tier).toBe("professional");
  });

  test("the paid-active path flows through the subscription read, not the trial", async () => {
    const access = await getCrmAccess({ id: 8 }, deps(noTrial("agency"), "active"));
    expect(access.tier).toBe("professional");
    // An agency account paying with no trial is still an AGENCY plan → 2500
    // (owner decision 2026-10-20); a professional plan on the same path stays 1000.
    expect(access.contactLimit).toBe(2500);
    expect((await getCrmAccess({ id: 8 }, deps(noTrial("professional"), "active"))).contactLimit).toBe(1000);
  });
});
