import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import {
  CHECKOUT_SUBMIT_MESSAGE,
  PASS_RENEW_URL,
  passReminderEmail,
  STARTER_PASS_AMOUNT,
  STARTER_PASS_DAYS,
  starterCheckoutKind,
  starterPassEligibleRequest,
  starterPassEndsAt,
} from "./starter-pass";
import { needsFirstTrial } from "./trial";

describe("Starter $5 30-day pass (owner 2026-10-30)", () => {
  test("$5 for 30 days", () => {
    expect(STARTER_PASS_AMOUNT).toBe(500);
    expect(STARTER_PASS_DAYS).toBe(30);
    expect(starterPassEndsAt(Date.parse("2026-10-30T12:00:00Z") / 1000).toISOString()).toBe("2026-11-29T12:00:00.000Z");
  });

  test("first-time buyers get the pass; returning pass buyers pay full price; subscribers keep their checkout", () => {
    expect(starterCheckoutKind({ signedIn: false })).toBe("pass");
    expect(starterCheckoutKind({ signedIn: true, subscriptionStatus: null })).toBe("pass");
    expect(starterCheckoutKind({ signedIn: true, subscriptionStatus: "pass_ended", passBoughtAt: "2026-10-01" })).toBe("subscription_full_price");
    expect(starterCheckoutKind({ signedIn: true, subscriptionStatus: "active", passBoughtAt: "2026-10-01" })).toBe("subscription_full_price");
    expect(starterCheckoutKind({ signedIn: true, subscriptionStatus: "active" })).toBe("subscription");
  });

  test("only a plain monthly Starter checkout can become a pass", () => {
    expect(starterPassEligibleRequest({ planTier: "starter" })).toBe(true);
    expect(starterPassEligibleRequest({ planTier: "starter", interval: "year" })).toBe(false);
    expect(starterPassEligibleRequest({ planTier: "professional" })).toBe(false);
    expect(starterPassEligibleRequest({ planTier: "starter", promoCode: "VAD26" })).toBe(false);
    expect(starterPassEligibleRequest({ planTier: "starter", founding: true })).toBe(false);
    expect(starterPassEligibleRequest({ planTier: "starter", mode: "payment" })).toBe(false);
  });

  test("the reminder asks, names the end date, and promises no charge without a yes", () => {
    const m = passReminderEmail(new Date("2026-11-29T12:00:00Z"));
    expect(m.subject).toBe("Your Contrax bid emails stop on November 29");
    expect(m.text).toContain("you won't be charged");
    expect(m.html).toContain(PASS_RENEW_URL);
    expect(CHECKOUT_SUBMIT_MESSAGE).toContain("6 AM");
  });

  test("a finished pass never restarts as a free trial", () => {
    expect(needsFirstTrial({ plan_tier: "basic", trial_started_at: null, subscription_status: "pass_ended" })).toBe(false);
    expect(needsFirstTrial({ plan_tier: "basic", trial_started_at: null, subscription_status: null })).toBe(true);
  });

  test("wired: every checkout route decides the pass; the daily job is scheduled", () => {
    for (const f of ["src/routes/api/stripe/create-checkout-session.ts", "vercel-entry.ts", "serve.ts"]) {
      expect(readFileSync(f, "utf8")).toContain("starterCheckoutOptions");
    }
    expect(readFileSync("build-vercel.sh", "utf8")).toContain('"/api/cron/starter-pass"');
  });
});
