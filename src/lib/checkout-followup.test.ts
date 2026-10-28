import { describe, expect, test } from "bun:test";
import { checkoutFollowupEmail, followupCandidate, returnLink } from "./checkout-followup";

const NOW = Date.parse("2026-10-28T12:00:00Z");
const ago = (min: number) => Math.floor((NOW - min * 60_000) / 1000);
const base = { id: "cs_1", status: "open", paymentStatus: "unpaid", created: ago(90), metadata: { plan_tier: "starter" } };

describe("followupCandidate", () => {
  test("an unpaid plan checkout from 90 minutes ago qualifies", () => {
    expect(followupCandidate(base, NOW)).toBe(true);
    expect(followupCandidate({ ...base, status: "expired" }, NOW)).toBe(true);
  });
  test("too new, too old, paid, complete or not a plan checkout does not", () => {
    expect(followupCandidate({ ...base, created: ago(30) }, NOW)).toBe(false);
    expect(followupCandidate({ ...base, created: ago(49 * 60) }, NOW)).toBe(false);
    expect(followupCandidate({ ...base, paymentStatus: "paid" }, NOW)).toBe(false);
    expect(followupCandidate({ ...base, status: "complete" }, NOW)).toBe(false);
    expect(followupCandidate({ ...base, metadata: { kind: "bid_fit_review" } as Record<string, string> }, NOW)).toBe(false);
    expect(followupCandidate({ ...base, metadata: null }, NOW)).toBe(false);
  });
});

describe("checkoutFollowupEmail", () => {
  test("names the plan, links back, carries the address and unsubscribe", () => {
    const m = checkoutFollowupEmail({ metadata: { plan_tier: "professional" }, postalAddress: "1 Main St, Town VA 00000", unsubscribeUrl: "https://x/u?t=1" });
    expect(m.subject).toBe("Still deciding on Contrax?");
    expect(m.text).toContain("checkout for Contrax Professional");
    expect(m.text).toContain("nothing was charged");
    expect(m.text).toContain("https://www.contrax.company/upgrade?plan=professional&utm_source=email&utm_medium=checkout_followup");
    expect(m.text).toContain("Contrax LLC, 1 Main St, Town VA 00000");
    expect(m.text).toContain("Unsubscribe: https://x/u?t=1");
    expect(m.html).toContain('href="https://x/u?t=1"');
  });
  test("founding checkouts go back to the founding page", () => {
    expect(returnLink({ plan_tier: "starter", founding_member: "true" })).toStartWith("https://www.contrax.company/founding-businesses?");
    expect(checkoutFollowupEmail({ metadata: { plan_tier: "starter", founding_member: "true" }, postalAddress: "a", unsubscribeUrl: "u" }).text).toContain("the Founding Business plan");
  });
});
