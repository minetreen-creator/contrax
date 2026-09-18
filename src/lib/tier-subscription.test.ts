/**
 * Contrax PLAN TIERS (Starter/Professional/Agency) — subscription LIFECYCLE
 * hardening tests (owner order 2026-09-18).
 *
 * Every branch of the new lifecycle handling is proven WITHOUT a database and
 * WITHOUT a Stripe key: the webhook handler takes an injected store and an
 * injected Stripe client, so each case below is a real call through the
 * production handler with a fake in-memory backend.
 *
 * Covered:
 *   1. Pure decisions — status/tier mapping for all five events, unknown statuses,
 *      revoking vs grace vs entitled, metadata tier adoption, product markers.
 *   2. shouldWriteTransition — replay-safety (a repeat delivery writes NOTHING).
 *   3. Webhook transitions — cancel/deleted downgrades the plan to 'basic',
 *      invoice.paid / invoice_payment.paid → active, invoice.payment_failed →
 *      past_due with the tier untouched.
 *   4. FAIL-CLOSED attribution — an event that cannot be attributed to a Contrax
 *      user (unknown subscription, no metadata, a Grants or Bid Scout
 *      subscription) is never acted on and writes nothing.
 *   5. The invoice_payment.paid reader — direct, expanded, one verified Stripe
 *      read, and every failure path.
 *   6. The Customer Portal — no customer, missing portal configuration (the
 *      clear 503 path), and any other Stripe failure.
 */
import { describe, expect, test } from "bun:test";
import {
  FREE_PLAN_TIER,
  NO_TIER_BILLING,
  PORTAL_NOT_CONFIGURED_MESSAGE,
  TIER_HANDLED_EVENTS,
  TIER_KNOWN_STATUSES,
  TIER_PLANS,
  TIER_REVOKING_STATUSES,
  createTierPortalSession,
  evaluateTierBilling,
  getTierBilling,
  handleTierSubscriptionEvent,
  isKnownTierStatus,
  isPortalConfigMissingError,
  isRevokingTierStatus,
  isTierPlan,
  isTierSubscriptionMetadata,
  periodEndIso,
  resolveTierInvoiceSubscriptionId,
  shouldWriteTransition,
  tierBillingAfterEvent,
  type TierBillingRow,
  type TierBillingStore,
  type TierTransitionWrite,
} from "./tier-subscription.server";

// ── Fakes ─────────────────────────────────────────────────────────────────────

function fakeUsersStore(seed: TierBillingRow[] = []) {
  const rows = new Map<number, TierBillingRow>(seed.map((r) => [r.id, { ...r }]));
  const writes: TierTransitionWrite[] = [];
  let failLookup = false;
  let failWrite = false;
  const copy = (r: TierBillingRow) => ({ ...r });
  const store: TierBillingStore = {
    async getByUserId(userId) {
      if (failLookup) throw new Error("boom");
      const row = rows.get(userId);
      return row ? copy(row) : null;
    },
    async getBySubscriptionId(subscriptionId) {
      if (failLookup) throw new Error("boom");
      const row = [...rows.values()].find(
        (r) => r.stripe_subscription_id === subscriptionId,
      );
      return row ? copy(row) : null;
    },
    async applyTransition(write) {
      if (failWrite) throw new Error("write failed");
      writes.push(write);
      const row = rows.get(write.userId);
      if (!row) return;
      row.subscription_status = write.status;
      if (write.planTier != null) row.plan_tier = write.planTier;
      if (!row.stripe_subscription_id && write.stripeSubscriptionId) {
        row.stripe_subscription_id = write.stripeSubscriptionId;
      }
      if (write.currentPeriodEnd != null) {
        row.subscription_current_period_end = write.currentPeriodEnd;
      }
    },
  };
  return {
    store,
    writes,
    rows,
    rowFor: (id: number) => rows.get(id) ?? null,
    setFailLookup: (v: boolean) => {
      failLookup = v;
    },
    setFailWrite: (v: boolean) => {
      failWrite = v;
    },
  };
}

/** Minimal Stripe stand-in: the tier handler only ever reads an invoice. */
function fakeStripeForInvoices(subscriptionByInvoice: Record<string, string | null>) {
  return {
    invoices: {
      async retrieve(id: string) {
        const subscription = subscriptionByInvoice[id];
        if (subscription === undefined) throw new Error(`No such invoice: ${id}`);
        return { id, object: "invoice", subscription };
      },
    },
  } as unknown as Parameters<typeof handleTierSubscriptionEvent>[1]["stripe"];
}

function fakeStripeForPortal(
  create: (args: unknown) => Promise<{ id: string; url?: string }>,
) {
  return {
    billingPortal: { sessions: { create } },
  } as unknown as Parameters<typeof createTierPortalSession>[1]["stripe"];
}

function event(type: string, object: Record<string, unknown>): Parameters<
  typeof handleTierSubscriptionEvent
>[0] {
  return { id: "evt_test", type, data: { object } } as unknown as Parameters<
    typeof handleTierSubscriptionEvent
  >[0];
}

const PERIOD_END_SECONDS = 1_800_000_000; // 2027-01-15T08:00:00.000Z
const PERIOD_END_ISO = "2027-01-15T08:00:00.000Z";

/** A REAL Contrax tier subscription object (shape as Stripe delivers it). */
const tierSubscription = {
  id: "sub_tier_1",
  object: "subscription",
  status: "active",
  customer: "cus_tier_1",
  metadata: { plan_tier: "professional", user_id: "7" },
  current_period_end: PERIOD_END_SECONDS,
  items: {
    data: [{ price: { id: "price_tier_professional" }, current_period_end: PERIOD_END_SECONDS }],
  },
};

const grantsSubscription = {
  id: "sub_grants_1",
  object: "subscription",
  status: "canceled",
  customer: "cus_tier_1",
  metadata: { product: "grants", user_id: "7" },
  current_period_end: PERIOD_END_SECONDS,
};

const bidScoutSubscription = {
  id: "sub_bid_scout_1",
  object: "subscription",
  status: "canceled",
  customer: "cus_tier_1",
  metadata: { product: "bid_scout", bidScoutId: "abc" },
  current_period_end: PERIOD_END_SECONDS,
};

/**
 * A REAL `invoice_payment` object (verbatim field set for `invoice_payment.paid`):
 * note there is NO `subscription` and NO `customer` on it — the subscription id
 * is only reachable through `invoice`.
 */
const invoicePayment = {
  id: "inpay_tier_1",
  object: "invoice_payment",
  amount_paid: 7900,
  amount_requested: 7900,
  created: PERIOD_END_SECONDS,
  currency: "usd",
  invoice: "in_tier_1",
  is_default: true,
  livemode: true,
  payment: { type: "payment_intent", payment_intent: "pi_tier_1" },
  status: "paid",
  status_transitions: { paid_at: PERIOD_END_SECONDS },
};

// ── 1. Constants + pure decision helpers ─────────────────────────────────────

describe("tier constants", () => {
  test("handles exactly the five lifecycle events (checkout is NOT handled here)", () => {
    expect([...TIER_HANDLED_EVENTS].sort()).toEqual(
      [
        "customer.subscription.updated",
        "customer.subscription.deleted",
        "invoice_payment.paid",
        "invoice.paid",
        "invoice.payment_failed",
      ].sort(),
    );
    expect(TIER_HANDLED_EVENTS).not.toContain("checkout.session.completed");
  });

  test("plan tiers exclude the free tier and the one-time savings price", () => {
    expect([...TIER_PLANS]).toEqual(["starter", "professional", "agency"]);
    expect(isTierPlan("starter")).toBe(true);
    expect(isTierPlan("professional")).toBe(true);
    expect(isTierPlan("agency")).toBe(true);
    for (const other of ["basic", "demo", "savings_premium", "", null, undefined, 1, {}]) {
      expect(isTierPlan(other)).toBe(false);
    }
    expect(FREE_PLAN_TIER).toBe("basic");
  });

  test("every known Stripe status is recognised, anything else is not", () => {
    for (const s of TIER_KNOWN_STATUSES) expect(isKnownTierStatus(s)).toBe(true);
    for (const s of ["weird", "", null, undefined, 5, {}]) {
      expect(isKnownTierStatus(s)).toBe(false);
    }
  });

  test("revoking statuses are exactly the non-entitling known ones", () => {
    for (const s of TIER_REVOKING_STATUSES) expect(isRevokingTierStatus(s)).toBe(true);
    for (const s of ["active", "trialing", "past_due", "weird", null]) {
      expect(isRevokingTierStatus(s)).toBe(false);
    }
  });
});

describe("tierBillingAfterEvent", () => {
  test("subscription.updated — active and trialing keep the stored tier", () => {
    expect(tierBillingAfterEvent("customer.subscription.updated", "active")).toEqual({
      status: "active",
      planTier: null,
    });
    expect(tierBillingAfterEvent("customer.subscription.updated", "trialing")).toEqual({
      status: "trialing",
      planTier: null,
    });
  });

  test("subscription.updated — past_due is a GRACE state: the tier is untouched", () => {
    expect(tierBillingAfterEvent("customer.subscription.updated", "past_due")).toEqual({
      status: "past_due",
      planTier: null,
    });
  });

  test("subscription.updated — every revoking status downgrades the plan", () => {
    for (const status of TIER_REVOKING_STATUSES) {
      expect(tierBillingAfterEvent("customer.subscription.updated", status)).toEqual({
        status,
        planTier: FREE_PLAN_TIER,
      });
    }
  });

  test("subscription.updated — an unknown/missing status changes NOTHING", () => {
    expect(tierBillingAfterEvent("customer.subscription.updated", "brand_new_status")).toBe(null);
    expect(tierBillingAfterEvent("customer.subscription.updated", null)).toBe(null);
    expect(tierBillingAfterEvent("customer.subscription.updated", undefined)).toBe(null);
  });

  test("subscription.updated — a tier in the subscription's metadata is adopted", () => {
    expect(
      tierBillingAfterEvent("customer.subscription.updated", "active", "agency"),
    ).toEqual({ status: "active", planTier: "agency" });
    // A non-tier metadata value is ignored (never guessed).
    expect(
      tierBillingAfterEvent("customer.subscription.updated", "active", "basic"),
    ).toEqual({ status: "active", planTier: null });
  });

  test("subscription.updated — revocation wins over metadata", () => {
    expect(
      tierBillingAfterEvent("customer.subscription.updated", "unpaid", "agency"),
    ).toEqual({ status: "unpaid", planTier: FREE_PLAN_TIER });
  });

  test("subscription.deleted — cancels and downgrades the plan", () => {
    expect(tierBillingAfterEvent("customer.subscription.deleted")).toEqual({
      status: "canceled",
      planTier: FREE_PLAN_TIER,
    });
  });

  test("invoice paid events → active without touching the tier", () => {
    expect(tierBillingAfterEvent("invoice.paid")).toEqual({ status: "active", planTier: null });
    expect(tierBillingAfterEvent("invoice_payment.paid")).toEqual({
      status: "active",
      planTier: null,
    });
  });

  test("invoice.payment_failed → past_due, tier untouched", () => {
    expect(tierBillingAfterEvent("invoice.payment_failed")).toEqual({
      status: "past_due",
      planTier: null,
    });
  });

  test("an unmapped event type implies nothing", () => {
    expect(tierBillingAfterEvent("charge.refunded")).toBe(null);
    expect(tierBillingAfterEvent("checkout.session.completed")).toBe(null);
  });
});

describe("isTierSubscriptionMetadata", () => {
  test("a tier metadata block proves a plan subscription", () => {
    expect(isTierSubscriptionMetadata({ plan_tier: "starter" })).toBe(true);
    expect(isTierSubscriptionMetadata({ plan_tier: "agency", user_id: "7" })).toBe(true);
    expect(isTierSubscriptionMetadata({ plan_tier: "starter", promo_code: "VAD26" })).toBe(true);
  });

  test("another product line's marker ALWAYS wins (never cross-attributed)", () => {
    expect(isTierSubscriptionMetadata({ product: "grants", plan_tier: "starter" })).toBe(false);
    expect(isTierSubscriptionMetadata({ product: "bid_scout", plan_tier: "starter" })).toBe(false);
    expect(isTierSubscriptionMetadata({ product: "grants", user_id: "7" })).toBe(false);
  });

  test("missing or non-tier metadata is not ours", () => {
    expect(isTierSubscriptionMetadata(null)).toBe(false);
    expect(isTierSubscriptionMetadata(undefined)).toBe(false);
    expect(isTierSubscriptionMetadata({})).toBe(false);
    expect(isTierSubscriptionMetadata({ plan_tier: "basic" })).toBe(false);
    expect(isTierSubscriptionMetadata({ plan_tier: "demo" })).toBe(false);
    expect(isTierSubscriptionMetadata({ user_id: "7" })).toBe(false);
  });
});

// ── 2. Replay safety ─────────────────────────────────────────────────────────

describe("shouldWriteTransition", () => {
  const row: TierBillingRow = {
    id: 7,
    plan_tier: "professional",
    subscription_status: "active",
    stripe_subscription_id: "sub_tier_1",
      subscription_current_period_end: PERIOD_END_ISO,
  };

  test("a repeat delivery writes nothing", () => {
    expect(
      shouldWriteTransition(
        row,
        { status: "active", planTier: null },
        { subscriptionId: "sub_tier_1", currentPeriodEnd: PERIOD_END_ISO },
      ),
    ).toBe(false);
  });

  test("a status change writes", () => {
    expect(
      shouldWriteTransition(row, { status: "past_due", planTier: null }, {
        subscriptionId: "sub_tier_1",
      }),
    ).toBe(true);
  });

  test("a plan downgrade writes", () => {
    expect(
      shouldWriteTransition(row, { status: "canceled", planTier: FREE_PLAN_TIER }, {
        subscriptionId: "sub_tier_1",
      }),
    ).toBe(true);
  });

  test("filling an EMPTY stored subscription id writes", () => {
    expect(
      shouldWriteTransition({ ...row, stripe_subscription_id: null }, {
        status: "active",
        planTier: null,
      }, { subscriptionId: "sub_tier_1" }),
    ).toBe(true);
  });

  test("a changed period end writes; an identical one does not", () => {
    expect(
      shouldWriteTransition(row, { status: "active", planTier: null }, {
        subscriptionId: "sub_tier_1",
        currentPeriodEnd: "2027-02-15T08:00:00.000Z",
      }),
    ).toBe(true);
    expect(
      shouldWriteTransition(row, { status: "active", planTier: null }, {
        subscriptionId: "sub_tier_1",
        currentPeriodEnd: PERIOD_END_ISO,
      }),
    ).toBe(false);
  });

  test("accepts a Date period end (pg returns Date) and still compares", () => {
    expect(
      shouldWriteTransition(
        { ...row, subscription_current_period_end: new Date(PERIOD_END_SECONDS * 1000) },
        { status: "active", planTier: null },
        { subscriptionId: "sub_tier_1", currentPeriodEnd: PERIOD_END_ISO },
      ),
    ).toBe(false);
  });
});

describe("evaluateTierBilling / getTierBilling", () => {
  test("no row → the no-subscription state", () => {
    expect(evaluateTierBilling(null)).toEqual(NO_TIER_BILLING);
    expect(NO_TIER_BILLING.isPaidTier).toBe(false);
  });

  test("a paid tier is reported as paid; 'basic' is not", () => {
    const paid = evaluateTierBilling({
      id: 7,
      plan_tier: "agency",
      subscription_status: "active",
      stripe_customer_id: "cus_tier_1",
      subscription_current_period_end: PERIOD_END_ISO,
    });
    expect(paid).toEqual({
      planTier: "agency",
      status: "active",
      currentPeriodEnd: PERIOD_END_ISO,
      stripeCustomerId: "cus_tier_1",
      isPaidTier: true,
    });
    expect(evaluateTierBilling({ id: 7, plan_tier: "basic" }).isPaidTier).toBe(false);
    expect(evaluateTierBilling({ id: 7, plan_tier: null }).isPaidTier).toBe(false);
  });

  test("a lookup failure is fail-closed (no subscription)", async () => {
    const fake = fakeUsersStore();
    fake.setFailLookup(true);
    expect(await getTierBilling(7, fake.store)).toEqual(NO_TIER_BILLING);
    // no user id → no lookup at all
    expect(await getTierBilling(null, fake.store)).toEqual(NO_TIER_BILLING);
  });
});

describe("periodEndIso", () => {
  test("normalises seconds from the top level or the subscription item", () => {
    expect(periodEndIso({ current_period_end: PERIOD_END_SECONDS })).toBe(PERIOD_END_ISO);
    expect(periodEndIso({ items: { data: [{ current_period_end: PERIOD_END_SECONDS }] } })).toBe(
      PERIOD_END_ISO,
    );
    expect(periodEndIso({})).toBe(null);
    expect(periodEndIso({ current_period_end: null })).toBe(null);
    expect(periodEndIso({ current_period_end: Number.NaN })).toBe(null);
  });
});

// ── 3./4. Webhook transitions through the production handler ────────────────

describe("tier webhook transitions", () => {
  const seedRow = (over: Partial<TierBillingRow> = {}): TierBillingRow => ({
    id: 7,
    plan_tier: "professional",
    subscription_status: "active",
    stripe_customer_id: "cus_tier_1",
    stripe_subscription_id: "sub_tier_1",
    subscription_current_period_end: null,
    ...over,
  });

  test("customer.subscription.deleted → canceled + plan downgraded to basic", async () => {
    const fake = fakeUsersStore([seedRow()]);
    const consumed = await handleTierSubscriptionEvent(
      event("customer.subscription.deleted", { ...tierSubscription, status: "canceled" }),
      { store: fake.store },
    );
    expect(consumed).toBe(true);
    expect(fake.writes).toHaveLength(1);
    expect(fake.rowFor(7)?.subscription_status).toBe("canceled");
    expect(fake.rowFor(7)?.plan_tier).toBe("basic");
    expect(fake.rowFor(7)?.subscription_current_period_end).toBe(PERIOD_END_ISO);
  });

  test("customer.subscription.updated (unpaid) → plan downgraded, access revoked", async () => {
    const fake = fakeUsersStore([seedRow()]);
    const consumed = await handleTierSubscriptionEvent(
      event("customer.subscription.updated", { ...tierSubscription, status: "unpaid" }),
      { store: fake.store },
    );
    expect(consumed).toBe(true);
    expect(fake.rowFor(7)?.subscription_status).toBe("unpaid");
    expect(fake.rowFor(7)?.plan_tier).toBe("basic");
  });

  test("customer.subscription.updated (past_due) → status set, TIER KEPT (grace)", async () => {
    const fake = fakeUsersStore([seedRow()]);
    const consumed = await handleTierSubscriptionEvent(
      event("customer.subscription.updated", { ...tierSubscription, status: "past_due" }),
      { store: fake.store },
    );
    expect(consumed).toBe(true);
    expect(fake.rowFor(7)?.subscription_status).toBe("past_due");
    expect(fake.rowFor(7)?.plan_tier).toBe("professional");
  });

  test("customer.subscription.updated (active) with a new tier adopts it", async () => {
    const fake = fakeUsersStore([seedRow()]);
    const consumed = await handleTierSubscriptionEvent(
      event("customer.subscription.updated", {
        ...tierSubscription,
        status: "active",
        metadata: { plan_tier: "agency", user_id: "7" },
      }),
      { store: fake.store },
    );
    expect(consumed).toBe(true);
    expect(fake.rowFor(7)?.plan_tier).toBe("agency");
    expect(fake.rowFor(7)?.subscription_status).toBe("active");
  });

  test("invoice.payment_failed → past_due (tier kept)", async () => {
    const fake = fakeUsersStore([seedRow()]);
    const consumed = await handleTierSubscriptionEvent(
      event("invoice.payment_failed", { id: "in_1", subscription: "sub_tier_1" }),
      { store: fake.store },
    );
    expect(consumed).toBe(true);
    expect(fake.writes).toEqual([
      {
        userId: 7,
        status: "past_due",
        planTier: null,
        stripeSubscriptionId: "sub_tier_1",
        currentPeriodEnd: null,
      },
    ]);
    expect(fake.rowFor(7)?.subscription_status).toBe("past_due");
    expect(fake.rowFor(7)?.plan_tier).toBe("professional");
  });

  test("invoice.paid recovers past_due → active", async () => {
    const fake = fakeUsersStore([seedRow({ subscription_status: "past_due" })]);
    const consumed = await handleTierSubscriptionEvent(
      event("invoice.paid", { id: "in_2", subscription: "sub_tier_1" }),
      { store: fake.store },
    );
    expect(consumed).toBe(true);
    expect(fake.rowFor(7)?.subscription_status).toBe("active");
    expect(fake.rowFor(7)?.plan_tier).toBe("professional");
  });

  test("invoice_payment.paid (real InvoicePayment shape) needs ONE verified invoice read", async () => {
    const fake = fakeUsersStore([seedRow({ subscription_status: "past_due" })]);
    const consumed = await handleTierSubscriptionEvent(
      event("invoice_payment.paid", invoicePayment),
      { store: fake.store, stripe: fakeStripeForInvoices({ in_tier_1: "sub_tier_1" }) },
    );
    expect(consumed).toBe(true);
    expect(fake.writes).toHaveLength(1);
    expect(fake.rowFor(7)?.subscription_status).toBe("active");
  });

  test("invoice_payment.paid with an EXPANDED invoice needs no Stripe client", async () => {
    const fake = fakeUsersStore([seedRow({ subscription_status: "past_due" })]);
    const consumed = await handleTierSubscriptionEvent(
      event("invoice_payment.paid", {
        ...invoicePayment,
        invoice: { id: "in_tier_1", object: "invoice", subscription: "sub_tier_1" },
      }),
      // No stripe client injected at all.
      { store: fake.store },
    );
    expect(consumed).toBe(true);
    expect(fake.rowFor(7)?.subscription_status).toBe("active");
  });

  test("REPLAY: a second identical delivery performs NO write", async () => {
    const fake = fakeUsersStore([seedRow({ subscription_status: "past_due" })]);
    const payload = event("invoice.paid", { id: "in_3", subscription: "sub_tier_1" });
    expect(await handleTierSubscriptionEvent(payload, { store: fake.store })).toBe(true);
    expect(fake.writes).toHaveLength(1);
    expect(await handleTierSubscriptionEvent(payload, { store: fake.store })).toBe(true);
    expect(fake.writes).toHaveLength(1); // unchanged — nothing re-written
  });

  test("an event already reflected in the stored row is consumed without writing", async () => {
    const fake = fakeUsersStore([
      seedRow({
        subscription_status: "canceled",
        plan_tier: "basic",
        subscription_current_period_end: PERIOD_END_ISO,
      }),
    ]);
    const consumed = await handleTierSubscriptionEvent(
      event("customer.subscription.deleted", { ...tierSubscription, status: "canceled" }),
      { store: fake.store },
    );
    expect(consumed).toBe(true);
    expect(fake.writes).toHaveLength(0);
  });

  test("an unknown status on an update is consumed but changes nothing", async () => {
    const fake = fakeUsersStore([seedRow()]);
    const consumed = await handleTierSubscriptionEvent(
      event("customer.subscription.updated", { ...tierSubscription, status: "brand_new" }),
      { store: fake.store },
    );
    expect(consumed).toBe(true);
    expect(fake.writes).toHaveLength(0);
    expect(fake.rowFor(7)?.subscription_status).toBe("active");
  });

  test("a checkout.session.completed is NEVER consumed here (existing flow owns it)", async () => {
    const fake = fakeUsersStore([seedRow()]);
    const consumed = await handleTierSubscriptionEvent(
      event("checkout.session.completed", {
        id: "cs_test",
        object: "checkout.session",
        metadata: { plan_tier: "starter", user_id: "7" },
        customer: "cus_tier_1",
        subscription: "sub_tier_1",
      }),
      { store: fake.store },
    );
    expect(consumed).toBe(false);
    expect(fake.writes).toHaveLength(0);
  });

  test("an unrelated event type is never consumed", async () => {
    const fake = fakeUsersStore([seedRow()]);
    for (const type of ["charge.succeeded", "customer.created", "payment_intent.succeeded"]) {
      expect(await handleTierSubscriptionEvent(event(type, { id: "x" }), { store: fake.store })).toBe(false);
    }
    expect(fake.writes).toHaveLength(0);
  });
});

describe("tier webhook attribution is FAIL-CLOSED", () => {
  const seedRow = (over: Partial<TierBillingRow> = {}): TierBillingRow => ({
    id: 7,
    plan_tier: "professional",
    subscription_status: "active",
    stripe_customer_id: "cus_tier_1",
    stripe_subscription_id: "sub_tier_1",
    ...over,
  });

  test("a subscription we have no row for and no metadata for is NOT consumed", async () => {
    const fake = fakeUsersStore([seedRow()]);
    const consumed = await handleTierSubscriptionEvent(
      event("customer.subscription.updated", {
        ...tierSubscription,
        id: "sub_unknown_1",
        metadata: {},
        status: "canceled",
      }),
      { store: fake.store },
    );
    expect(consumed).toBe(false);
    expect(fake.writes).toHaveLength(0);
    expect(fake.rowFor(7)?.plan_tier).toBe("professional");
  });

  test("a GRANTS subscription's lifecycle event is never attributed to a plan", async () => {
    const fake = fakeUsersStore([seedRow()]);
    const consumed = await handleTierSubscriptionEvent(
      event("customer.subscription.deleted", grantsSubscription),
      { store: fake.store },
    );
    expect(consumed).toBe(false);
    expect(fake.writes).toHaveLength(0);
    expect(fake.rowFor(7)?.plan_tier).toBe("professional"); // untouched
  });

  test("a BID SCOUT subscription's lifecycle event is never attributed to a plan", async () => {
    const fake = fakeUsersStore([seedRow()]);
    const consumed = await handleTierSubscriptionEvent(
      event("customer.subscription.updated", { ...bidScoutSubscription, status: "active" }),
      { store: fake.store },
    );
    expect(consumed).toBe(false);
    expect(fake.writes).toHaveLength(0);
    expect(fake.rowFor(7)?.subscription_status).toBe("active");
  });

  test("an invoice event for a Grants subscription is never attributed", async () => {
    const fake = fakeUsersStore([seedRow()]);
    const consumed = await handleTierSubscriptionEvent(
      event("invoice.paid", {
        id: "in_grants",
        subscription: "sub_grants_1",
      }),
      { store: fake.store },
    );
    // No users row holds that subscription id → not ours.
    expect(consumed).toBe(false);
    expect(fake.writes).toHaveLength(0);
  });

  test("metadata attribution FILLS an empty subscription id (missed checkout webhook)", async () => {
    const fake = fakeUsersStore([
      { id: 7, plan_tier: "professional", subscription_status: null, stripe_subscription_id: null },
    ]);
    const consumed = await handleTierSubscriptionEvent(
      event("customer.subscription.updated", { ...tierSubscription, status: "active" }),
      { store: fake.store },
    );
    expect(consumed).toBe(true);
    expect(fake.rowFor(7)?.subscription_status).toBe("active");
    expect(fake.rowFor(7)?.stripe_subscription_id).toBe("sub_tier_1");
  });

  test("metadata attribution NEVER clobbers a different stored subscription", async () => {
    const fake = fakeUsersStore([
      {
        id: 7,
        plan_tier: "professional",
        subscription_status: "active",
        stripe_subscription_id: "sub_NEWER",
      },
    ]);
    const consumed = await handleTierSubscriptionEvent(
      event("customer.subscription.deleted", { ...tierSubscription, status: "canceled" }),
      { store: fake.store },
    );
    expect(consumed).toBe(false);
    expect(fake.writes).toHaveLength(0);
    // The newer subscription's plan is untouched by a late event for the old one.
    expect(fake.rowFor(7)?.plan_tier).toBe("professional");
    expect(fake.rowFor(7)?.stripe_subscription_id).toBe("sub_NEWER");
  });

  test("metadata naming a user that does not exist is not consumed", async () => {
    const fake = fakeUsersStore([seedRow()]);
    const consumed = await handleTierSubscriptionEvent(
      event("customer.subscription.deleted", {
        ...tierSubscription,
        id: "sub_unknown_2",
        metadata: { plan_tier: "starter", user_id: "999" },
      }),
      { store: fake.store },
    );
    expect(consumed).toBe(false);
    expect(fake.writes).toHaveLength(0);
  });

  test("a non-numeric metadata user_id can never be attributed", async () => {
    const fake = fakeUsersStore([seedRow()]);
    for (const userId of ["abc", "", "7; DROP TABLE users", "7.5", {}]) {
      expect(
        await handleTierSubscriptionEvent(
          event("customer.subscription.deleted", {
            ...tierSubscription,
            id: "sub_unknown_3",
            metadata: { plan_tier: "starter", user_id: userId },
          }),
          { store: fake.store },
        ),
      ).toBe(false);
    }
    expect(fake.writes).toHaveLength(0);
    expect(fake.rowFor(7)?.plan_tier).toBe("professional");
  });

  test("an unattributable invoice_payment.paid writes nothing (no invoice to read)", async () => {
    const fake = fakeUsersStore([seedRow({ subscription_status: "past_due" })]);
    const consumed = await handleTierSubscriptionEvent(
      event("invoice_payment.paid", { ...invoicePayment, invoice: null }),
      { store: fake.store },
    );
    expect(consumed).toBe(false);
    expect(fake.writes).toHaveLength(0);
    expect(fake.rowFor(7)?.subscription_status).toBe("past_due");
  });

  test("a FAILED invoice read on invoice_payment.paid writes nothing", async () => {
    const fake = fakeUsersStore([seedRow({ subscription_status: "past_due" })]);
    const consumed = await handleTierSubscriptionEvent(
      event("invoice_payment.paid", invoicePayment),
      { store: fake.store, stripe: fakeStripeForInvoices({}) },
    );
    expect(consumed).toBe(false);
    expect(fake.writes).toHaveLength(0);
    expect(fake.rowFor(7)?.subscription_status).toBe("past_due");
  });

  test("a store failure never crashes the shared webhook and writes nothing", async () => {
    const fake = fakeUsersStore([seedRow()]);
    fake.setFailLookup(true);
    const consumed = await handleTierSubscriptionEvent(
      event("customer.subscription.deleted", { ...tierSubscription, status: "canceled" }),
      { store: fake.store },
    );
    expect(consumed).toBe(true); // ours → the checkout-only flow must not see it
    expect(fake.writes).toHaveLength(0);
    expect(fake.rowFor(7)?.plan_tier).toBe("professional");
  });

  test("a failed WRITE is contained (the handler still acknowledges)", async () => {
    const fake = fakeUsersStore([seedRow()]);
    fake.setFailWrite(true);
    const consumed = await handleTierSubscriptionEvent(
      event("invoice.payment_failed", { id: "in_x", subscription: "sub_tier_1" }),
      { store: fake.store },
    );
    expect(consumed).toBe(true);
    expect(fake.rowFor(7)?.subscription_status).toBe("active"); // unchanged
  });
});

describe("resolveTierInvoiceSubscriptionId", () => {
  const noStripe = async () => undefined;

  test("reads a direct subscription without touching Stripe", async () => {
    expect(await resolveTierInvoiceSubscriptionId({ subscription: "sub_direct" }, noStripe)).toBe(
      "sub_direct",
    );
    expect(
      await resolveTierInvoiceSubscriptionId({ subscription: { id: "sub_obj" } }, noStripe),
    ).toBe("sub_obj");
  });

  test("reads an expanded invoice without touching Stripe", async () => {
    expect(
      await resolveTierInvoiceSubscriptionId(
        { invoice: { id: "in_1", subscription: "sub_expanded" } },
        noStripe,
      ),
    ).toBe("sub_expanded");
  });

  test("falls back to ONE verified invoice read for an invoice id only", async () => {
    const stripe = fakeStripeForInvoices({ in_1: "sub_read" });
    expect(
      await resolveTierInvoiceSubscriptionId({ invoice: "in_1" }, async () => stripe),
    ).toBe("sub_read");
  });

  test("every unresolvable shape returns null (fail-closed)", async () => {
    expect(await resolveTierInvoiceSubscriptionId({}, noStripe)).toBe(null);
    expect(await resolveTierInvoiceSubscriptionId({ invoice: null }, noStripe)).toBe(null);
    expect(
      await resolveTierInvoiceSubscriptionId({ invoice: "in_missing" }, async () =>
        fakeStripeForInvoices({}),
      ),
    ).toBe(null);
    expect(await resolveTierInvoiceSubscriptionId({ invoice: "in_1" }, noStripe)).toBe(null);
  });
});

// ── 6. Customer Portal ──────────────────────────────────────────────────────

describe("tier Customer Portal", () => {
  const subscribed = {
    id: 7,
    plan_tier: "professional",
    subscription_status: "active",
    stripe_customer_id: "cus_tier_1",
    stripe_subscription_id: "sub_tier_1",
  };

  test("recognises the missing-portal-configuration error", () => {
    expect(
      isPortalConfigMissingError(
        new Error(
          "No configuration provided and your test mode default configuration has not been created.",
        ),
      ),
    ).toBe(true);
    expect(isPortalConfigMissingError({ message: "No default configuration found" })).toBe(true);
    expect(
      isPortalConfigMissingError({ code: "billing_portal_configuration_missing", message: "x" }),
    ).toBe(true);
    expect(isPortalConfigMissingError(new Error("Network error"))).toBe(false);
    expect(isPortalConfigMissingError(undefined)).toBe(false);
  });

  test("opens a portal session for a user with a Stripe customer", async () => {
    const fake = fakeUsersStore([subscribed]);
    let args: unknown = null;
    const stripe = fakeStripeForPortal(async (a) => {
      args = a;
      return { id: "bps_1", url: "https://billing.stripe.com/session/1" };
    });
    const result = await createTierPortalSession(7, { store: fake.store, stripe });
    expect(result).toEqual({ success: true, url: "https://billing.stripe.com/session/1" });
    expect(args).toMatchObject({ customer: "cus_tier_1" });
    expect((args as { return_url: string }).return_url).toContain("/settings");
  });

  test("a user with no Stripe customer gets no portal (and no Stripe call)", async () => {
    const fake = fakeUsersStore([
      { id: 7, plan_tier: "basic", subscription_status: null, stripe_customer_id: null },
    ]);
    let called = false;
    const stripe = fakeStripeForPortal(async () => {
      called = true;
      return { id: "bps_x", url: "https://billing.stripe.com/x" };
    });
    const result = await createTierPortalSession(7, { store: fake.store, stripe });
    expect(result.success).toBe(false);
    expect(result.code).toBe("stripe_error");
    expect(called).toBe(false);
  });

  test("a MISSING portal configuration is reported clearly (503 path)", async () => {
    const fake = fakeUsersStore([subscribed]);
    const stripe = fakeStripeForPortal(async () => {
      throw new Error(
        "No configuration provided and your live mode default configuration has not been created.",
      );
    });
    const result = await createTierPortalSession(7, { store: fake.store, stripe });
    expect(result.success).toBe(false);
    expect(result.code).toBe("portal_not_configured");
    expect(result.error).toBe(PORTAL_NOT_CONFIGURED_MESSAGE);
  });

  test("any other Stripe failure is a generic failure (500 path)", async () => {
    const fake = fakeUsersStore([subscribed]);
    const stripe = fakeStripeForPortal(async () => {
      throw new Error("Stripe is having a moment");
    });
    const result = await createTierPortalSession(7, { store: fake.store, stripe });
    expect(result.success).toBe(false);
    expect(result.code).toBe("stripe_error");
    expect(result.error).not.toBe(PORTAL_NOT_CONFIGURED_MESSAGE);
  });

  test("a session without a url is a failure, never a silent success", async () => {
    const fake = fakeUsersStore([subscribed]);
    const stripe = fakeStripeForPortal(async () => ({ id: "bps_2" }));
    const result = await createTierPortalSession(7, { store: fake.store, stripe });
    expect(result.success).toBe(false);
    expect(result.code).toBe("stripe_error");
  });
});
