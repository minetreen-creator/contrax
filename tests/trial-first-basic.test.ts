/**
 * Owner 2026-10-12: every account gets a 7-day Professional trial; when it runs
 * out unpaid the account drops to free Basic (search only) instead of being
 * locked out, and the Basic weekly email no longer sends.
 */
import { describe, expect, test } from "bun:test";
import { computeTrialStatus, hasProfessionalAccess, hasUnlimitedSaves, needsFirstTrial, TRIAL_DAYS } from "../src/lib/trial";
import { shouldShowTrialStartCard } from "../src/lib/trial-start-card";
import { WEEKLY_DIGEST_ENABLED } from "../src/lib/weekly-digest";

const DAY = 86_400_000;
const ago = (d: number) => new Date(Date.now() - d * DAY).toISOString();

describe("7-day trial, then Basic", () => {
  test("the trial is 7 days", () => {
    expect(TRIAL_DAYS).toBe(7);
  });

  test("inside the trial: Professional access", () => {
    const s = computeTrialStatus(ago(2), "professional", null);
    expect(s.active).toBe(true);
    expect(s.daysLeft).toBe(5);
    expect(hasProfessionalAccess(s)).toBe(true);
    expect(hasUnlimitedSaves(s)).toBe(true);
  });

  test("after the trial: free Basic — not locked, no premium, no unlimited saves", () => {
    const s = computeTrialStatus(ago(8), "professional", null);
    expect(s).toMatchObject({ active: false, expired: false, planTier: "basic", trialEnded: true });
    expect(hasProfessionalAccess(s)).toBe(false);
    expect(hasUnlimitedSaves(s)).toBe(false);
    expect(shouldShowTrialStartCard(s).show).toBe(false);
  });

  test("a paying subscriber is never moved to Basic", () => {
    const s = computeTrialStatus(ago(30), "starter", "active");
    expect(s.planTier).toBe("starter");
    expect(s.trialEnded).toBeUndefined();
  });

  test("an expired access grant still locks (unchanged)", () => {
    expect(computeTrialStatus(null, "professional", null, ago(1), true).expired).toBe(true);
  });

  test("only never-trialed free accounts get a first trial", () => {
    expect(needsFirstTrial({ plan_tier: "basic", trial_started_at: null })).toBe(true);
    expect(needsFirstTrial({ plan_tier: null, trial_started_at: null })).toBe(true);
    expect(needsFirstTrial({ plan_tier: "professional", trial_started_at: ago(10) })).toBe(false); // already had one
    expect(needsFirstTrial({ plan_tier: "basic", trial_started_at: null, subscription_status: "active" })).toBe(false);
    expect(needsFirstTrial({ plan_tier: "basic", trial_started_at: null, access_expires_at: ago(-5) })).toBe(false);
    expect(needsFirstTrial({ plan_tier: "basic", trial_started_at: null, full_access: true })).toBe(false);
    expect(needsFirstTrial({ plan_tier: "demo", trial_started_at: null })).toBe(false);
  });

  test("the Basic weekly email is off", () => {
    expect(WEEKLY_DIGEST_ENABLED).toBe(false);
  });
});
