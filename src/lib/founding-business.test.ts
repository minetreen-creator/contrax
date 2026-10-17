import { describe, expect, mock, test } from "bun:test";
import { foundingBusinessSchema } from "./founding-business";
let userRow: any = null;
let reservedRows: any[] = [];
let availableRows: any[] = [];
const checkouts: any[] = [];
const writes: { text: string; values: unknown[] }[] = [];
mock.module("~/db", () => ({
  sql:
    () =>
    async (strings: TemplateStringsArray, ...values: unknown[]) => {
      const text = strings.join("?");
      writes.push({ text, values });
      if (text.includes("SELECT email, stripe_subscription_id"))
        return userRow ? [userRow] : [];
      if (text.includes("SELECT * FROM founding_businesses"))
        return reservedRows;
      if (text.includes("WITH seat AS")) return availableRows;
      return text.includes("RETURNING slot") ? [{ slot: 1 }] : [];
    },
}));
mock.module("~/lib/stripe", () => ({
  getStripe: () => ({
    coupons: {
      retrieve: async () => ({
        amount_off: 9100,
        currency: "usd",
        duration: "once",
        valid: true,
      }),
    },
    checkout: {
      sessions: {
        create: async (params: any, options: any) => {
          checkouts.push({ params, options });
          return { id: "cs_new", url: "https://checkout.stripe.com/test" };
        },
      },
    },
  }),
}));
const {
  foundingBusinessCheckoutParams,
  isPaidFoundingBusinessSession,
  handleFoundingBusinessEvent,
  startFoundingBusinessCheckout,
} = await import("./founding-business.server");
const profile = {
  company: "Example LLC",
  services: "Commercial cleaning",
  serviceArea: "Richmond, VA",
  website: "https://example.com",
  logoUrl: "",
  consent: true,
};
const session = {
  id: "cs_paid",
  metadata: { founding_business: "reservation-1", user_id: "7" },
  mode: "subscription",
  payment_status: "paid",
  currency: "usd",
  amount_total: 9900,
  subscription: "sub_1",
};
function event(type: string, data = session) {
  return { type, created: 1792240000, data: { object: data } } as any;
}
describe("Founding Business offer", () => {
  test("requires permission and safe, bounded company fields", () => {
    expect(foundingBusinessSchema.safeParse(profile).success).toBe(true);
    for (const bad of [
      { consent: false },
      { website: "javascript:alert(1)" },
      { logoUrl: "data:image/svg+xml,x" },
      { company: "x".repeat(101) },
      { services: "short" },
    ])
      expect(
        foundingBusinessSchema.safeParse({ ...profile, ...bad }).success,
      ).toBe(false);
  });
  test("annual renewal is $190 with a fixed one-time $91 discount, no free trial or quantity input", () => {
    const p = foundingBusinessCheckoutParams(
      7,
      "owner@example.com",
      "reservation-1",
      1,
    );
    expect(p.mode).toBe("subscription");
    expect((p.line_items![0] as any).price_data.unit_amount).toBe(19000);
    expect((p.line_items![0] as any).price_data.recurring.interval).toBe(
      "year",
    );
    expect(p.discounts).toEqual([
      { coupon: "contrax_founding_business_first_year_91_v1" },
    ]);
    expect(p.subscription_data?.metadata).toEqual(p.metadata);
    expect(p.custom_text?.submit?.message).toContain("Renews at $190/year");
    expect(p.subscription_data?.trial_period_days).toBeUndefined();
  });
  test("only a paid USD $99 subscription with attribution can fulfill", () => {
    expect(isPaidFoundingBusinessSession(session as any)).toBe(true);
    for (const patch of [
      { payment_status: "unpaid" },
      { amount_total: 19000 },
      { currency: "eur" },
      { subscription: null },
      { mode: "payment" },
      { metadata: { founding_business: "reservation-1", user_id: "bad" } },
    ])
      expect(
        isPaidFoundingBusinessSession({ ...session, ...patch } as any),
      ).toBe(false);
  });
  test("unrelated and unpaid events do not fulfill or publish", async () => {
    writes.length = 0;
    await handleFoundingBusinessEvent(event("invoice.paid"));
    expect(writes).toHaveLength(0);
    await handleFoundingBusinessEvent(
      event("checkout.session.completed", {
        ...session,
        payment_status: "unpaid",
      }),
    );
    expect(writes.some((w) => w.text.includes("SET paid_at"))).toBe(false);
  });
  test("paid completed and async success use a stable paid_at and reservation + user attribution", async () => {
    for (const type of [
      "checkout.session.completed",
      "checkout.session.async_payment_succeeded",
    ]) {
      writes.length = 0;
      await handleFoundingBusinessEvent(event(type));
      const write = writes.find((w) => w.text.includes("SET paid_at"))!;
      expect(write.text).toContain("COALESCE(paid_at");
      expect(write.text).toContain("AND user_id =");
      expect(write.values).toContain("reservation-1");
      expect(write.values).toContain(7);
      expect(write.text).not.toContain("published_at =");
    }
  });
  test("wrong paid amount fails for retry/reconciliation without fulfillment", async () => {
    writes.length = 0;
    await expect(
      handleFoundingBusinessEvent(
        event("checkout.session.completed", { ...session, amount_total: 1 }),
      ),
    ).rejects.toThrow("does not match");
    expect(writes.some((w) => w.text.includes("SET paid_at"))).toBe(false);
  });
  test("expired event cannot free a purchased seat or another checkout's reservation", async () => {
    writes.length = 0;
    await handleFoundingBusinessEvent(event("checkout.session.expired"));
    const write = writes.find((w) => w.text.includes("SET user_id = NULL"))!;
    expect(write.text).toContain("AND paid_at IS NULL");
    expect(write.text).toContain("AND checkout_session_id =");
    expect(write.values).toContain("cs_paid");
  });
});

describe("Founding Business reservation checkout", () => {
  test("unknown and already subscribed accounts cannot create another subscription", async () => {
    checkouts.length = 0;
    userRow = null;
    await expect(
      startFoundingBusinessCheckout(7, profile as any),
    ).rejects.toThrow("Account not found");
    userRow = {
      email: "owner@example.com",
      plan_tier: "professional",
      stripe_subscription_id: "sub_paid",
    };
    await expect(
      startFoundingBusinessCheckout(7, profile as any),
    ).rejects.toThrow("existing paid plan");
    expect(checkouts).toHaveLength(0);
  });
  test("sold out inventory fails before any payment session is created", async () => {
    userRow = {
      email: "owner@example.com",
      plan_tier: "basic",
      stripe_subscription_id: null,
    };
    reservedRows = [];
    availableRows = [];
    checkouts.length = 0;
    await expect(
      startFoundingBusinessCheckout(7, profile as any),
    ).rejects.toThrow("All 10 places");
    expect(checkouts).toHaveLength(0);
  });
  test("an existing reservation resumes its checkout rather than creating a duplicate", async () => {
    reservedRows = [{ checkout_url: "https://checkout.stripe.com/existing" }];
    checkouts.length = 0;
    expect(await startFoundingBusinessCheckout(7, profile as any)).toBe(
      "https://checkout.stripe.com/existing",
    );
    expect(checkouts).toHaveLength(0);
  });
  test("reserved seat attributes payment and uses the reservation as an idempotency key", async () => {
    reservedRows = [];
    availableRows = [
      {
        slot: 3,
        reservation: "stable-token",
        reserved_at: new Date().toISOString(),
      },
    ];
    checkouts.length = 0;
    expect(await startFoundingBusinessCheckout(7, profile as any)).toBe(
      "https://checkout.stripe.com/test",
    );
    expect(checkouts[0].options.idempotencyKey).toBe(
      "founding-business-stable-token",
    );
    expect(checkouts[0].params.metadata.founding_business_slot).toBe("3");
    expect(checkouts[0].params.metadata.user_id).toBe("7");
  });
});
