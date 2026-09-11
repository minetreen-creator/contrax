import { createFileRoute } from "@tanstack/react-router";
import { sql } from "~/db";
import { getUserFromRequest } from "~/lib/api-auth";
import { qaUserExclusionSQL } from "~/lib/qa-exclusion";
import { getStripe } from "~/lib/stripe";
import {
  computeMrrBreakdown,
  isBidScoutSubscription,
} from "~/lib/finance-mrr";
import { BID_SCOUT_PRICE_USD } from "~/lib/bid-scout";

/**
 * GET /api/admin/finance
 *
 * Admin-only LIVE MRR scoreboard (owner 2026-09-07 — "the number we're trying
 * to change"). NEVER hardcoded: every figure is read live on each request.
 *
 * Source strategy (honest labeling via `source`):
 *   1. `stripe-live` (preferred) — sums the ACTUAL active Stripe subscriptions
 *      (unit_amount × quantity over recurring prices), so partner/VAD pricing
 *      ($14/$59/$149) and any future price change are reflected exactly.
 *      Customer count = distinct Stripe customers with an active subscription.
 *   2. `app-db` (fail-open fallback) — aggregates the users table rows the
 *      Stripe webhook maintains (subscription_status = 'active'), valued at
 *      list prices ($19/$79/$199). Used when the Stripe API is unreachable or
 *      STRIPE_SECRET_KEY is unset. QA/test accounts, admins, and demo-tier
 *      rows are excluded with the same helpers as every admin surface.
 *
 * The paying-customers email list ALWAYS comes from the app DB (Stripe has no
 * QA concept; the DB join on stripe_customer_id resolves display emails, and
 * rows that can't be resolved are simply omitted — never fabricated).
 *
 * READ-ONLY: SELECTs + one Stripe list call. No migration, no writes.
 */

const LIST_MRR_CENTS: Record<string, number> = {
  starter: 1900, // $19/mo
  professional: 7900, // $79/mo
  agency: 19900, // $199/mo
};

interface TierRow {
  tier: string;
  customers: number;
  mrrCents: number;
}

interface PayingCustomer {
  email: string;
  planTier: string | null;
  since: string | null;
}

async function readDbTiers(): Promise<{ tiers: TierRow[]; customers: PayingCustomer[] }> {
  const qaExcl = qaUserExclusionSQL("");
  const tierRows: any[] = await sql()`
    SELECT plan_tier, COUNT(*) AS n FROM users
    WHERE subscription_status = 'active'
      AND plan_tier IN ('starter', 'professional', 'agency')
      AND is_admin = false AND plan_tier <> 'demo'
      AND ${sql().unsafe(qaExcl)}
    GROUP BY plan_tier`;
  const tiers: TierRow[] = (tierRows as any[]).map((r) => ({
    tier: String(r.plan_tier),
    customers: Number(r.n ?? 0),
    mrrCents: Number(r.n ?? 0) * (LIST_MRR_CENTS[String(r.plan_tier)] ?? 0),
  }));
  let customers: PayingCustomer[] = [];
  try {
    const custRows: any[] = await sql()`
      SELECT email, plan_tier, created_at FROM users
      WHERE subscription_status = 'active'
        AND plan_tier IN ('starter', 'professional', 'agency')
        AND is_admin = false AND plan_tier <> 'demo'
        AND ${sql().unsafe(qaExcl)}
      ORDER BY created_at DESC LIMIT 100`;
    customers = (custRows as any[]).map((r) => ({
      email: String(r.email),
      planTier: r.plan_tier ?? null,
      since: r.created_at ? new Date(r.created_at).toISOString() : null,
    }));
  } catch (err) {
    console.error("[api/admin/finance] paying-customers list failed (continuing):", err);
  }
  return { tiers, customers };
}

async function handler({ request }: { request: Request }) {
  const user = await getUserFromRequest(request);
  if (!user) return Response.json({ error: "Not authenticated" }, { status: 401 });
  if (!user.is_admin) return Response.json({ error: "Admin access required" }, { status: 403 });

  // DB truth first (cheap, always available): tiers + customer emails with the
  // standard QA/admin/demo exclusions.
  let tiers: TierRow[] = [];
  let customers: PayingCustomer[] = [];
  try {
    const db = await readDbTiers();
    tiers = db.tiers;
    customers = db.customers;
  } catch (err) {
    console.error("[api/admin/finance] db aggregation failed (continuing):", err);
  }

  // Split MRR: existing Contrax plans vs the SEPARATE Bid Scout product
  // (owner 2026-09-11). Forward-compatible — both present even when 0.
  let existingPlanMrr = 0;
  let bidScoutMrr = 0;
  let totalMrr = 0;
  let bidScoutCustomers = 0;
  let display: { label: string; amount: number; product: "bid_scout" }[] = [];

  // Preferred: live Stripe read of actual active subscriptions.
  let mrrCents = tiers.reduce((sum, t) => sum + t.mrrCents, 0);
  let customerCount = tiers.reduce((sum, t) => sum + t.customers, 0);
  let source: "stripe-live" | "app-db" = "app-db";
  let truncated = false;
  try {
    // DB fallback baseline: Bid Scout MRR from the subscription rows the
    // webhook maintains ($99/active) — used only when Stripe is unreachable.
    try {
      const qaExcl = qaUserExclusionSQL("");
      const bsRows: any[] = await sql()`
        SELECT COUNT(*)::int AS n FROM bid_scout_subscriptions
        WHERE status = 'active'
          AND ${sql().unsafe(qaExcl)}
          AND LOWER(COALESCE(email, '')) NOT IN (${[...ADMIN_EMAILS].map((e) => e.toLowerCase())})`;
      const n = Number(bsRows?.[0]?.n ?? 0);
      bidScoutMrr = n * BID_SCOUT_PRICE_USD;
      bidScoutCustomers = n;
    } catch (err) {
      console.error("[api/admin/finance] bid-scout DB mrr read failed (continuing):", err);
    }
    const stripe = getStripe();
    const subs = await stripe.subscriptions.list({
      status: "active",
      limit: 100,
      expand: ["data.items.data.price"],
    });
    truncated = subs.has_more;
    // A SUCCESSFUL Stripe list is authoritative (an empty list means genuinely
    // no active subscriptions — same semantics as the pre-Bid-Scout code).
    const breakdown = computeMrrBreakdown(subs.data as never[]);
    existingPlanMrr = breakdown.existingPlanMrr;
    bidScoutMrr = breakdown.bidScoutMrr;
    bidScoutCustomers = breakdown.bidScoutCustomers;
    totalMrr = existingPlanMrr + bidScoutMrr;
    display = [{ label: "Bid Scout MRR", amount: bidScoutMrr, product: "bid_scout" }];
    mrrCents = totalMrr; // stays the true TOTAL (existing plans + Bid Scout)
    // Customers = distinct holders of an EXISTING-plan active subscription.
    // Bid Scout customers are reported separately (bidScoutCustomers + the
    // separate Bid Scout MRR line) — never merged, never double-counted.
    customerCount = breakdown.existingCustomers;
    source = "stripe-live";
    // Resolve display emails for live Stripe customers via the webhook-written
    // stripe_customer_id (fail-open; unresolved customers simply show no email).
    const liveCustomers = subs.data
      .filter((s) => !isBidScoutSubscription(s as never))
      .map((s) =>
        typeof s.customer === "string" ? s.customer : (s.customer as any)?.id,
      )
      .filter((id): id is string => !!id);
    if (liveCustomers.length > 0) {
      try {
        const ids = [...liveCustomers];
        const emailRows: any[] = await sql()`
          SELECT email, plan_tier, created_at FROM users
          WHERE stripe_customer_id = ANY(${ids})
            AND ${sql().unsafe(qaUserExclusionSQL(""))}
          ORDER BY created_at DESC LIMIT 100`;
        customers = (emailRows as any[]).map((r) => ({
          email: String(r.email),
          planTier: r.plan_tier ?? null,
          since: r.created_at ? new Date(r.created_at).toISOString() : null,
        }));
      } catch (err) {
        console.error("[api/admin/finance] stripe-customer email resolve failed (continuing):", err);
      }
    } else {
      customers = [];
    }
  } catch (err) {
    // Fail-open to the DB aggregation above (source stays "app-db"). Keep the
    // split invariant: existingPlanMrr = the DB plan MRR, bidScoutMrr from the
    // subscription rows read above, total = existing + bid scout.
    existingPlanMrr = mrrCents;
    totalMrr = existingPlanMrr + bidScoutMrr;
    mrrCents = totalMrr;
    display = [{ label: "Bid Scout MRR", amount: bidScoutMrr, product: "bid_scout" }];
    console.error("[api/admin/finance] live Stripe read failed, using app-db fallback:", (err as Error)?.message ?? err);
  }

  return Response.json({
    // mrrCents stays the TRUE TOTAL (existing plans + Bid Scout) so the MRR
    // card keeps showing the whole picture; the split below is forward-
    // compatible analytics surface (both present even when 0).
    mrrCents,
    customerCount,
    existingPlanMrr,
    bidScoutMrr,
    totalMrr,
    bidScoutCustomers,
    source,
    truncated,
    tiers,
    display,
    customers,
    fetchedAt: new Date().toISOString(),
  });
}

export const Route = createFileRoute("/api/admin/finance")({
  server: { handlers: { GET: handler } },
});
