import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { FOUNDING_BUSINESS_RENEWAL_CENTS } from "./founding-business";
import {
  STARTER_ANNUAL_PRICE,
  STARTER_FIRST_MONTH_AMOUNT_OFF,
  STARTER_FIRST_MONTH_COUPON,
  STARTER_FIRST_MONTH_PRICE,
  STARTER_FULL_PRICE,
  STARTER_MONTHLY_CENTS,
} from "./starter-offer";
import { STARTER_PASS_NOTE } from "./starter-pass";

// Owner 2026-11-09: Starter $14/month (was $19); Professional $79, Bid Scout $99 and the higher
// tiers unchanged. The $5 pass stays the way in; after it, Starter at $14 only if chosen.
describe("Starter at $14", () => {
  test("the numbers agree", () => {
    expect(STARTER_MONTHLY_CENTS).toBe(1400);
    expect(STARTER_FULL_PRICE).toBe(14);
    expect(STARTER_FIRST_MONTH_PRICE + STARTER_FIRST_MONTH_AMOUNT_OFF / 100).toBe(14);
    expect(STARTER_ANNUAL_PRICE).toBe(90); // owner 2026-11-22
    expect(FOUNDING_BUSINESS_RENEWAL_CENTS).toBe(14000);
    // A coupon's amount cannot change in Stripe, so the $5 first month needs a new coupon id.
    expect(STARTER_FIRST_MONTH_COUPON).toBe("contrax_starter_first_month_9_v1");
    // Owner 2026-11-22: a new buyer pays $9 a month; $14 stays the list price behind yearly and partner plans.
    expect(STARTER_PASS_NOTE).toContain("$9 a month");
  });

  test("checkout bills $14 inline, never the old $19 catalog price", () => {
    const stripe = readFileSync(new URL("./stripe.ts", import.meta.url), "utf8");
    expect(stripe).toContain('} else if (interval === "month" && planTier === "starter" && !isVad) {');
    expect(stripe).toContain("unit_amount: STARTER_MONTHLY_CENTS,");
    expect(stripe).toContain(': planTier === "starter" ? STARTER_MONTHLY_CENTS : monthly.unit_amount;');
    expect(stripe).toContain("starter: STARTER_PASS_AMOUNT * 10,");
  });

  test("pages show $14 (Grants keeps its own $19)", () => {
    for (const f of ["../routes/pricing/index.tsx", "../routes/signup.tsx", "../routes/upgrade.tsx"]) {
      const src = readFileSync(new URL(f, import.meta.url), "utf8");
      expect(src).not.toMatch(/name: "Starter",\s*price: 19/);
    }
  });
});

// Owner 2026-11-22: "get rid of any VAD information and payments".
test("the VAD partner price is retired: no page, no link, and no code reaches the checkout", () => {
  const vad = readFileSync(new URL("../routes/vad.tsx", import.meta.url), "utf8");
  expect(vad).toContain('throw redirect({ to: "/pricing", statusCode: 301 });');
  expect(vad).not.toMatch(/Diabetes|VAD26|price:/);
  expect(readFileSync(new URL("../routes/pricing/index.tsx", import.meta.url), "utf8")).not.toMatch(/\/vad|Veterans Against/);
  expect(readFileSync(new URL("./stripe.ts", import.meta.url), "utf8")).toContain("const isVad: boolean = false;");
  for (const f of ["../routes/api/stripe/create-checkout-session.ts", "../../serve.ts", "../../vercel-entry.ts"]) {
    expect(readFileSync(new URL(f, import.meta.url), "utf8")).not.toContain('"VAD26"');
  }
});
