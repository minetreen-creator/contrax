/**
 * Client workspaces (Agency tier phase 1, owner decision 2026-10-20) — the POLICY
 * matrix, with no database and no network.
 *
 * Trial states are produced with the REAL `computeTrialStatus`, so these tests pin the
 * interaction with the shipped trial/entitlement model (the same approach as
 * src/lib/crm-access.test.ts) rather than a hand-written stub of it.
 *
 * What is pinned here:
 *   1. NON-AGENCY CANNOT CREATE — Basic, Starter and Professional are all refused,
 *      whether they are in a live trial or paying, and a stored `plan_tier` alone
 *      never grants (the owner's "selecting a plan does not grant" rule).
 *   2. AGENCY CAN CREATE, at the hard cap of 10 — and the cap arithmetic refuses the
 *      11th, including when asked with a nonsense count.
 *   3. inputs are validated honestly (a bad state code fails the whole request rather
 *      than being silently dropped).
 *   4. the SQL scope fragment never widens (null → unscoped account context only) and
 *      an unusable id throws instead of reading everything.
 */
import { describe, expect, test } from "bun:test";
import {
  WORKSPACE_LIMIT,
  WORKSPACE_NAME_MAX,
  WORKSPACE_STATES_MAX,
  WORKSPACE_TRADES_MAX,
  canAddWorkspace,
  validateWorkspaceName,
  validateWorkspaceStates,
  validateWorkspaceTrades,
  workspaceScopeClause,
} from "./workspaces";
import { computeWorkspaceAccess } from "./workspaces.server";
import { computeTrialStatus } from "./trial";

const DAY_MS = 24 * 60 * 60 * 1000;
function startedDaysAgo(days: number): string {
  return new Date(Date.now() - days * DAY_MS).toISOString();
}
/** A live trial on `planTier` (started yesterday). */
function activeTrial(planTier: string) {
  return computeTrialStatus(startedDaysAgo(1), planTier, null);
}
/** An EXPIRED time-boxed access grant (expires_at is a day in the past). */
function expiredTrial(planTier: string) {
  return computeTrialStatus(startedDaysAgo(40), planTier, null, startedDaysAgo(1));
}
/** Never trialled (free Basic, or a checkout that cleared the trial). */
function noTrial(planTier: string) {
  return computeTrialStatus(null, planTier, null);
}

describe("computeWorkspaceAccess — who may create client workspaces", () => {
  test("PAID TIERS BELOW AGENCY CANNOT: basic / starter / professional, in trial or paying", () => {
    for (const planTier of ["basic", "starter", "professional"]) {
      for (const [label, trial, status] of [
        ["live trial", activeTrial(planTier), null],
        ["active subscription", noTrial(planTier), "active"],
        ["nothing", noTrial(planTier), null],
      ] as const) {
        const access = computeWorkspaceAccess(trial, status);
        expect({ planTier, label, canCreate: access.canCreate }).toEqual({
          planTier,
          label,
          canCreate: false,
        });
        expect(access.limit).toBe(0);
      }
    }
  });

  test("PLAN ALONE DOES NOT GRANT: an agency plan_tier with no payment and no trial → refused", () => {
    const access = computeWorkspaceAccess(noTrial("agency"), null);
    expect(access.canCreate).toBe(false);
    expect(access.limit).toBe(0);
    // …nor does a non-active subscription status (past_due / canceled / unpaid).
    for (const status of ["past_due", "canceled", "unpaid", "incomplete", ""]) {
      expect(computeWorkspaceAccess(noTrial("agency"), status).canCreate).toBe(false);
    }
  });

  test("an EXPIRED access grant cannot create", () => {
    const access = computeWorkspaceAccess(expiredTrial("agency"), null);
    expect(access.canCreate).toBe(false);
    expect(access.limit).toBe(0);
  });

  test("AGENCY in a live trial → can create, capped at 10", () => {
    const access = computeWorkspaceAccess(activeTrial("agency"), null);
    expect(access.canCreate).toBe(true);
    expect(access.limit).toBe(WORKSPACE_LIMIT);
    expect(WORKSPACE_LIMIT).toBe(10);
  });

  test("AGENCY with an active subscription (no trial) → can create", () => {
    const access = computeWorkspaceAccess(noTrial("agency"), "active");
    expect(access.canCreate).toBe(true);
    expect(access.limit).toBe(10);
  });

  test("the internal bypass set keeps working (admin, full-access grant, live demo)", () => {
    expect(computeWorkspaceAccess(noTrial("professional"), null, { is_admin: true }).canCreate).toBe(true);
    const grant = { ...noTrial("basic"), fullAccess: true };
    expect(computeWorkspaceAccess(grant, null).canCreate).toBe(true);
    expect(computeWorkspaceAccess(noTrial("demo"), null).canCreate).toBe(true);
    // …but an EXPIRED grant is dropped by computeTrialStatus, so it cannot slip through.
    expect(computeWorkspaceAccess(expiredTrial("basic"), null).canCreate).toBe(false);
  });
});

describe("canAddWorkspace — the hard cap of 10", () => {
  const agency = computeWorkspaceAccess(activeTrial("agency"), null);

  test("allows the 1st..10th and refuses the 11th", () => {
    for (let existing = 0; existing < 10; existing += 1) {
      expect({ existing, allowed: canAddWorkspace(existing, agency) }).toEqual({
        existing,
        allowed: true,
      });
    }
    expect(canAddWorkspace(10, agency)).toBe(false);
    expect(canAddWorkspace(11, agency)).toBe(false);
  });

  test("a caller without entitlement can never add, whatever the count", () => {
    const professional = computeWorkspaceAccess(activeTrial("professional"), null);
    expect(canAddWorkspace(0, professional)).toBe(false);
    expect(canAddWorkspace(0, { canCreate: false, limit: 10 })).toBe(false);
  });

  test("a nonsense count is refused, never treated as empty", () => {
    for (const count of [-1, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(canAddWorkspace(count, agency)).toBe(false);
    }
  });

  test("a grant larger than the hard cap cannot raise it", () => {
    expect(canAddWorkspace(10, { canCreate: true, limit: 999 })).toBe(false);
    expect(canAddWorkspace(9, { canCreate: true, limit: 999 })).toBe(true);
  });
});

describe("input validation", () => {
  test("names: trimmed, bounded, never blank", () => {
    expect(validateWorkspaceName("  Acme Janitorial  ")).toBe("Acme Janitorial");
    expect(validateWorkspaceName("")).toBeNull();
    expect(validateWorkspaceName("   ")).toBeNull();
    expect(validateWorkspaceName("x".repeat(WORKSPACE_NAME_MAX + 1))).toBeNull();
    expect(validateWorkspaceName("x".repeat(WORKSPACE_NAME_MAX))).toBe("x".repeat(WORKSPACE_NAME_MAX));
    expect(validateWorkspaceName(42)).toBeNull();
  });

  test("states: upper-cased two-letter codes, de-duplicated, no silent dropping", () => {
    expect(validateWorkspaceStates(["va", "MD", "VA"])).toEqual(["VA", "MD"]);
    expect(validateWorkspaceStates([])).toEqual([]);
    // One unusable code fails the whole list — dropping it would make the workspace
    // look like it simply does not cover that state.
    expect(validateWorkspaceStates(["VA", "Virginia"])).toBeNull();
    expect(validateWorkspaceStates(["V"])).toBeNull();
    expect(validateWorkspaceStates("VA")).toBeNull();
    expect(validateWorkspaceStates(["VA", 7])).toBeNull();
    const tooMany = Array.from({ length: WORKSPACE_STATES_MAX + 1 }, (_, i) =>
      String.fromCharCode(65 + (i % 26)) + String.fromCharCode(65 + (i % 24)),
    );
    expect(validateWorkspaceStates(tooMany)).toBeNull();
  });

  test("trades: trimmed labels, de-duplicated, bounded", () => {
    expect(validateWorkspaceTrades(["  Janitorial ", "HVAC", "Janitorial"])).toEqual([
      "Janitorial",
      "HVAC",
    ]);
    expect(validateWorkspaceTrades(["   "])).toBeNull();
    expect(validateWorkspaceTrades([""])).toBeNull();
    expect(validateWorkspaceTrades([5])).toBeNull();
    const tooMany = Array.from({ length: WORKSPACE_TRADES_MAX + 1 }, (_, i) => `Trade ${i}`);
    expect(validateWorkspaceTrades(tooMany)).toBeNull();
  });
});

describe("workspaceScopeClause — the read scope fragment", () => {
  test("null (an account with no active client) scopes to its own unscoped rows", () => {
    expect(workspaceScopeClause(null)).toBe("workspace_id IS NULL");
  });

  test("a real workspace scopes to that workspace only", () => {
    expect(workspaceScopeClause(7)).toBe("workspace_id = 7");
  });

  test("a joined query can qualify the column (saved_matches ⋈ crm_contacts)", () => {
    expect(workspaceScopeClause(7, "sm")).toBe("sm.workspace_id = 7");
    expect(workspaceScopeClause(null, "sm")).toBe("sm.workspace_id IS NULL");
  });

  test("an unusable id or qualifier THROWS instead of widening the read", () => {
    for (const bad of [0, -3, Number.NaN, 1.5]) {
      expect(() => workspaceScopeClause(bad)).toThrow();
    }
    expect(() => workspaceScopeClause(1, "sm; DROP TABLE saved_matches")).toThrow();
  });
});
