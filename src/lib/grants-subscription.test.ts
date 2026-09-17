/**
 * Contrax Grants $19/month subscription — authorization + webhook tests.
 *
 * Owner spec 2026-09-17: grant access comes ONLY from a verified Stripe
 * subscription status stored in the DB, and only `active` / `trialing` grant it.
 * These tests prove the decision rules and the webhook transitions WITHOUT a
 * database or a live Stripe key: the webhook handler takes an injected store and
 * an injected Stripe client, so every transition below is a real call through
 * the production handler with a fake in-memory backend.
 *
 * Covered:
 *   1. isGrantsStatusGranted / evaluateGrantsSubscription — only active+trialing.
 *   2. grantsAccessTier — a signed-in user with NO subscription gets the
 *      anonymous `preview` limits (the owner's behavior change), never `full`.
 *   3. checkout.session.completed / subscription.created → active (access).
 *   4. subscription.deleted → no access; invoice.payment_failed → no access;
 *      invoice.paid AND invoice_payment.paid (the event the owner's live endpoint
 *      is actually configured with — an InvoicePayment, which carries neither
 *      `subscription` nor `customer`, so the id is resolved through its invoice)
 *      → access restored. Unattributable invoice_payment.paid → nothing granted.
 *   5. Events for OTHER products (Contrax plans, Bid Scout) are NOT consumed, so
 *      the existing webhook flow is untouched.
 *   6. The checkout route's input validation — no client-supplied price/quantity.
 *   7. Fail-closed behavior: a lookup error denies access.
 */
import { describe, expect, test } from "bun:test";
import {
  GRANTS_HANDLED_EVENTS,
  GRANTS_PRICE_ENV,
  NO_GRANTS_SUBSCRIPTION,
  evaluateGrantsSubscription,
  getGrantsPriceId,
  getGrantsSubscription,
  grantsAccessTier,
  grantsStatusAfterEvent,
  handleGrantsSubscriptionEvent,
  isGrantsStatusGranted,
  periodEndIso,
  validateGrantsCheckoutBody,
  type GrantsSubscriptionRow,
  type GrantsSubscriptionStore,
} from "./grants-subscription.server";

// ── Fakes ─────────────────────────────────────────────────────────────────────

function fakeStore(seed: GrantsSubscriptionRow[] = []) {
  const rows = new Map<string, GrantsSubscriptionRow>();
  for (const r of seed) {
    if (r.stripe_subscription_id) rows.set(r.stripe_subscription_id, r);
  }
  const writes: string[] = [];
  let failLookup = false;
  const store: GrantsSubscriptionStore = {
    async getByUserId(userId) {
      if (failLookup) throw new Error("boom");
      return [...rows.values()].find((r) => r.user_id === userId) ?? null;
    },
    async getBySubscriptionId(id) {
      if (failLookup) throw new Error("boom");
      return rows.get(id) ?? null;
    },
    async getByCustomerId(id) {
      if (failLookup) throw new Error("boom");
      return [...rows.values()].find((r) => r.stripe_customer_id === id) ?? null;
    },
    async upsert(row) {
      writes.push(`upsert:${row.stripe_subscription_id}:${row.status}`);
      rows.set(row.stripe_subscription_id ?? "?", row);
    },
    async setStatusBySubscriptionId(subscriptionId, status, currentPeriodEnd) {
      writes.push(`set:${subscriptionId}:${status}`);
      const existing = rows.get(subscriptionId);
      if (existing) {
        rows.set(subscriptionId, { ...existing, status, current_period_end: currentPeriodEnd });
      }
    },
  };
  return {
    store,
    writes,
    rows,
    rowFor: (id: string) => rows.get(id) ?? null,
    setFailLookup: (v: boolean) => {
      failLookup = v;
    },
  };
}

/** Minimal Stripe stand-in: only subscriptions.retrieve is used by the handler. */
function fakeStripe(status = "active", periodEnd = 1_800_000_000) {
  return {
    subscriptions: {
      async retrieve(id: string) {
        return {
          id,
          status,
          current_period_end: periodEnd,
          items: { data: [{ price: { id: "price_test_grants" }, current_period_end: periodEnd }] },
        };
      },
    },
  } as unknown as Parameters<typeof handleGrantsSubscriptionEvent>[1]["stripe"];
}

/**
 * Minimal Stripe stand-in for the invoice read that `invoice_payment.paid`
 * needs: an InvoicePayment has no subscription field of its own, so the id is
 * read off its invoice. An unknown invoice throws (a real 404 would too).
 */
function fakeInvoiceStripe(subscriptionByInvoice: Record<string, string | null>) {
  return {
    invoices: {
      async retrieve(id: string) {
        const subscription = subscriptionByInvoice[id];
        if (subscription === undefined) throw new Error(`No such invoice: ${id}`);
        return { id, object: "invoice", subscription };
      },
    },
  } as unknown as Parameters<typeof handleGrantsSubscriptionEvent>[1]["stripe"];
}

function event(type: string, object: Record<string, unknown>): Parameters<
  typeof handleGrantsSubscriptionEvent
>[0] {
  return { id: "evt_test", type, data: { object } } as unknown as Parameters<
    typeof handleGrantsSubscriptionEvent
  >[0];
}

const grantsSession = {
  id: "cs_test_1",
  object: "checkout.session",
  metadata: { product: "grants", user_id: "42" },
  customer: "cus_test_1",
  subscription: "sub_test_1",
  customer_details: { email: "grants@test.contrax" },
};

const planSession = {
  id: "cs_test_plan",
  object: "checkout.session",
  metadata: { plan_tier: "starter", user_id: "42" },
  customer: "cus_test_plan",
  subscription: "sub_plan_1",
  customer_details: { email: "plan@test.contrax" },
};

const grantsSubscription = {
  id: "sub_test_1",
  object: "subscription",
  status: "active",
  metadata: { product: "grants", user_id: "42" },
  customer: "cus_test_1",
  current_period_end: 1_800_000_000,
  items: { data: [{ price: { id: "price_test_grants" }, current_period_end: 1_800_000_000 }] },
};

/**
 * A REAL `invoice_payment` object, verbatim field set (owner's live endpoint is
 * configured with `invoice_payment.paid`). Note what is NOT here: no
 * `subscription` and no `customer` — verified 2026-09-17 against the Stripe
 * OpenAPI spec (components.schemas.invoice_payment), the installed stripe@22
 * types (resources/InvoicePayments.d.ts) and the live API reference page.
 */
const invoicePayment = {
  id: "inpay_test_1",
  object: "invoice_payment",
  amount_paid: 1900,
  amount_requested: 1900,
  created: 1_800_000_000,
  currency: "usd",
  invoice: "in_test_1",
  is_default: true,
  livemode: true,
  payment: { type: "payment_intent", payment_intent: "pi_test_1" },
  status: "paid",
  status_transitions: { paid_at: 1_800_000_000 },
};

// ── 1. Entitlement status set ────────────────────────────────────────────────

describe("grants entitlement statuses", () => {
  test("only active and trialing grant access", () => {
    expect(isGrantsStatusGranted("active")).toBe(true);
    expect(isGrantsStatusGranted("trialing")).toBe(true);
    for (const status of [
      "past_due",
      "unpaid",
      "canceled",
      "incomplete",
      "incomplete_expired",
      "paused",
      "",
      null,
      undefined,
    ]) {
      expect(isGrantsStatusGranted(status as string | null | undefined)).toBe(false);
    }
  });

  test("evaluateGrantsSubscription treats anything else as no-access", () => {
    expect(evaluateGrantsSubscription(null).subscribed).toBe(false);
    expect(evaluateGrantsSubscription({ user_id: 1, status: null }).subscribed).toBe(false);
    expect(evaluateGrantsSubscription({ user_id: 1, status: "past_due" }).subscribed).toBe(false);
    const granted = evaluateGrantsSubscription({
      user_id: 1,
      status: "trialing",
      current_period_end: "2026-10-17T00:00:00.000Z",
      stripe_customer_id: "cus_x",
    });
    expect(granted.subscribed).toBe(true);
    expect(granted.status).toBe("trialing");
    expect(granted.currentPeriodEnd).toBe("2026-10-17T00:00:00.000Z");
    expect(granted.stripeCustomerId).toBe("cus_x");
  });

  test("NO_GRANTS_SUBSCRIPTION is no-access", () => {
    expect(NO_GRANTS_SUBSCRIPTION.subscribed).toBe(false);
    expect(NO_GRANTS_SUBSCRIPTION.status).toBe(null);
  });
});

// ── 2. Access tier — the authorization rule the search API enforces ──────────

describe("grants access tiers", () => {
  test("signed in WITHOUT a subscription gets the anonymous preview limits", () => {
    expect(grantsAccessTier({ authenticated: true, subscribed: false })).toBe("preview");
  });

  test("only signed in + granted status gets full access", () => {
    expect(grantsAccessTier({ authenticated: true, subscribed: true })).toBe("full");
  });

  test("anonymous never gets full access, even if a status were passed in", () => {
    expect(grantsAccessTier({ authenticated: false, subscribed: false })).toBe("preview");
    expect(grantsAccessTier({ authenticated: false, subscribed: true })).toBe("preview");
  });

  test("entitlement read is fail-closed when the store throws", async () => {
    const fake = fakeStore();
    fake.setFailLookup(true);
    const state = await getGrantsSubscription(7, fake.store);
    expect(state.subscribed).toBe(false);
  });

  test("entitlement read returns granted access for an active row", async () => {
    const fake = fakeStore([
      { user_id: 7, status: "active", stripe_subscription_id: "sub_test_1" },
    ]);
    const state = await getGrantsSubscription(7, fake.store);
    expect(state.subscribed).toBe(true);
    expect(state.status).toBe("active");
    // no user id → no lookup, no access
    expect((await getGrantsSubscription(null, fake.store)).subscribed).toBe(false);
  });
});

// ── 3./4. Webhook transitions ────────────────────────────────────────────────

describe("grants webhook transitions", () => {
  test("handles the six configured events plus the invoice.paid alias", () => {
    expect([...GRANTS_HANDLED_EVENTS].sort()).toEqual(
      [
        "checkout.session.completed",
        "customer.subscription.created",
        "customer.subscription.deleted",
        "customer.subscription.updated",
        // The owner's live webhook endpoint is configured with this one
        // (verified 2026-09-17); `invoice.paid` is kept as a backward-compatible
        // alias, so both names are accepted.
        "invoice_payment.paid",
        "invoice.paid",
        "invoice.payment_failed",
      ].sort(),
    );
  });

  test("checkout.session.completed (grants) → stored active, access granted", async () => {
    const fake = fakeStore();
    const consumed = await handleGrantsSubscriptionEvent(
      event("checkout.session.completed", grantsSession),
      { store: fake.store, stripe: fakeStripe("active") },
    );
    expect(consumed).toBe(true);
    const row = fake.rowFor("sub_test_1");
    expect(row?.status).toBe("active");
    expect(row?.user_id).toBe(42);
    expect(row?.stripe_customer_id).toBe("cus_test_1");
    expect(row?.stripe_checkout_session_id).toBe("cs_test_1");
    expect(row?.current_period_end).toBe("2027-01-15T08:00:00.000Z");
    expect(evaluateGrantsSubscription(row).subscribed).toBe(true);
  });

  test("checkout.session.completed for a PLAN is not consumed (existing flow intact)", async () => {
    const fake = fakeStore();
    const consumed = await handleGrantsSubscriptionEvent(
      event("checkout.session.completed", planSession),
      { store: fake.store, stripe: fakeStripe() },
    );
    expect(consumed).toBe(false);
    expect(fake.writes).toHaveLength(0);
  });

  test("customer.subscription.created → active (access)", async () => {
    const fake = fakeStore();
    const consumed = await handleGrantsSubscriptionEvent(
      event("customer.subscription.created", grantsSubscription),
      { store: fake.store },
    );
    expect(consumed).toBe(true);
    expect(fake.rowFor("sub_test_1")?.status).toBe("active");
    expect(evaluateGrantsSubscription(fake.rowFor("sub_test_1")).subscribed).toBe(true);
  });

  test("customer.subscription.deleted → canceled (NO access)", async () => {
    const fake = fakeStore([
      { user_id: 42, status: "active", stripe_subscription_id: "sub_test_1" },
    ]);
    const consumed = await handleGrantsSubscriptionEvent(
      event("customer.subscription.deleted", { ...grantsSubscription, status: "canceled" }),
      { store: fake.store },
    );
    expect(consumed).toBe(true);
    expect(fake.rowFor("sub_test_1")?.status).toBe("canceled");
    expect(evaluateGrantsSubscription(fake.rowFor("sub_test_1")).subscribed).toBe(false);
  });

  test("invoice.payment_failed → past_due (NO access)", async () => {
    const fake = fakeStore([
      { user_id: 42, status: "active", stripe_subscription_id: "sub_test_1" },
    ]);
    const consumed = await handleGrantsSubscriptionEvent(
      event("invoice.payment_failed", { id: "in_1", subscription: "sub_test_1" }),
      { store: fake.store },
    );
    expect(consumed).toBe(true);
    expect(fake.rowFor("sub_test_1")?.status).toBe("past_due");
    expect(evaluateGrantsSubscription(fake.rowFor("sub_test_1")).subscribed).toBe(false);
  });

  test("invoice.paid recovers a past_due subscription (access restored)", async () => {
    const fake = fakeStore([
      { user_id: 42, status: "past_due", stripe_subscription_id: "sub_test_1" },
    ]);
    const consumed = await handleGrantsSubscriptionEvent(
      event("invoice.paid", { id: "in_2", subscription: "sub_test_1" }),
      { store: fake.store },
    );
    expect(consumed).toBe(true);
    expect(fake.rowFor("sub_test_1")?.status).toBe("active");
    expect(evaluateGrantsSubscription(fake.rowFor("sub_test_1")).subscribed).toBe(true);
  });

  // ── invoice_payment.paid — the event the LIVE endpoint is configured with ──

  test("invoice_payment.paid (real InvoicePayment shape) recovers past_due → active and writes the row", async () => {
    const fake = fakeStore([
      { user_id: 42, status: "past_due", stripe_subscription_id: "sub_test_1" },
    ]);
    const consumed = await handleGrantsSubscriptionEvent(
      event("invoice_payment.paid", invoicePayment),
      { store: fake.store, stripe: fakeInvoiceStripe({ in_test_1: "sub_test_1" }) },
    );
    expect(consumed).toBe(true);
    // Exactly one write: the status transition on the known subscription.
    expect(fake.writes).toEqual(["set:sub_test_1:active"]);
    expect(fake.rowFor("sub_test_1")?.status).toBe("active");
    expect(evaluateGrantsSubscription(fake.rowFor("sub_test_1")).subscribed).toBe(true);
  });

  test("invoice_payment.paid with an EXPANDED invoice needs no extra Stripe read", async () => {
    const fake = fakeStore([
      { user_id: 42, status: "past_due", stripe_subscription_id: "sub_test_1" },
    ]);
    // No stripe client injected at all — the subscription id is already in the
    // payload, so the handler must not need one.
    const consumed = await handleGrantsSubscriptionEvent(
      event("invoice_payment.paid", {
        ...invoicePayment,
        invoice: { id: "in_test_1", object: "invoice", subscription: "sub_test_1" },
      }),
      { store: fake.store },
    );
    expect(consumed).toBe(true);
    expect(fake.rowFor("sub_test_1")?.status).toBe("active");
    expect(evaluateGrantsSubscription(fake.rowFor("sub_test_1")).subscribed).toBe(true);
  });

  test("invoice_payment.paid that cannot be attributed grants nothing (fail-closed)", async () => {
    const fake = fakeStore([
      { user_id: 42, status: "past_due", stripe_subscription_id: "sub_test_1" },
    ]);
    // No invoice at all → nothing to resolve, and no Stripe client is reachable.
    const consumed = await handleGrantsSubscriptionEvent(
      event("invoice_payment.paid", { ...invoicePayment, invoice: null }),
      { store: fake.store },
    );
    expect(consumed).toBe(false);
    expect(fake.writes).toHaveLength(0);
    // The existing row is untouched: still past_due, still no access.
    expect(fake.rowFor("sub_test_1")?.status).toBe("past_due");
    expect(evaluateGrantsSubscription(fake.rowFor("sub_test_1")).subscribed).toBe(false);
  });

  test("a FAILED invoice read on invoice_payment.paid grants nothing (fail-closed)", async () => {
    const fake = fakeStore([
      { user_id: 42, status: "past_due", stripe_subscription_id: "sub_test_1" },
    ]);
    const consumed = await handleGrantsSubscriptionEvent(
      event("invoice_payment.paid", invoicePayment),
      // The invoice id is unknown to Stripe → the read throws.
      { store: fake.store, stripe: fakeInvoiceStripe({}) },
    );
    expect(consumed).toBe(false);
    expect(fake.writes).toHaveLength(0);
    expect(fake.rowFor("sub_test_1")?.status).toBe("past_due");
    expect(evaluateGrantsSubscription(fake.rowFor("sub_test_1")).subscribed).toBe(false);
  });

  test("another product's invoice_payment.paid is NOT consumed and writes nothing", async () => {
    const fake = fakeStore();
    const consumed = await handleGrantsSubscriptionEvent(
      event("invoice_payment.paid", invoicePayment),
      // Resolves to a subscription with NO grants row and no grants metadata.
      { store: fake.store, stripe: fakeInvoiceStripe({ in_test_1: "sub_bid_scout_1" }) },
    );
    expect(consumed).toBe(false);
    expect(fake.writes).toHaveLength(0);
    expect(fake.rowFor("sub_bid_scout_1")).toBe(null);
  });

  test("a payload that ever DOES carry subscription/customer is used directly (no read)", async () => {
    const fake = fakeStore([
      { user_id: 42, status: "past_due", stripe_subscription_id: "sub_test_1" },
    ]);
    const consumed = await handleGrantsSubscriptionEvent(
      event("invoice_payment.paid", {
        ...invoicePayment,
        subscription: "sub_test_1",
        customer: "cus_test_1",
      }),
      // No stripe client at all: the object's own subscription is authoritative.
      { store: fake.store },
    );
    expect(consumed).toBe(true);
    expect(fake.rowFor("sub_test_1")?.status).toBe("active");
  });

  test("customer.subscription.updated syncs status (unpaid → no access)", async () => {
    const fake = fakeStore([
      { user_id: 42, status: "active", stripe_subscription_id: "sub_test_1" },
    ]);
    const consumed = await handleGrantsSubscriptionEvent(
      event("customer.subscription.updated", { ...grantsSubscription, status: "unpaid" }),
      { store: fake.store },
    );
    expect(consumed).toBe(true);
    expect(fake.rowFor("sub_test_1")?.status).toBe("unpaid");
    expect(evaluateGrantsSubscription(fake.rowFor("sub_test_1")).subscribed).toBe(false);
  });

  test("a subscription event for another product is NOT consumed and writes nothing", async () => {
    const fake = fakeStore();
    const consumed = await handleGrantsSubscriptionEvent(
      event("customer.subscription.deleted", {
        ...grantsSubscription,
        id: "sub_other_1",
        metadata: { product: "bid_scout", bidScoutId: "x" },
      }),
      { store: fake.store },
    );
    expect(consumed).toBe(false);
    expect(fake.writes).toHaveLength(0);
  });

  test("an unrelated event type is never consumed", async () => {
    const fake = fakeStore();
    expect(
      await handleGrantsSubscriptionEvent(event("charge.succeeded", { id: "ch_1" }), {
        store: fake.store,
      }),
    ).toBe(false);
    expect(
      await handleGrantsSubscriptionEvent(event("checkout.session.expired", grantsSession), {
        store: fake.store,
      }),
    ).toBe(false);
  });

  test("status mapping per event type", () => {
    expect(grantsStatusAfterEvent("checkout.session.completed")).toBe("active");
    expect(grantsStatusAfterEvent("customer.subscription.created", "trialing")).toBe("trialing");
    expect(grantsStatusAfterEvent("customer.subscription.updated", "past_due")).toBe("past_due");
    expect(grantsStatusAfterEvent("customer.subscription.deleted")).toBe("canceled");
    expect(grantsStatusAfterEvent("invoice.paid")).toBe("active");
    expect(grantsStatusAfterEvent("invoice_payment.paid")).toBe("active");
    expect(grantsStatusAfterEvent("invoice.payment_failed")).toBe("past_due");
    expect(grantsStatusAfterEvent("charge.refunded")).toBe(null);
  });

  test("period end is normalized from seconds (top level or subscription item)", () => {
    expect(periodEndIso({ current_period_end: 1_800_000_000 })).toBe("2027-01-15T08:00:00.000Z");
    expect(
      periodEndIso({ items: { data: [{ current_period_end: 1_800_000_000 }] } }),
    ).toBe("2027-01-15T08:00:00.000Z");
    expect(periodEndIso({})).toBe(null);
  });
});

// ── 6. Checkout route input validation ───────────────────────────────────────

describe("grants checkout request validation", () => {
  test("an empty body is the only valid input", () => {
    expect(validateGrantsCheckoutBody({})).toEqual({ ok: true });
  });

  test("client-supplied price/quantity/anything is rejected", () => {
    for (const body of [
      { quantity: 5 },
      { priceId: "price_attacker" },
      { price: "price_1UGmwtGdL43e7acFVAPNtBOQ" },
      { planTier: "starter" },
      { url: "https://evil.example" },
    ]) {
      const result = validateGrantsCheckoutBody(body);
      expect(result.ok).toBe(false);
    }
  });

  test("non-object bodies are rejected", () => {
    for (const body of [null, undefined, [], "x", 5, true]) {
      expect(validateGrantsCheckoutBody(body).ok).toBe(false);
    }
  });

  test("the price id comes ONLY from the env var", () => {
    expect(getGrantsPriceId({})).toBe(null);
    expect(getGrantsPriceId({ [GRANTS_PRICE_ENV]: "   " })).toBe(null);
    expect(getGrantsPriceId({ [GRANTS_PRICE_ENV]: " price_test_1 " })).toBe("price_test_1");
  });
});
