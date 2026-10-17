/**
 * Yearly billing ("2 months free", owner 2026-10-02): the checkout builds the
 * yearly line item inline on the tier's own Product at 10 × monthly, and the
 * finance MRR counts a yearly price as 1/12 per month. Stripe is mocked; no
 * network.
 */
import { beforeAll, describe, expect, mock, test } from "bun:test";
import { recurringMonthlyAmount } from "./finance-mrr";

const created: any[] = [];
// Founding-member spot count (live subscription search), driven per test.
let foundingSubs: { status: string }[] = [];
let foundingSearchFails = false;
let legacyProduct = false;
mock.module("stripe", () => ({
  default: class FakeStripe {
    subscriptions = {
      search: async () => {
        if (foundingSearchFails) throw new Error("stripe down");
        return { data: foundingSubs, has_more: false, next_page: null };
      },
    };
    prices = {
      list: async () => ({
        data: [
          { id: "price_starter_monthly", unit_amount: 1900, product: { id: "prod_starter", name: "Contrax Starter", metadata: { plan_tier: "starter" } } },
          { id: "price_pro_monthly", unit_amount: 7900, product: { id: "prod_pro", name: "Contrax Professional", metadata: { plan_tier: "professional" } } },
        ],
        has_more: false,
      }),
      retrieve: async (id: string, options?: any) => ({
        id, currency: "usd", unit_amount: id === "price_pro_monthly" ? 7900 : 1900,
        tax_behavior: "unspecified",
        product: options?.expand ? {
          id: id === "price_pro_monthly" ? "prod_pro" : "prod_starter",
          name: legacyProduct ? "Contrax Agency" : id === "price_pro_monthly" ? "Contrax Professional" : "Contrax Starter",
          tax_code: "txcd_10103001",
        } : id === "price_pro_monthly" ? "prod_pro" : "prod_starter",
      }),
    };
    checkout = {
      sessions: {
        create: async (params: any) => {
          created.push(params);
          return { url: "https://checkout.stripe.test/session" };
        },
      },
    };
  },
}));

let stripeLib: typeof import("./stripe");
beforeAll(async () => {
  process.env.STRIPE_SECRET_KEY = "sk_test_fake";
  stripeLib = await import("./stripe");
});

describe("yearly checkout", () => {
  test("Starter yearly: $190 a year on the Starter product, same metadata as monthly", async () => {
    created.length = 0;
    const r = await stripeLib.createCheckoutSession("starter", { userId: 42, interval: "year" });
    expect(r).toEqual({ success: true, url: "https://checkout.stripe.test/session" });
    const params = created[0];
    expect(params.mode).toBe("subscription");
    expect(params.line_items).toEqual([
      { price_data: { currency: "usd", product: "prod_starter", unit_amount: 19000, recurring: { interval: "year" } }, quantity: 1 },
    ]);
    expect(params.metadata).toEqual({ plan_tier: "starter", user_id: "42", billing_interval: "year" });
    expect(params.subscription_data.metadata).toEqual(params.metadata);
  });

  test("monthly checkout is unchanged: the catalog price, no interval metadata", async () => {
    created.length = 0;
    await stripeLib.createCheckoutSession("professional", { userId: 7 });
    expect(created[0].line_items).toEqual([{ price: "price_pro_monthly", quantity: 1 }]);
    expect(created[0].metadata).toEqual({ plan_tier: "professional", user_id: "7" });
  });

  test("yearly is refused with the VAD code and for the one-time premium", async () => {
    created.length = 0;
    expect(await stripeLib.createCheckoutSession("starter", { interval: "year", promoCode: "VAD26" })).toEqual({
      success: false,
      error: "Yearly billing is not available for this plan.",
    });
    expect((await stripeLib.createCheckoutSession("savings_premium", { interval: "year" })).success).toBe(false);
    expect(created.length).toBe(0);
  });

  test("yearly amounts are 10 × monthly", () => {
    expect(stripeLib.ANNUAL_UNIT_AMOUNTS).toEqual({ starter: 19000, professional: 79000, agency: 199000 });
    for (const tier of ["starter", "professional", "agency"] as const) {
      expect(stripeLib.ANNUAL_UNIT_AMOUNTS[tier]).toBe(stripeLib.MONTHLY_PRICE_USD[tier]! * 100 * 10);
    }
  });
});

describe("MRR counts a yearly price per month", () => {
  test("monthly, yearly and non-recurring line items", () => {
    expect(recurringMonthlyAmount({ items: { data: [{ price: { recurring: { interval: "month" }, unit_amount: 1900 } }] } })).toBe(1900);
    expect(recurringMonthlyAmount({ items: { data: [{ price: { recurring: { interval: "year" }, unit_amount: 19000 } }] } })).toBe(1583);
    expect(recurringMonthlyAmount({ items: { data: [{ price: { recurring: null, unit_amount: 9900 } }] } })).toBe(0);
    expect(recurringMonthlyAmount({ items: { data: [{ price: { recurring: { interval: "month", interval_count: 3 }, unit_amount: 3000 } }] } })).toBe(1000);
  });
});

describe("retired $9 founding-member offer", () => {
  test("old checkout requests fail closed without creating a payment session", async () => {
    created.length = 0;
    expect(await stripeLib.foundingSpotsRemaining()).toBe(0);
    for (const options of [{ founding: true }, { founding: true, interval: "year" as const }, { founding: true, promoCode: "VAD26" }]) {
      const result = await stripeLib.createCheckoutSession("starter", options);
      expect(result.success).toBe(false);
      expect(result.error).toContain("has ended");
    }
    expect(created).toHaveLength(0);
  });
});

describe("legacy shared Agency product", () => {
  test("repairs founding, monthly and yearly names without changing charges or attribution", async () => {
    legacyProduct = true;
    try {
      for (const [tier, options, amount, name] of [
        ["starter", {}, 1900, "Contrax Starter"],
        ["professional", {}, 7900, "Contrax Professional"],
        ["professional", { interval: "year" }, 79000, "Contrax Professional"],
      ] as const) {
        created.length = 0;
        expect((await stripeLib.createCheckoutSession(tier, { ...options, userId: 42 })).success).toBe(true);
        const session = created[0];
        const price = session.line_items[0].price_data;
        expect(price.product_data.name).toBe(name);
        expect(price.product_data.tax_code).toBe("txcd_10103001");
        expect(price.unit_amount).toBe(amount);
        expect(price.recurring.interval).toBe("interval" in options ? options.interval : "month");
        expect(price.tax_behavior).toBe("unspecified");
        expect(session.metadata.plan_tier).toBe(tier);
        expect(session.metadata.user_id).toBe("42");
        expect(session.subscription_data.metadata).toEqual(session.metadata);
      }
    } finally { legacyProduct = false; }
  });
});
