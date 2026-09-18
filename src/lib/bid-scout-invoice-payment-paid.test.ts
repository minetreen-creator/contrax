/**
 * Bid Scout paid-recovery webhook — `invoice_payment.paid` (owner fix order
 * 2026-09-18).
 *
 * The gap: Stripe sends `invoice_payment.paid` (the newer payment-level event)
 * on successful subscription payments, and the live webhook endpoint
 * (we_1UH6Tv…, 7 events) is subscribed to BOTH `invoice.paid` and
 * `invoice_payment.paid`. The handler only dispatched paid-recovery on
 * `invoice.paid`, so a payment surfaced as `invoice_payment.paid` left the
 * `bid_scout_subscriptions` row stuck in past_due (no recovery credit).
 *
 * These tests pin the mirrored Grants pattern (#396):
 *   • BOTH event names take the SAME past_due → active recovery branch;
 *   • an `invoice_payment` object has NO `subscription`/`customer` field, so the
 *     subscription is resolved through its `invoice` (expanded inline, else ONE
 *     verified GET /v1/invoices/:id) — never inferred;
 *   • unresolvable/unverified → FAIL-CLOSED: log, no row change, not consumed;
 *   • `invoice.paid` behavior is unchanged (no regression).
 *
 * The DB and Stripe surfaces are both injected: `~/db` is mocked (the module's
 * real client is a thin tagged-template HTTP wrapper) and the narrow Stripe
 * stub carries the same `subscriptions.retrieve` / `invoices.retrieve` shape
 * the production client satisfies structurally.
 */
import { beforeEach, describe, expect, mock, test } from "bun:test";

// ── Fake DB ──────────────────────────────────────────────────────────────────
//
// Rows keyed by stripe_subscription_id, mirroring the guarded UPDATEs the
// handler issues. Every statement the handler runs is recorded so a test can
// assert that NOTHING was written on the fail-closed paths.

interface FakeRow {
  id: string;
  subscriptionId: string;
  status: string;
}

const rows = new Map<string, FakeRow>();
const statements: string[] = [];
const invoiceReads: string[] = [];
const subscriptionReads: string[] = [];

// `~/lib/stripe` → `~/lib/email` → `resend`, and in this sandbox node_modules
// lives at /opt (symlinked) where resend's OWN dependency (postal-mime) is not
// resolvable from resend's real path. Nothing on the webhook path sends email,
// so the package is stubbed purely so the import chain loads.
mock.module("resend", () => ({
  Resend: class {
    emails = { send: async () => ({ id: "stubbed" }) };
  },
}));

mock.module("~/db", () => ({
  sql: () => async (strings: TemplateStringsArray, ...values: unknown[]) => {
    const text = strings.join(" ? ").replace(/\s+/g, " ").trim();
    statements.push(text);
    if (text.includes("SELECT id FROM bid_scout_subscriptions")) {
      const subId = String(values[0]);
      const row = rows.get(subId);
      return row ? [{ id: row.id }] : [];
    }
    if (text.includes("UPDATE bid_scout_subscriptions")) {
      const subId = String(values[0]);
      const row = rows.get(subId);
      if (text.includes("SET status = 'past_due'")) {
        if (row && (row.status === "active" || row.status === "pending")) {
          row.status = "past_due";
        }
      } else if (text.includes("SET status = 'active'")) {
        if (row && row.status === "past_due") row.status = "active";
      } else if (text.includes("SET status = 'cancelled'")) {
        if (row && row.status !== "cancelled") row.status = "cancelled";
      }
      return [];
    }
    return [];
  },
}));

const { handleBidScoutSubscriptionEvent } = await import("~/lib/bid-scout");

// ── Stripe stub ──────────────────────────────────────────────────────────────

/** A REAL `invoice_payment` object, verbatim field set. Note what is NOT here:
 *  no `subscription` and no `customer` — verified against the Stripe OpenAPI
 *  spec (components.schemas.invoice_payment) and stripe@22's
 *  resources/InvoicePayments.d.ts. */
function invoicePayment(invoice: unknown) {
  return {
    id: "inpay_test_1",
    object: "invoice_payment",
    amount_paid: 9900,
    amount_requested: 9900,
    created: 1_800_000_000,
    currency: "usd",
    invoice,
    is_default: true,
    livemode: false,
    payment: { type: "payment_intent", payment_intent: "pi_test_1" },
    status: "paid",
    status_transitions: { paid_at: 1_800_000_000 },
  };
}

/** Minimal Stripe stand-in: subscription verify (product tag) + invoice read. */
function stripeStub(opts: {
  product?: string | null;
  invoiceSubscription?: Record<string, string | null>;
  invoiceReadFails?: boolean;
  subscriptionReadFails?: boolean;
}) {
  return {
    subscriptions: {
      async retrieve(id: string) {
        subscriptionReads.push(id);
        if (opts.subscriptionReadFails) throw new Error(`No such subscription: ${id}`);
        return {
          id,
          metadata:
            opts.product === null ? {} : { product: opts.product ?? "bid_scout" },
        };
      },
    },
    invoices: {
      async retrieve(id: string) {
        invoiceReads.push(id);
        if (opts.invoiceReadFails) throw new Error(`No such invoice: ${id}`);
        const subscription = (opts.invoiceSubscription ?? {})[id];
        if (subscription === undefined) throw new Error(`No such invoice: ${id}`);
        return { id, object: "invoice", subscription, customer: "cus_test_1" };
      },
    },
  };
}

function event(type: string, object: Record<string, unknown>) {
  return { id: `evt_${type}`, type, data: { object } } as unknown as Parameters<
    typeof handleBidScoutSubscriptionEvent
  >[0];
}

const SUB = "sub_bs_1";

beforeEach(() => {
  rows.clear();
  statements.length = 0;
  invoiceReads.length = 0;
  subscriptionReads.length = 0;
});

// ── invoice_payment.paid — the event the LIVE endpoint is configured with ─────

describe("bid-scout invoice_payment.paid recovery", () => {
  test("real InvoicePayment shape recovers past_due → active via the invoice read", async () => {
    rows.set(SUB, { id: "rec_1", subscriptionId: SUB, status: "past_due" });
    const stripe = stripeStub({ invoiceSubscription: { in_test_1: SUB } });

    const consumed = await handleBidScoutSubscriptionEvent(
      event("invoice_payment.paid", invoicePayment("in_test_1")),
      stripe as never,
    );

    expect(consumed).toBe(true);
    expect(invoiceReads).toEqual(["in_test_1"]);
    expect(subscriptionReads).toEqual([SUB]);
    expect(rows.get(SUB)!.status).toBe("active");
  });

  test("an EXPANDED invoice needs no extra Stripe read", async () => {
    rows.set(SUB, { id: "rec_1", subscriptionId: SUB, status: "past_due" });
    const stripe = stripeStub({});

    const consumed = await handleBidScoutSubscriptionEvent(
      event("invoice_payment.paid", {
        ...invoicePayment({ id: "in_test_1", object: "invoice", subscription: SUB }),
      }),
      stripe as never,
    );

    expect(consumed).toBe(true);
    expect(invoiceReads).toEqual([]);
    expect(rows.get(SUB)!.status).toBe("active");
  });

  test("unresolvable invoice (no invoice id at all) fails closed: no read, no change, not consumed", async () => {
    rows.set(SUB, { id: "rec_1", subscriptionId: SUB, status: "past_due" });
    const stripe = stripeStub({ invoiceSubscription: { in_test_1: SUB } });

    const consumed = await handleBidScoutSubscriptionEvent(
      event("invoice_payment.paid", invoicePayment(null)),
      stripe as never,
    );

    expect(consumed).toBe(false);
    expect(invoiceReads).toEqual([]);
    expect(subscriptionReads).toEqual([]);
    expect(statements).toEqual([]); // nothing was written
    expect(rows.get(SUB)!.status).toBe("past_due");
  });

  test("a FAILED invoice read fails closed: no change, not consumed", async () => {
    rows.set(SUB, { id: "rec_1", subscriptionId: SUB, status: "past_due" });
    const stripe = stripeStub({ invoiceReadFails: true });

    const consumed = await handleBidScoutSubscriptionEvent(
      event("invoice_payment.paid", invoicePayment("in_test_1")),
      stripe as never,
    );

    expect(consumed).toBe(false);
    expect(invoiceReads).toEqual(["in_test_1"]);
    expect(statements).toEqual([]);
    expect(rows.get(SUB)!.status).toBe("past_due");
  });

  test("an invoice whose subscription is null fails closed (no fabricated attribution)", async () => {
    rows.set(SUB, { id: "rec_1", subscriptionId: SUB, status: "past_due" });
    const stripe = stripeStub({ invoiceSubscription: { in_test_1: null } });

    const consumed = await handleBidScoutSubscriptionEvent(
      event("invoice_payment.paid", invoicePayment("in_test_1")),
      stripe as never,
    );

    expect(consumed).toBe(false);
    expect(statements).toEqual([]);
    expect(rows.get(SUB)!.status).toBe("past_due");
  });

  test("a resolved subscription with NO bid_scout row is not consumed and writes nothing", async () => {
    const stripe = stripeStub({ invoiceSubscription: { in_test_1: "sub_other_1" } });

    const consumed = await handleBidScoutSubscriptionEvent(
      event("invoice_payment.paid", invoicePayment("in_test_1")),
      stripe as never,
    );

    expect(consumed).toBe(false);
    expect(statements.filter((s) => s.includes("UPDATE"))).toEqual([]);
  });

  test("a row whose LIVE subscription is not tagged bid_scout is not reactivated", async () => {
    rows.set(SUB, { id: "rec_1", subscriptionId: SUB, status: "past_due" });
    const stripe = stripeStub({
      product: null,
      invoiceSubscription: { in_test_1: SUB },
    });

    const consumed = await handleBidScoutSubscriptionEvent(
      event("invoice_payment.paid", invoicePayment("in_test_1")),
      stripe as never,
    );

    expect(consumed).toBe(false);
    expect(rows.get(SUB)!.status).toBe("past_due");
  });

  test("a failed subscription verify (API error) fails closed", async () => {
    rows.set(SUB, { id: "rec_1", subscriptionId: SUB, status: "past_due" });
    const stripe = stripeStub({
      subscriptionReadFails: true,
      invoiceSubscription: { in_test_1: SUB },
    });

    const consumed = await handleBidScoutSubscriptionEvent(
      event("invoice_payment.paid", invoicePayment("in_test_1")),
      stripe as never,
    );

    expect(consumed).toBe(false);
    expect(rows.get(SUB)!.status).toBe("past_due");
  });

  test("a cancelled row is never reactivated by invoice_payment.paid", async () => {
    rows.set(SUB, { id: "rec_1", subscriptionId: SUB, status: "cancelled" });
    const stripe = stripeStub({ invoiceSubscription: { in_test_1: SUB } });

    const consumed = await handleBidScoutSubscriptionEvent(
      event("invoice_payment.paid", invoicePayment("in_test_1")),
      stripe as never,
    );

    // Ours and verified, but the guarded UPDATE matches nothing.
    expect(consumed).toBe(true);
    expect(rows.get(SUB)!.status).toBe("cancelled");
  });

  test("replay is a no-op (already active stays active)", async () => {
    rows.set(SUB, { id: "rec_1", subscriptionId: SUB, status: "active" });
    const stripe = stripeStub({ invoiceSubscription: { in_test_1: SUB } });

    const consumed = await handleBidScoutSubscriptionEvent(
      event("invoice_payment.paid", invoicePayment("in_test_1")),
      stripe as never,
    );

    expect(consumed).toBe(true);
    expect(rows.get(SUB)!.status).toBe("active");
  });
});

// ── invoice.paid — NO REGRESSION ─────────────────────────────────────────────

describe("bid-scout invoice.paid (existing behavior, no regression)", () => {
  test("invoice.paid recovers past_due → active without any invoice read", async () => {
    rows.set(SUB, { id: "rec_1", subscriptionId: SUB, status: "past_due" });
    const stripe = stripeStub({});

    const consumed = await handleBidScoutSubscriptionEvent(
      event("invoice.paid", { id: "in_1", object: "invoice", subscription: SUB }),
      stripe as never,
    );

    expect(consumed).toBe(true);
    expect(invoiceReads).toEqual([]); // Invoice carries `subscription` directly
    expect(rows.get(SUB)!.status).toBe("active");
  });

  test("a regular-plan invoice.paid is not consumed and changes nothing", async () => {
    const stripe = stripeStub({});

    const consumed = await handleBidScoutSubscriptionEvent(
      event("invoice.paid", { id: "in_2", object: "invoice", subscription: "sub_plan_1" }),
      stripe as never,
    );

    expect(consumed).toBe(false);
    expect(statements.filter((s) => s.includes("UPDATE"))).toEqual([]);
  });

  test("an invoice.paid with no subscription is not consumed (unchanged)", async () => {
    const stripe = stripeStub({});

    const consumed = await handleBidScoutSubscriptionEvent(
      event("invoice.paid", { id: "in_3", object: "invoice" }),
      stripe as never,
    );

    expect(consumed).toBe(false);
    expect(statements).toEqual([]);
  });
});

// ── invoice.payment_failed — unchanged dispatch still reaches past_due ────────

describe("bid-scout invoice.payment_failed (unchanged)", () => {
  test("flips an active row to past_due and is consumed", async () => {
    rows.set(SUB, { id: "rec_1", subscriptionId: SUB, status: "active" });

    const consumed = await handleBidScoutSubscriptionEvent(
      event("invoice.payment_failed", {
        id: "in_4",
        object: "invoice",
        subscription: SUB,
      }),
    );

    expect(consumed).toBe(true);
    expect(rows.get(SUB)!.status).toBe("past_due");
  });
});
