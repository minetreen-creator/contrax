import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import {
  CHECKOUT_SUBMIT_MESSAGE,
  PASS_RENEW_URL,
  passBoughtOwnerAlert,
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

describe("owner alert for a new pass", () => {
  test("names the buyer and the end date in the push and the email", () => {
    const a = passBoughtOwnerAlert("buyer@biz.com", new Date("2026-11-30T15:00:00Z"));
    expect(a.subject).toBe("💰 New $5 Starter pass: buyer@biz.com");
    expect(a.push.title).toBe("💰 New $5 Starter pass");
    expect(a.push.body).toContain("buyer@biz.com");
    expect(a.push.body).toContain("November 30");
    expect(a.push.url).toBe("/admin/live");
    expect(a.text).toContain("$19/month");
  });
  test("a checkout without an email still alerts", () => {
    expect(passBoughtOwnerAlert(null, new Date("2026-11-30T15:00:00Z")).push.body).toContain("(no email on the checkout)");
  });
  test("only the first purchase alerts, and a failed alert never fails the checkout", () => {
    const src = readFileSync(new URL("./starter-pass.server.ts", import.meta.url), "utf8");
    expect(src).toContain("WHERE id = ${userId} AND starter_pass_bought_at IS NULL");
    expect(src).toContain("if (firstPurchase.length) await alertOwnerOfPass(");
    expect(src).toContain('console.error("[starter-pass] owner push failed:"');
    expect(src).toContain('console.error("[starter-pass] owner email failed:"');
  });
});
