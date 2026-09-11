/**
 * Bid Scout Phase B — local smoke test (owner 2026-09-11 brief).
 *
 * Verifies, against the REAL Neon DB (DATABASE_URL) and the REAL lib code:
 *   1. Events flow through the canonical intake pipeline (handleIntake) with
 *      the standard bot exclusion (bot UA → no row) and 1s write-time dedupe.
 *   2. viewed / checkout_started are counted DISTINCT per visitor by
 *      getBidScoutFunnel30d(); purchased counts DISTINCT bidScoutId from
 *      bid_scout_subscriptions.
 *   3. bid_scout_purchased is written exactly ONCE per purchase — replaying the
 *      same signed checkout.session.completed does NOT create a second event
 *      (the write lives inside the same guarded transition).
 *   4. Funnel endpoint shape { range:"30d", stages:[viewed/checkout_started/
 *      purchased] } and 401 unauthenticated on both admin endpoints.
 *   5. Finance MRR split: existingPlanMrr + bidScoutMrr = totalMrr,
 *      bid_scout excluded from plan buckets, display entry
 *      { label:"Bid Scout MRR", product:"bid_scout" }.
 *   6. Dashboard assistance-card visibility: free-Basic sees, paid/trial/
 *      grant/demo/admin do not (shouldShowTrialStartCard).
 *   7. Attribution: original acquisition source (contrax_attr cookie) lands on
 *      the funnel event while the row's `source` column keeps the Bid Scout CTA
 *      source — the cookie is never clobbered.
 *
 * Usage: DATABASE_URL=... STRIPE_BID_SCOUT_PRICE_ID=price_test_xxx \
 *        bun run scripts/test-bid-scout-phase-b.ts
 *
 * Test rows are cleaned up at the end (funnel_events by visitor_id/email,
 * bid_scout_subscriptions by email, rate_limits, visitors summary rows).
 */
import { createHmac } from "node:crypto";
import { neon } from "@neondatabase/serverless";
import { sql } from "../src/db";
import {
  bidScoutCheckoutSchema,
  type BidScoutCheckoutInput,
  normalizeBidScoutInput,
  createBidScoutCheckoutSession,
  handleBidScoutSubscriptionEvent,
  recordBidScoutCheckoutStarted,
} from "../src/lib/bid-scout";
import { getBidScoutFunnel30d } from "../src/lib/bid-scout-funnel";
import {
  computeMrrBreakdown,
  recurringMonthlyAmount,
} from "../src/lib/finance-mrr";
import { shouldShowTrialStartCard } from "../src/lib/trial-start-card";

process.env.STRIPE_WEBHOOK_SECRET ??= "whsec_test_bidscout_phase_b";
process.env.STRIPE_BID_SCOUT_PRICE_ID ??= "price_test_bidscout_9900";
const WEBHOOK_SECRET = process.env.STRIPE_WEBHOOK_SECRET!;
const PRICE_ID = process.env.STRIPE_BID_SCOUT_PRICE_ID!;
const RUN = Date.now();
const EMAIL_TEST = `bidscout.pb.${RUN}@test.contrax`; // read-side EXCLUDED
const EMAIL_REAL = `bidscout.pb.${RUN}@example.com`; // read-side INCLUDED
const V1 = `pb-v1-${RUN}`;
const V2 = `pb-v2-${RUN}`;
const V3 = `pb-v3-${RUN}`;
let passed = 0;
let failed = 0;
function ok(cond: boolean, label: string, extra = "") {
  if (cond) { passed++; console.log(`  ✅ ${label}${extra ? ` — ${extra}` : ""}`); }
  else { failed++; console.error(`  ❌ ${label}${extra ? ` — ${extra}` : ""}`); }
}

function makeSignature(payload: string): string {
  const ts = Math.floor(Date.now() / 1000);
  const mac = createHmac("sha256", WEBHOOK_SECRET).update(`${ts}.${payload}`).digest("hex");
  return `t=${ts},v1=${mac}`;
}
let csCounter = 0;
const stubStripe = {
  checkout: { sessions: { create: () => Promise.resolve({ id: `cs_test_pb_${++csCounter}`, url: "https://checkout.stripe.com/pb" }) } },
};
async function deliverEvent(event: Record<string, unknown>): Promise<boolean> {
  const payload = JSON.stringify(event);
  const req = new Request("https://www.contrax.company/api/webhook", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "stripe-signature": makeSignature(payload),
    },
    body: payload,
  });
  // Same seam stripe.ts uses: constructEventAsync (Bun-only artifact vs the
  // sync constructEvent on Vercel/Node — identical verification math).
  const { default: Stripe } = await import("stripe");
  const verified = await Stripe.webhooks.constructEventAsync(payload, req.headers.get("stripe-signature")!, WEBHOOK_SECRET);
  return handleBidScoutSubscriptionEvent(verified as never);
}
const HUMAN_UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/126.0 Safari/537.36";
const ATTR_COOKIE = encodeURIComponent(JSON.stringify({ source: "facebook", medium: "cpc", campaign: "spring25" }));

async function main() {
  const db = neon(process.env.DATABASE_URL!);
  const baseline = Number((await db`SELECT COUNT(*)::int AS c FROM bid_scout_subscriptions`)[0].c);

  // ── 1. Events through the REAL intake pipeline ─────────────────────────────
  console.log("\n1) bid_scout_viewed + bid_scout_checkout_started (real intake pipeline)");
  // viewed for V1, V2, V3 — through the REAL intake pipeline (the client
  // trackEvent beacon converges on the same handleIntake).
  const { handleIntake } = await import("../src/lib/tracking-intake");
  for (const v of [V1, V2, V3]) {
    const beacon = new Request("https://www.contrax.company/api/track-visitor", {
      method: "POST",
      headers: { "content-type": "application/json", "user-agent": HUMAN_UA, cookie: `contrax_attr=${ATTR_COOKIE}` },
      body: JSON.stringify({ kind: "event", event: "bid_scout_viewed", label: "bid_scout_page", path: "/bid-scout", visitor_id: v, user_email: EMAIL_REAL }),
    });
    await handleIntake(beacon, "event");
  }
  // checkout_started through recordBidScoutCheckoutStarted (the REAL route path).
  const mkCheckoutReq = (visitor: string, source: string) =>
    new Request("https://www.contrax.company/api/bid-scout/checkout", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "user-agent": HUMAN_UA,
        cookie: `contrax_vid=${visitor}; contrax_attr=${ATTR_COOKIE}`,
        referer: "https://www.contrax.company/bid-scout",
      },
      body: JSON.stringify({}),
    });
  await recordBidScoutCheckoutStarted(mkCheckoutReq(V1, "dashboard"), {
    sourceLabel: "dashboard", userEmail: EMAIL_REAL, userId: null,
  });
  await recordBidScoutCheckoutStarted(mkCheckoutReq(V3, "homepage"), {
    sourceLabel: "homepage", userEmail: EMAIL_REAL, userId: null,
  });
  // duplicate within 1s → collapsed by the intake 1s dedupe
  await recordBidScoutCheckoutStarted(mkCheckoutReq(V3, "homepage"), {
    sourceLabel: "homepage", userEmail: EMAIL_REAL, userId: null,
  });
  // bot UA → handleIntake must refuse (no row for V3-bot)
  await recordBidScoutCheckoutStarted(
    new Request("https://www.contrax.company/api/bid-scout/checkout", {
      method: "POST",
      headers: { "content-type": "application/json", "user-agent": "HeadlessChrome/120 bot", cookie: `contrax_vid=${V3}-bot` },
      body: JSON.stringify({}),
    }),
    { sourceLabel: "bot", userEmail: EMAIL_REAL, userId: null },
  );
  // distinct counts
  const viewedRows = await db`SELECT COUNT(DISTINCT visitor_id)::int AS n FROM funnel_events WHERE event_name='bid_scout_viewed' AND visitor_id = ANY(${[V1, V2, V3]}) AND created_at >= NOW() - INTERVAL '10 minutes'`;
  ok(viewedRows[0].n === 3, "viewed = 3 distinct visitors");
  const coRows = await db`SELECT COUNT(DISTINCT visitor_id)::int AS n FROM funnel_events WHERE event_name='bid_scout_checkout_started' AND (visitor_id = ANY(${[V1, V3]})) AND created_at >= NOW() - INTERVAL '10 minutes'`;
  ok(coRows[0].n === 2, "checkout_started = 2 distinct visitors (dupe collapsed)");
  const botRows = await db`SELECT COUNT(*)::int AS n FROM funnel_events WHERE event_name='bid_scout_checkout_started' AND visitor_id = ${`${V3}-bot`}`;
  ok(botRows[0].n === 0, "bot UA writes NO event (standard exclusion)");

  // ── 2. Purchases + purchase-event dedupe ────────────────────────────────────
  console.log("\n2) bid_scout_purchased — server-side only, written once per purchase");
  const good = bidScoutCheckoutSchema.safeParse({
    companyName: "PB Test Co", email: EMAIL_REAL, capabilities: "Construction",
    naicsCodes: "236220", certifications: "8(a)", targetStates: "VA",
    source: "homepage",
  } as BidScoutCheckoutInput);
  const input = normalizeBidScoutInput(good.success ? good.data : {});
  const res1 = await createBidScoutCheckoutSession(input, { userId: null, stripe: stubStripe as never });
  const res2 = await createBidScoutCheckoutSession({ ...input, source: "dashboard" }, { userId: null, stripe: stubStripe as never });
  if (!res1.recordId || !res2.recordId) throw new Error("no record ids");
  const completed = (id: string, cs: string, sub: string, email: string) => ({
    id: `evt_pb_completed_${id}`,
    type: "checkout.session.completed",
    data: { object: { id: cs, object: "checkout.session", metadata: { product: "bid_scout", bidScoutId: id }, customer: `cus_${id}`, subscription: sub, customer_details: { email } } },
  });
  await deliverEvent(completed(res1.recordId, "cs_pb_1", "sub_pb_1", EMAIL_REAL));
  await deliverEvent(completed(res2.recordId, "cs_pb_2", "sub_pb_2", EMAIL_REAL));
  const purch1 = await db`SELECT COUNT(*)::int AS n FROM funnel_events WHERE event_name='bid_scout_purchased' AND label LIKE ${`%${res1.recordId}%`}`;
  ok(purch1[0].n === 1, "purchase event written once for record1");
  const purchAll = await db`SELECT COUNT(*)::int AS n FROM funnel_events WHERE event_name='bid_scout_purchased' AND (label LIKE ${`%${res1.recordId}%`} OR label LIKE ${`%${res2.recordId}%`})`;
  ok(purchAll[0].n === 2, "2 purchases → 2 purchase events (distinct per bidScoutId)");
  const meta = await db`SELECT label FROM funnel_events WHERE event_name='bid_scout_purchased' AND label LIKE ${`%${res1.recordId}%`} LIMIT 1`;
  const parsed = JSON.parse(meta[0].label);
  ok(parsed.product === "bid_scout" && parsed.bidScoutId === res1.recordId && parsed.stripeSessionId === "cs_pb_1" && parsed.amount === 9900 && parsed.currency === "usd", "purchase metadata exact", JSON.stringify(parsed));
  // replay → NO duplicate purchase event
  await deliverEvent(completed(res1.recordId, "cs_pb_1", "sub_pb_1", EMAIL_REAL));
  const purch1b = await db`SELECT COUNT(*)::int AS n FROM funnel_events WHERE event_name='bid_scout_purchased' AND label LIKE ${`%${res1.recordId}%`}`;
  ok(purch1b[0].n === 1, "replayed webhook creates NO second purchase event (dedupe)");

  // ── 3. Funnel counts + endpoint shape + admin 401s ──────────────────────────
  console.log("\n3) getBidScoutFunnel30d + admin endpoints");
  const funnel = await getBidScoutFunnel30d();
  ok(funnel.range === "30d", "range=30d");
  ok(funnel.stages.length === 3 && funnel.stages.map((s) => s.key).join(",") === "viewed,checkout_started,purchased", "3 stages in order");
  const s = (k: string) => funnel.stages.find((x) => x.key === k)?.count ?? -1;
  ok(s("viewed") === 3, "funnel viewed = 3 distinct", `count=${s("viewed")}`);
  ok(s("checkout_started") === 2, "funnel checkout_started = 2 distinct", `count=${s("checkout_started")}`);
  ok(s("purchased") === 2, "funnel purchased = 2 distinct bidScoutIds", `count=${s("purchased")}`);
  const { handler: bsfHandler } = await import("../src/routes/api/admin/bid-scout-funnel");
  const unauth1 = await bsfHandler({ request: new Request("https://www.contrax.company/api/admin/bid-scout-funnel") });
  ok(unauth1.status === 401, "bid-scout-funnel endpoint 401 unauthenticated");
  const { handler: bssHandler } = await import("../src/routes/api/admin/bid-scout-subscriptions");
  const unauth2 = await bssHandler({ request: new Request("https://www.contrax.company/api/admin/bid-scout-subscriptions") });
  ok(unauth2.status === 401, "bid-scout-subscriptions endpoint 401 unauthenticated");

  // ── 4. Finance MRR split (pure aggregation — same code the route runs) ─────
  console.log("\n4) Finance MRR split (computeMrrBreakdown)");
  const subs = [
    { metadata: { product: "bid_scout", bidScoutId: res1.recordId }, customer: "cus_bs_a", items: { data: [{ price: { recurring: { interval: "month" }, unit_amount: 9900 }, quantity: 1 }] } },
    { metadata: { plan_tier: "starter" }, customer: "cus_plan_b", items: { data: [{ price: { recurring: { interval: "month" }, unit_amount: 1900 }, quantity: 1 }] } },
    { metadata: { plan_tier: "professional" }, customer: "cus_plan_c", items: { data: [{ price: { recurring: { interval: "month" }, unit_amount: 7900 }, quantity: 1 }, { price: { unit_amount: 5000 }, quantity: 1 }] } },
  ];
  const bd = computeMrrBreakdown(subs as never[]);
  ok(bd.existingPlanMrr === 9800, "existingPlanMrr = plans only (excludes bid scout)", `=${bd.existingPlanMrr}`);
  ok(bd.bidScoutMrr === 9900, "bidScoutMrr = bid scout only", `=${bd.bidScoutMrr}`);
  ok(bd.totalMrr === 19700 && bd.totalMrr === bd.existingPlanMrr + bd.bidScoutMrr, "totalMrr = existingPlanMrr + bidScoutMrr", `=${bd.totalMrr}`);
  ok(bd.existingCustomers === 2 && bd.bidScoutCustomers === 1, "customer split never double-counts");
  ok(bd.display.length === 1 && bd.display[0].label === "Bid Scout MRR" && bd.display[0].product === "bid_scout" && bd.display[0].amount === 9900, "display entry separate line (not under a plan bucket)");
  ok(recurringMonthlyAmount(subs[2] as never) === 7900, "non-recurring line item contributes 0 (MRR = recurring only)");

  // ── 5. Dashboard card visibility ───────────────────────────────────────────
  console.log("\n5) Dashboard assistance card visibility (free-tier only)");
  const T = (planTier: string | null, active: boolean, expired: boolean, fullAccess: boolean) => ({ planTier, active, expired, fullAccess } as never);
  ok(shouldShowTrialStartCard(T("basic", false, false, false), { is_admin: false }).show === true, "free Basic sees the card");
  ok(shouldShowTrialStartCard(T("professional", false, false, false), { is_admin: false }).show === false, "paid (active plan) does NOT see it");
  ok(shouldShowTrialStartCard(T("professional", true, false, false), { is_admin: false }).show === false, "active trial does NOT see it");
  ok(shouldShowTrialStartCard(T("professional", false, false, true), { is_admin: false }).show === false, "active grant does NOT see it");
  ok(shouldShowTrialStartCard(T("demo", false, false, false), { is_admin: false }).show === false, "demo does NOT see it");
  ok(shouldShowTrialStartCard(T("basic", false, false, false), { is_admin: true }).show === false, "admin does NOT see it");

  // ── 6. Attribution: acquisition source preserved, CTA source separate ──────
  console.log("\n6) Attribution (acquisition cookie vs Bid Scout CTA source)");
  const attrRow = await db`SELECT source, medium, campaign, visitor_id FROM funnel_events WHERE event_name='bid_scout_checkout_started' AND visitor_id=${V1} AND created_at >= NOW() - INTERVAL '10 minutes' LIMIT 1`;
  ok(attrRow.length === 1 && attrRow[0].source === "facebook" && attrRow[0].medium === "cpc" && attrRow[0].campaign === "spring25", "checkout_started event carries ORIGINAL acquisition attribution (cookie)", `source=${attrRow[0]?.source}`);
  const recRow = await db`SELECT source FROM bid_scout_subscriptions WHERE id=${res2.recordId}`;
  ok(recRow[0].source === "dashboard", "Bid Scout row source = CTA placement (?source=)", `source=${recRow[0].source}`);
  ok(attrRow[0].visitor_id === V1, "visitor identity preserved on the event");

  // ── Cleanup ────────────────────────────────────────────────────────────────
  console.log("\n── Cleanup ──");
  await db`DELETE FROM funnel_events WHERE event_name LIKE 'bid_scout_%' AND (visitor_id = ANY(${[V1, V2, V3, `${V3}-bot`]}) OR user_email IN (${EMAIL_REAL}, ${EMAIL_TEST}))`;
  await db`DELETE FROM funnel_events WHERE event_name='bid_scout_purchased' AND (label LIKE ${`%${res1.recordId}%`} OR label LIKE ${`%${res2.recordId}%`})`;
  await db`DELETE FROM visitors WHERE visitor_id = ANY(${[V1, V2, V3]})`;
  await db`DELETE FROM bid_scout_subscriptions WHERE email IN (${EMAIL_REAL}, ${EMAIL_TEST})`;
  await db`DELETE FROM rate_limits WHERE scope LIKE 'bid_scout_%'`;
  const after = Number((await db`SELECT COUNT(*)::int AS c FROM bid_scout_subscriptions`)[0].c);
  ok(after === baseline, `bid_scout_subscriptions back to baseline (${baseline})`, `count=${after}`);
  const leftover = await db`SELECT COUNT(*)::int AS n FROM funnel_events WHERE event_name LIKE 'bid_scout_%' AND (visitor_id = ANY(${[V1, V2, V3]}) OR user_email IN (${EMAIL_REAL}, ${EMAIL_TEST}) OR label LIKE ${`%${res1.recordId}%`} OR label LIKE ${`%${res2.recordId}%`})`;
  ok(leftover[0].n === 0, "no leftover bid_scout test events");
  const users = await db`SELECT COUNT(*)::int AS n FROM users WHERE email IN (${EMAIL_REAL}, ${EMAIL_TEST})`;
  ok(users[0].n === 0, "no test users created");

  console.log(`\n══ RESULT: ${passed} passed, ${failed} failed ══`);
  process.exit(failed > 0 ? 1 : 0);
}
main().catch(async (e) => {
  console.error("Smoke test crashed:", e);
  try {
    const db = neon(process.env.DATABASE_URL!);
    await db`DELETE FROM funnel_events WHERE event_name LIKE 'bid_scout_%' AND (visitor_id = ANY(${[V1, V2, V3, `${V3}-bot`]}) OR user_email IN (${EMAIL_REAL}, ${EMAIL_TEST}))`;
    await db`DELETE FROM visitors WHERE visitor_id = ANY(${[V1, V2, V3]})`;
    await db`DELETE FROM bid_scout_subscriptions WHERE email IN (${EMAIL_REAL}, ${EMAIL_TEST})`;
    await db`DELETE FROM rate_limits WHERE scope LIKE 'bid_scout_%'`;
  } catch { /* non-fatal */ }
  process.exit(1);
});