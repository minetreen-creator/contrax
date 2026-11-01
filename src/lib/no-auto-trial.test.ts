import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { NEW_ACCOUNT_TRIAL, newAccountPlan } from "./trial";

// Owner 2026-11-01 ("do B"): no automatic 7-day trial; the $5 Starter pass is the way in.
describe("new accounts start on free Basic with no trial", () => {
  test("the switch is off and a new account is Basic with no trial start", () => {
    expect(NEW_ACCOUNT_TRIAL).toBe(false);
    expect(newAccountPlan(new Date("2026-11-01T12:00:00Z"))).toEqual({ planTier: "basic", trialStartedAt: null });
  });
  test("email signup and Google sign-in both create accounts through newAccountPlan", () => {
    expect(readFileSync("src/routes/api/signup.ts", "utf8")).toContain("${plan.planTier}, ${plan.trialStartedAt}");
    const google = readFileSync("src/routes/auth/google/callback.tsx", "utf8");
    expect(google).toContain("const { planTier, trialStartedAt } = newAccountPlan();");
    expect(google).not.toContain("'professional', ${trialStartedAt}");
  });
  test("no lazy first trial and no new trial from premium use while the switch is off", () => {
    const trial = readFileSync("src/lib/trial.ts", "utf8");
    expect(trial).toContain("if (r && NEW_ACCOUNT_TRIAL && needsFirstTrial(r)) {");
    expect(trial).toContain("if (!NEW_ACCOUNT_TRIAL) return null;");
  });
  test("public pages no longer promise a 7-day trial", () => {
    for (const f of [
      "src/routes/pricing/index.tsx",
      "src/routes/upgrade.tsx",
      "src/routes/radar.tsx",
      "src/routes/bid.$bidId.tsx",
      "src/routes/demo/index.tsx",
      "src/routes/compare/index.tsx",
      "src/components/SignupContextPanel.tsx",
      "src/components/IncumbentCard.tsx",
    ]) {
      const src = readFileSync(f, "utf8").split("\n").filter((l) => !/^\s*(\/\/|\*|\/\*|\{\/\*)/.test(l)).join("\n");
      expect({ f, hit: /7-day (professional |free )?trial|free for 7 days|start(?: your)? free trial/i.test(src) }).toEqual({ f, hit: false });
    }
  });
});

describe("no 'your trial is ready' card while the trial is off", () => {
  test("a fresh Basic account is not offered the trial card", async () => {
    const { shouldShowTrialStartCard } = await import("./trial-start-card");
    expect(
      shouldShowTrialStartCard({ active: false, expired: false, fullAccess: false, planTier: "basic", trialEnded: false }, null),
    ).toEqual({ show: false, reason: "trial-off" });
  });
});
