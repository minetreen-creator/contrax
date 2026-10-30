import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { cleanField, SUB_LIST_PRICE_CENTS } from "./sub-list";
import { leadsHeadline, outreachEmail } from "./outreach";

describe("paid sub list and Award Leads outreach (owner 2026-10-30)", () => {
  test("a sub list is $49 and its fields are tidy", () => {
    expect(SUB_LIST_PRICE_CENTS).toBe(4900);
    expect(cleanField("  Galveston,   TX ")).toBe("Galveston, TX");
    expect(cleanField("   ")).toBeNull();
    expect(cleanField("x".repeat(200))!.length).toBe(80);
  });

  test("the Stripe webhook routes sub-list payments before the account flow", () => {
    const src = readFileSync(new URL("./stripe.ts", import.meta.url), "utf8");
    const at = src.indexOf("handleSubListEvent(event)");
    expect(at).toBeGreaterThan(0);
    expect(at).toBeLessThan(src.indexOf('event.type !== "checkout.session.completed" && event.type !== "checkout.session.async_payment_succeeded"'));
  });

  test("Award Leads email: real numbers, one free-list ask, no price", () => {
    expect(leadsHeadline(41, 28_400_000, "Texas")).toBe("41 companies based in Texas won $28.4 million in federal contracts in the last 30 days");
    expect(leadsHeadline(1, 2_000_000_000, "Ohio")).toBe("1 company based in Ohio won $2 billion in federal contracts in the last 30 days");
    const mail = outreachEmail({
      kind: "leads", business: "Lone Star Surety", bidId: 0, bidTitle: leadsHeadline(41, 28_400_000, "Texas"), buyer: null, due: "2026-11-29",
      tradeLabel: "surety bond", place: "Texas", postalAddress: "203 Homestead Dr, Colonial Heights VA 23834",
      unsubscribeUrl: "https://www.contrax.company/api/outreach/unsubscribe?t=x", contactId: 7,
    });
    expect(mail.subject).toBe("New federal contract winners in Texas");
    expect(mail.text).toContain("41 companies based in Texas won $28.4 million");
    expect(mail.text).toContain("performance and payment bonds");
    expect(mail.text).toContain('reply "yes"');
    expect(mail.text).toContain("/leads?utm_source=email");
    expect(mail.text).not.toContain("$249");
  });
});
