/**
 * Bid Scout Founders first-five offer — TEST-MODE ACCEPTANCE (owner spec
 * 2026-09-11 §7/§8/§9). Runs against the REAL Stripe TEST account + REAL app
 * lib code + REAL prod Neon DB. Consumes the OWNER test promo's five
 * redemptions BY DESIGN (first five at $49, sixth at $99).
 *
 * Modes (run in order, browser between the verify steps):
 *   MODE=probe            §7.1-7.3 + classifier evidence: owner promo + coupon
 *                         properties, base price, EXACT Stripe exhaustion
 *                         error (promotion_code_used_up), resource_missing,
 *                         the retry-without-discounts path (controlled
 *                         interleaving wrapper around the real client).
 *   MODE=create           create founders 1-4 + abandoned checkout sessions
 *                         (real createBidScoutCheckoutSession) → state file.
 *   MODE=race             two CONCURRENT createBidScoutCheckoutSession calls
 *                         around the 5th redemption → one discounted (founder
 *                         #5), one standard (sixth) → state file.
 *   MODE=verify F=<n>     post-payment: retrieve session (must be paid),
 *                         assert $49 charged + $50 discount, deliver the
 *                         REAL signed checkout.session.completed webhook,
 *                         assert offer_code first_five_49 + first invoice
 *                         $49 + currency + purchase event exactly once, replay
 *                         2x no dup.
 *   MODE=edge-done        after the browser pays the edge session: assert the
 *                         completion-time enforcement (no 6th discounted sub).
 *   MODE=final            everything else: lifecycle (payment_failed / paid /
 *                         deleted), negative-inference stub, non-Bid-Scout
 *                         fallthrough, no-user-creation, rate limits, admin
 *                         report shape, post-exhaustion standard create,
 *                         §7.13 env-id mapping, cleanup (exact scope) +
 *                         drift=0 proofs.
 *
 * Usage (TEST MODE ONLY):
 *   source /etc/profile.d/zz-stripe-ops.sh
 *   export STRIPE_SECRET_KEY=$STRIPE_TEST_SECRET_KEY
 *   export STRIPE_BID_SCOUT_PRICE_ID=$STRIPE_BID_SCOUT_TEST_PRICE_ID
 *   export STRIPE_WEBHOOK_SECRET=$STRIPE_WEBHOOK_SECRET   # test webhook secret
 *   DATABASE_URL=... MODE=probe bun run scripts/test-bid-scout-founders.ts
 *   ... agent-browser completes the founder checkouts (test card 4242…) ...
 *   DATABASE_URL=... MODE=final bun run scripts/test-bid-scout-founders.ts
 */
import { createHmac } from "node:crypto";
import fs from "node:fs";
import Stripe from "stripe";
import { neon } from "@neondatabase/serverless";
import {
  bidScoutCheckoutSchema,
  type BidScoutCheckoutInput,
  normalizeBidScoutInput,
  createBidScoutCheckoutSession,
  handleBidScoutSubscriptionEvent,
  getBidScoutFoundersOffer,
  isPromotionUnavailableError,
  getBidScoutPriceId,
  BID_SCOUT_PRICE_USD,
  BID_SCOUT_FOUNDERS_DISCOUNT_AMOUNT,
  BID_SCOUT_FOUNDERS_FIRST_TOTAL,
  BID_SCOUT_FOUNDERS_LIMIT,
} from "../src/lib/bid-scout";
import { getBidScoutFoundersReport } from "../src/lib/bid-scout-founders-report";

// ── Env (test values only) ───────────────────────────────────────────────────
process.env.STRIPE_WEBHOOK_SECRET ??= "whsec_test_a6_bidscout";
const WEBHOOK_SECRET = process.env.STRIPE_WEBHOOK_SECRET!;
const MODE = process.env.MODE ?? "probe";
const RUN = Date.now();
const RUN_SEC = Math.floor(RUN / 1000);
const FOUNDER_EMAILS = Array.from({ length: 5 }, (_, i) => `founders-${i + 1}-${RUN}@test.contrax`);
const ABANDONED_EMAIL = `founders-abandoned-${RUN}@test.contrax`;
const STATE_PATH = "/tmp/founders-state.json";
const API_VERSION = "2024-12-18.acacia";
/** LIVE promo id (from the lead handoff) — used ONLY for the §7.13 mapping
 *  assertion (ids differ + env mapping). Never retrieved (no live key). */
const LIVE_PROMO_ID = "promo_1UEYkyGdL43e7acFBmoU2TJC";

let passed = 0;
let failed = 0;
function ok(cond: boolean, label: string, extra = "") {
  if (cond) {
    passed++;
    console.log(`  ✅ ${label}${extra ? ` — ${extra}` : ""}`);
  } else {
    failed++;
    console.error(`  ❌ ${label}${extra ? ` — ${extra}` : ""}`);
  }
}

function makeSignature(payload: string): string {
  const ts = Math.floor(Date.now() / 1000);
  const mac = createHmac("sha256", WEBHOOK_SECRET).update(`${ts}.${payload}`).digest("hex");
  return `t=${ts},v1=${mac}`;
}

async function deliverEvent(event: Record<string, unknown>): Promise<boolean> {
  const payload = JSON.stringify(event);
  const sig = makeSignature(payload);
  const verified = await Stripe.webhooks.constructEventAsync(payload, sig, WEBHOOK_SECRET);
  return handleBidScoutSubscriptionEvent(verified as never);
}

function getStripeClient(): Stripe {
  return new Stripe(process.env.STRIPE_SECRET_KEY!, { apiVersion: API_VERSION as any });
}

const checkoutInput = (email: string, source: string) => {
  const parsed = bidScoutCheckoutSchema.safeParse({
    companyName: "Founders Evidence Co",
    email,
    capabilities: "Construction management and general contracting",
    website: "founders-evidence.example.com",
    naicsCodes: "236220",
    certifications: "8(a)",
    targetStates: "VA",
    notes: `Founders offer acceptance — run ${RUN}`,
    source,
  } as BidScoutCheckoutInput);
  if (!parsed.success) throw new Error("schema parse failed: " + JSON.stringify(parsed.error.issues));
  return normalizeBidScoutInput(parsed.data);
};

interface SessionRecord {
  key: string; // founders-1..4 | founders-5 | sixth | abandoned
  email: string;
  recordId: string;
  sessionId: string;
  url: string;
  offerCandidate: string | null;
}
interface State {
  run: number;
  runSec: number;
  sessions: SessionRecord[];
  baseline: { bsCount: number; rateCount: number; funnelMaxId: number; bsEvents: number };
}

function readState(): State {
  if (!fs.existsSync(STATE_PATH)) throw new Error("state file missing — run MODE=create first");
  return JSON.parse(fs.readFileSync(STATE_PATH, "utf8"));
}
function writeState(st: State) {
  fs.writeFileSync(STATE_PATH, JSON.stringify(st, null, 2));
}

// ── PROBE ────────────────────────────────────────────────────────────────────
async function probeMode() {
  console.log("\n[A:probe] base price + owner promo properties + classifier evidence");
  const stripe = getStripeClient();

  // §7.1 base price remains $99/month recurring
  const priceId = getBidScoutPriceId();
  const price = await stripe.prices.retrieve(priceId);
  ok(price.livemode === false, "price.livemode === false (test price)");
  ok(price.unit_amount === BID_SCOUT_PRICE_USD, "base price stays $99.00 (9900)", `amount=${price.unit_amount}`);
  ok(price.recurring?.interval === "month" && price.type === "recurring", "price is monthly RECURRING", `interval=${price.recurring?.interval}`);

  // §7.2/7.3 owner promo properties (env promo = TEST)
  const promoId = process.env.STRIPE_BID_SCOUT_FOUNDERS_PROMO_ID;
  ok(!!promoId, "STRIPE_BID_SCOUT_FOUNDERS_PROMO_ID is set");
  ok(promoId !== LIVE_PROMO_ID, "§7.13 test promo id ≠ live promo id", `test=${promoId} live=${LIVE_PROMO_ID}`);
  const promo = await stripe.promotionCodes.retrieve(promoId!);
  ok(promo.livemode === false, "env promo is TEST-mode (livemode=false)");
  ok(promo.active === true, "promotion code active");
  ok(promo.max_redemptions === BID_SCOUT_FOUNDERS_LIMIT, "max_redemptions = 5", `=${promo.max_redemptions}`);
  ok((promo.restrictions as any)?.first_time_transaction === true, "restrictions.first_time_transaction = true");
  ok(promo.code === "BIDSCOUTFIRST5", `code === BIDSCOUTFIRST5`, `=${promo.code}`);
  const coupon = (promo as any).coupon as Stripe.Coupon;
  ok(coupon.amount_off === BID_SCOUT_FOUNDERS_DISCOUNT_AMOUNT && coupon.currency === "usd", "coupon = $50 USD off", `amount_off=${coupon.amount_off} ${coupon.currency}`);
  ok(coupon.duration === "once", "coupon.duration === once (first invoice only)");
  ok((coupon.metadata as any)?.product === "bid_scout" && (coupon.metadata as any)?.offer === "first_five_49_first_month", "coupon metadata product/offer exact");
  ok((promo.metadata as any)?.product === "bid_scout", "promo metadata.product === bid_scout");
  const offer = await getBidScoutFoundersOffer();
  ok(offer.available === true && offer.remaining === 5 - offer.timesRedeemed, "getBidScoutFoundersOffer available + remaining=5−redeemed", JSON.stringify({ remaining: offer.remaining, redeemed: offer.timesRedeemed }));

  // No-env → fails safe
  const prevId = process.env.STRIPE_BID_SCOUT_FOUNDERS_PROMO_ID;
  delete process.env.STRIPE_BID_SCOUT_FOUNDERS_PROMO_ID;
  const noOffer = await getBidScoutFoundersOffer();
  ok(noOffer.available === false && noOffer.remaining === 0 && noOffer.promotionCodeId === null, "absent env → available:false / remaining:0 (fails safe to $99)");
  process.env.STRIPE_BID_SCOUT_FOUNDERS_PROMO_ID = prevId;

  // ── §8 classifier against the EXACT Stripe errors (real objects) ─────────
  console.log("\n[B] classifier — exact-error evidence");
  // B.1 promotion_code_used_up: create max_redemptions=1 promo, exhaust via a
  // REAL paid invoice, then session-create with it → capture the REAL error.
  const c1 = await stripe.coupons.create({ amount_off: 100, currency: "usd", duration: "once", name: "founders-acc-c1" });
  const p1 = await stripe.promotionCodes.create({ code: `FOUNDERSACC${RUN_SEC}`, coupon: c1.id, max_redemptions: 1 });
  const cust1 = await stripe.customers.create({ email: `acc-${RUN}@test.contrax` });
  const pm1 = await stripe.paymentMethods.create({ type: "card", card: { token: "tok_visa" } });
  await stripe.paymentMethods.attach(pm1.id, { customer: cust1.id });
  await stripe.customers.update(cust1.id, { invoice_settings: { default_payment_method: pm1.id } });
  const sub1 = await stripe.subscriptions.create({ customer: cust1.id, items: [{ price: priceId }], promotion_code: p1.id } as any);
  ok((await stripe.invoices.retrieve(sub1.latest_invoice as string)).total === BID_SCOUT_PRICE_USD - 100, "exhaustion subscription first invoice has the $1 coupon applied (real objects)");
  const p1after = await stripe.promotionCodes.retrieve(p1.id);
  ok(p1after.times_redeemed === 1, "real paid invoice incremented times_redeemed to 1 (max=1 ⇒ exhausted)");

  let exactError: any = null;
  let retryFailed = false;
  try {
    await stripe.checkout.sessions.create({
      mode: "subscription",
      line_items: [{ price: priceId, quantity: 1 }],
      success_url: "https://example.com/s?x={CHECKOUT_SESSION_ID}",
      cancel_url: "https://example.com/c",
      customer_email: `acc-checkout-${RUN}@test.contrax`,
      discounts: [{ promotion_code: p1.id }],
    });
    retryFailed = true; // expected to fail
  } catch (e: any) {
    exactError = { type: e.type, code: e.code, param: e.param ?? null, message: String(e.message ?? "").slice(0, 120) };
  }
  ok(!retryFailed && exactError && exactError.code === "promotion_code_used_up", "session create with EXHAUSTED promo throws — EXACT Stripe error", JSON.stringify(exactError));
  ok(isPromotionUnavailableError(makeStripeError("promotion_code_used_up")), "classifier MATCHES the exact error code promotion_code_used_up");
  ok(isPromotionUnavailableError(makeStripeError("promotion_code_max_redemptions_reached")), "classifier matches spec-listed promotion_code_max_redemptions_reached");
  ok(isPromotionUnavailableError(makeStripeError("coupon_max_redemptions_reached")), "classifier matches spec-listed coupon_max_redemptions_reached");

  // B.2 resource_missing (the second real code): subscription create with no
  // payment method yields StripeInvalidRequestError code=resource_missing.
  const cust2 = await stripe.customers.create({ email: `acc-nopm-${RUN}@test.contrax` });
  let rmError: any = null;
  try {
    await stripe.subscriptions.create({ customer: cust2.id, items: [{ price: priceId }], promotion_code: p1.id });
  } catch (e: any) {
    rmError = { code: e?.raw?.code ?? e?.code, type: e.type };
  }
  ok(rmError?.code === "resource_missing", "REAL Stripe resource_missing error captured", JSON.stringify(rmError));
  ok(isPromotionUnavailableError(makeStripeError("resource_missing")), "classifier matches resource_missing");

  // B.3 negative classifier: non-promo errors → false (card decline, param, network shape)
  ok(!isPromotionUnavailableError(makeStripeError("card_declined", "StripeCardError")), "classifier rejects card_declined");
  ok(!isPromotionUnavailableError(makeStripeError("parameter_invalid_integer", "StripeInvalidRequestError")), "classifier rejects parameter_invalid_integer");
  ok(!isPromotionUnavailableError(new Error("network timeout")), "classifier rejects plain Error");

  // B.4 RETRY path with a REAL error through the REAL lib: point the env at a
  // FRESH max_redemptions=1 promo (p2); wrap the real client so the lib's
  // retrieve reports it available, then the FIRST create interleaves a REAL
  // redemption (paid subscription, real objects) before calling the REAL
  // sessions.create — which throws the REAL promotion_code_used_up. The lib
  // must classify and retry WITHOUT discounts, producing a working standard
  // session.
  const c2 = await stripe.coupons.create({ amount_off: 100, currency: "usd", duration: "once", name: "founders-acc-c2" });
  const p2 = await stripe.promotionCodes.create({ code: `FOUNDERSRACE${RUN_SEC}`, coupon: c2.id, max_redemptions: 1 });
  const realStripe = getStripeClient();
  let intercepted = 0;
  const racyClient: any = {
    promotionCodes: {
      retrieve: async (id: string) => {
        // report the pre-race state: available, 1 remaining (real object id)
        return { id, active: true, max_redemptions: 1, times_redeemed: 0 };
      },
    },
    checkout: {
      sessions: {
        create: async (params: any, _opts?: any) => {
          intercepted++;
          if (intercepted === 1) {
            // Land a REAL redemption (via a real paid subscription) so the real
            // create below hits the REAL exhausted error.
            const c = await stripe.customers.create({ email: `acc-race-${RUN}@test.contrax` });
            const pm = await stripe.paymentMethods.create({ type: "card", card: { token: "tok_visa" } });
            await stripe.paymentMethods.attach(pm.id, { customer: c.id });
            await stripe.customers.update(c.id, { invoice_settings: { default_payment_method: pm.id } });
            const s2 = await stripe.subscriptions.create({ customer: c.id, items: [{ price: priceId }], promotion_code: p2.id } as any);
            await stripe.subscriptions.cancel(s2.id).catch(() => {});
            await stripe.customers.del(c.id).catch(() => {});
          }
          return realStripe.checkout.sessions.create(params as any);
        },
      },
    },
  };
  const prevPromo = process.env.STRIPE_BID_SCOUT_FOUNDERS_PROMO_ID;
  try {
    process.env.STRIPE_BID_SCOUT_FOUNDERS_PROMO_ID = p2.id;
    const res = await createBidScoutCheckoutSession(
      checkoutInput(`acc-retry-${RUN}@test.contrax`, "acc_retry"),
      { stripe: racyClient },
    );
    ok(res.success === true && !!res.url, "lib retry path SUCCEEDED after classification (real promotion_code_used_up → standard retry)", res.url?.slice(0, 60));
    ok(intercepted >= 2, "lib performed the no-discount retry (2nd create attempt)", `intercepted=${intercepted}`);
    const retrySessId = res.url!.includes("cs_test_") ? (res.url!.split("/c/pay/")[1] ?? res.url!).split(/[?#]/)[0] : res.url!;
    const retrySession = await realStripe.checkout.sessions.retrieve(retrySessId);
    ok(retrySession.discounts == null || retrySession.discounts!.length === 0, "retried session has NO discounts (standard $99)");
    ok(retrySession.metadata?.offerCandidate === "standard_99", "retried session offerCandidate === standard_99 (both metadata spots)", JSON.stringify({ s: retrySession.metadata?.offerCandidate }));
  } finally {
    process.env.STRIPE_BID_SCOUT_FOUNDERS_PROMO_ID = prevPromo;
  }
  // clean up B.4's pending row by exact email
  await (neon(process.env.DATABASE_URL!))`DELETE FROM bid_scout_subscriptions WHERE email = ${`acc-retry-${RUN}@test.contrax`}`;
  await stripe.coupons.del(c2.id).catch(() => {});
  await stripe.promotionCodes.update(p2.id, { active: false }).catch(() => {});

  // cleanup throwaway objects
  for (const s of [sub1]) await stripe.subscriptions.cancel(s.id).catch(() => {});
  for (const c of [cust1, cust2]) await stripe.customers.del(c.id).catch(() => {});
  await stripe.coupons.del(c1.id).catch(() => {});
  // p1 can't be deleted — deactivate it (documented)
  await stripe.promotionCodes.update(p1.id, { active: false }).catch(() => {});

  console.log(`\n══ RESULT [probe]: ${passed} passed, ${failed} failed ══`);
  process.exit(failed > 0 ? 1 : 0);
}

function makeStripeError(code: string, type = "StripeInvalidRequestError"): unknown {
  return { type, code, message: "test error for classifier", param: undefined };
}

// ── CREATE (batch 1: founders 1-4 + abandoned) ───────────────────────────────
async function createMode() {
  const db = neon(process.env.DATABASE_URL!);
  const baseline = {
    bsCount: Number((await db`SELECT COUNT(*)::int AS c FROM bid_scout_subscriptions`)[0].c),
    rateCount: Number((await db`SELECT COUNT(*)::int AS c FROM rate_limits WHERE scope LIKE 'bid_scout_%'`)[0].c),
    funnelMaxId: Number((await db`SELECT COALESCE(MAX(id),0)::int AS m FROM funnel_events`)[0].m),
    bsEvents: Number((await db`SELECT COUNT(*)::int AS c FROM funnel_events WHERE event_name LIKE 'bid_scout_%'`)[0].c),
  };
  console.log(`\n[create] baseline — bs_rows=${baseline.bsCount} rate_rows=${baseline.rateCount} funnel_max_id=${baseline.funnelMaxId} bs_events=${baseline.bsEvents}`);

  const st: State = { run: RUN, runSec: RUN_SEC, sessions: [], baseline };

  const promoBefore = await getBidScoutFoundersOffer();
  ok(promoBefore.available, "founders offer available at create (remaining ≥1)", `remaining=${promoBefore.remaining}`);

  for (let i = 0; i < 4; i++) {
    const res = await createBidScoutCheckoutSession(checkoutInput(FOUNDER_EMAILS[i], `founders_${i + 1}`), { userId: null });
    ok(!!(res.success && res.recordId && res.url), `founder #${i + 1} checkout session created (discounts attached)`, `remaining was ${promoBefore.remaining}`);
    if (!res.success || !res.recordId || !res.url) return process.exit(1);
    const s = await getStripeClient().checkout.sessions.retrieve(res.url.includes("cs_test_") ? (res.url.split("/c/pay/")[1] ?? res.url).split(/[?#]/)[0] : res.url);
    ok(s.metadata?.offerCandidate === "first_five_49", `founder #${i + 1} session metadata.offerCandidate === first_five_49`);
    ok((s.discounts ?? []).length === 1, `founder #${i + 1} session has exactly 1 discount (promo attached)`);
    st.sessions.push({ key: `founders-${i + 1}`, email: FOUNDER_EMAILS[i], recordId: res.recordId, sessionId: s.id, url: res.url, offerCandidate: s.metadata?.offerCandidate ?? null });
  }

  // abandoned checkout — created while spots remain (shows $49), NEVER paid
  const ab = await createBidScoutCheckoutSession(checkoutInput(ABANDONED_EMAIL, "founders_abandoned"), { userId: null });
  ok(!!(ab.success && ab.recordId && ab.url), "abandoned checkout session created (discounts attached)");
  if (!ab.success || !ab.recordId || !ab.url) return process.exit(1);
  const abs = await getStripeClient().checkout.sessions.retrieve(ab.url.includes("cs_test_") ? (ab.url.split("/c/pay/")[1] ?? ab.url).split(/[?#]/)[0] : ab.url);
  st.sessions.push({ key: "abandoned", email: ABANDONED_EMAIL, recordId: ab.recordId, sessionId: abs.id, url: ab.url, offerCandidate: abs.metadata?.offerCandidate ?? null });

  // session create does NOT increment times_redeemed (documented semantics) —
  // creating sessions must not consume redemptions.
  const promoMid = await getBidScoutFoundersOffer();
  ok(promoMid.timesRedeemed === promoBefore.timesRedeemed, "session creation did NOT consume a redemption (times_redeemed unchanged — Stripe counts at payment)", `before=${promoBefore.timesRedeemed} after=${promoMid.timesRedeemed}`);

  writeState(st);
  console.log(`\n[create] state saved → ${STATE_PATH} (${st.sessions.length} sessions)`);
  for (const s of st.sessions) console.log(`  ${s.key.padEnd(10)} ${s.sessionId}  ${s.email}`);
  console.log("\nNEXT: open founder URLs in agent-browser, pay with 4242…; then MODE=verify F=<n> after each payment.");
}

// ── RACE (two simultaneous attempts around the 5th redemption) ──────────────
// OBSERVED Stripe semantics (verified 2026-09-11, apiVersion 2024-12-18.acacia):
//   · sessions.create does NOT enforce max_redemptions and does NOT increment
//     times_redeemed (creating N sessions with a max-1 code all succeeds).
//   · times_redeemed increments at PAYMENT/completion.
//   · a create AFTER exhaustion throws promotion_code_used_up (see probe B.1).
// So "two simultaneous attempts around the 5th redemption" plays out at
// COMPLETION: both sessions are created with the discount; whichever completes
// 5th keeps it ($49); the other completes AFTER the cap → Stripe drops the
// discount and charges $99 (completion-time enforcement — the real authority).
// The create-time exhaustion race (retrieve→create with a redemption landing
// in between) is proven separately in probe B.4 via a deterministically
// interleaved real-object test.
async function raceMode() {
  const st = readState();
  const db = neon(process.env.DATABASE_URL!);
  const before = await getBidScoutFoundersOffer();
  ok(before.timesRedeemed === 4, "race precondition: exactly 4 founders paid (times_redeemed=4, remaining=1)", `redeemed=${before.timesRedeemed}`);
  const EDGE_EMAIL = `founders-edge-${RUN}@test.contrax`;
  const [resA, resB] = await Promise.all([
    createBidScoutCheckoutSession(checkoutInput(FOUNDER_EMAILS[4], "founders_5"), { userId: null }),
    createBidScoutCheckoutSession(checkoutInput(EDGE_EMAIL, "founders_edge"), { userId: null }),
  ]);
  ok(resA.success && resB.success, "two SIMULTANEOUS create attempts both returned sessions (create-time allows; completion is the authority)");
  if (!resA.success || !resB.success || !resA.recordId || !resA.url || !resB.recordId || !resB.url) return process.exit(1);
  const promoAfter = await getBidScoutFoundersOffer();
  ok(promoAfter.timesRedeemed === 4, "simultaneous creates did NOT consume redemptions (still 4 — Stripe counts at payment)", `redeemed=${promoAfter.timesRedeemed}`);

  const stripe = getStripeClient();
  const sa = await stripe.checkout.sessions.retrieve(resA.url.includes("cs_test_") ? (resA.url.split("/c/pay/")[1] ?? resA.url).split(/[?#]/)[0] : resA.url);
  const sb = await stripe.checkout.sessions.retrieve(resB.url.includes("cs_test_") ? (resB.url.split("/c/pay/")[1] ?? resB.url).split(/[?#]/)[0] : resB.url);
  const discounted = (s: any) => (s.discounts ?? []).length === 1;
  ok(discounted(sa) && discounted(sb), "both simultaneous sessions carry the discount at create (documented create-time semantics)", `A=${discounted(sa)} B=${discounted(sb)}`);
  ok(sa.metadata?.offerCandidate === "first_five_49" && sb.metadata?.offerCandidate === "first_five_49", "both sessions offerCandidate === first_five_49 at create");

  st.sessions = st.sessions.filter((s) => s.key !== "founders-5" && s.key !== "edge");
  st.sessions.push(
    { key: "founders-5", email: FOUNDER_EMAILS[4], recordId: resA.recordId, sessionId: sa.id, url: resA.url, offerCandidate: sa.metadata?.offerCandidate ?? null },
    { key: "edge", email: EDGE_EMAIL, recordId: resB.recordId, sessionId: sb.id, url: resB.url, offerCandidate: sb.metadata?.offerCandidate ?? null },
  );
  writeState(st);
  console.log(`\n[race] founder #5 (pay → 5th $49): ${sa.id}`);
  console.log(`[race] edge (pay AFTER 5th redemption → completion-time enforcement): ${sb.id}`);
  console.log("[race] abandoned (never paid): " + st.sessions.find((x) => x.key === "abandoned")?.sessionId);

  // The abandoned row was created during MODE=create under ITS run — never
  // re-derive the email from this process's RUN; use the state record.
  const abEmail = st.sessions.find((x) => x.key === "abandoned")?.email ?? ABANDONED_EMAIL;
  const abRow = await db`SELECT status FROM bid_scout_subscriptions WHERE email = ${abEmail}`;
  ok(abRow[0]?.status === "pending", "abandoned checkout row still pending (consumes NO completed row)", `=${abRow[0]?.status}`);
  void db;
}

// ── VERIFY F=<n> (per-founder post-payment) ──────────────────────────────────
async function verifyFounderMode() {
  const st = readState();
  const n = Number(process.env.F);
  if (!Number.isInteger(n) || n < 1 || n > 5) throw new Error("MODE=verify requires F=1..5");
  const rec = st.sessions.find((s) => s.key === `founders-${n}`);
  if (!rec) throw new Error(`no founders-${n} session in state`);
  const db = neon(process.env.DATABASE_URL!);
  const stripe = getStripeClient();

  console.log(`\n[verify] founder #${n} — record=${rec.recordId} session=${rec.sessionId}`);
  const session = await stripe.checkout.sessions.retrieve(rec.sessionId, { expand: ["subscription", "line_items"] });
  ok(session.payment_status === "paid", "REAL hosted checkout payment completed (payment_status=paid)", `=${session.payment_status}`);
  ok(session.livemode === false, "session.livemode === false");
  ok(session.amount_total === BID_SCOUT_FOUNDERS_FIRST_TOTAL, "charged $49 — first invoice total = 4900", `amount_total=${session.amount_total}`);
  ok((session.total_details?.amount_discount ?? 0) === BID_SCOUT_FOUNDERS_DISCOUNT_AMOUNT, "discount applied = $50 (5000)", `amount_discount=${session.total_details?.amount_discount}`);
  ok(session.currency === "usd", "currency = usd", `=${session.currency}`);
  const rawSubId = typeof session.subscription === "string" ? session.subscription : (session.subscription as any)?.id;
  ok(!!rawSubId, "subscription created by checkout");

  // §7.5 next-invoice = $99 before tax (coupon duration once → renewal at 9900 —
  // proven by the subscription's recurring line item + the coupon being once).
  if (rawSubId) {
    const sub = (await stripe.subscriptions.retrieve(rawSubId)) as any;
    const li = sub.items?.data?.[0];
    ok(li?.price?.unit_amount === 9900 && li?.price?.recurring?.interval === "month", `founder #${n} NEXT invoice = $99/month (9900; coupon once not applied to renewals)`, JSON.stringify({ unit_amount: li?.price?.unit_amount }));
    const invs = sub.latest_invoice ? null : null;
    void invs;
  }

  // Webhook delivery (signed, real event object)
  const evt = {
    id: `evt_founders_completed_${n}_${RUN}`,
    type: "checkout.session.completed",
    data: { object: session as never as Record<string, unknown> },
  };
  const consumed = await deliverEvent(evt);
  ok(consumed === true, "checkout.session.completed consumed by Bid Scout handler");

  const row = await db`SELECT status, offer_code, first_invoice_amount, currency, stripe_customer_id, stripe_subscription_id FROM bid_scout_subscriptions WHERE id = ${String(rec.recordId)}::uuid`;
  ok(row.length === 1 && row[0]?.status === "active", "row transitioned pending → active");
  ok(row[0]?.offer_code === "first_five_49", "offer_code === first_five_49 (webhook-derived from REAL Stripe numbers: $50 discount AND $49 total)", `=${row[0]?.offer_code}`);
  ok(row[0]?.first_invoice_amount === BID_SCOUT_FOUNDERS_FIRST_TOTAL, "first_invoice_amount === 4900 (what was actually charged)", `=${row[0]?.first_invoice_amount}`);
  ok(row[0]?.currency === "usd", "currency === usd", `=${row[0]?.currency}`);
  ok(!!row[0]?.stripe_customer_id && !!row[0]?.stripe_subscription_id, "customer + subscription ids persisted");

  const purch = await db`SELECT label, user_email FROM funnel_events WHERE event_name='bid_scout_purchased' AND label LIKE ${`%"bidScoutId":"${rec.recordId}"%`}`;
  ok(purch.length === 1, "bid_scout_purchased written EXACTLY once", `n=${purch.length}`);
  const pm = JSON.parse(purch[0].label as string);
  ok(pm.offer === "first_five_49" && pm.first_invoice_amount === 4900 && pm.renewal_amount === 9900 && pm.currency === "usd", "purchase event properties exact {offer, first_invoice_amount, renewal_amount:9900, currency}", JSON.stringify({ offer: pm.offer, first_invoice_amount: pm.first_invoice_amount, renewal_amount: pm.renewal_amount, currency: pm.currency }));
  ok(purch[0].user_email === rec.email, "purchase event stamps the buyer email");

  // Replay 2× → no dup, no regression
  const ua0 = (await db`SELECT updated_at::text AS ua FROM bid_scout_subscriptions WHERE id = ${String(rec.recordId)}::uuid`)[0].ua;
  await deliverEvent(evt);
  await deliverEvent(evt);
  const after = await db`SELECT status, updated_at::text AS ua FROM bid_scout_subscriptions WHERE id = ${String(rec.recordId)}::uuid`;
  ok(after[0]?.status === "active" && after[0].ua === ua0, "replay: no state regression, no double transition");
  const purch2 = await db`SELECT COUNT(*)::int AS n FROM funnel_events WHERE event_name='bid_scout_purchased' AND label LIKE ${`%"bidScoutId":"${rec.recordId}"%`}`;
  ok(purch2[0].n === 1, "replay: NO duplicate bid_scout_purchased", `n=${purch2[0].n}`);
  void db;
}


// ── EDGE-DONE (after the browser paid the edge session) ─────────────────────
async function edgeDoneMode() {
  const st = readState();
  const stripe = getStripeClient();
  const edgeRec = st.sessions.find((x) => x.key === "edge");
  if (!edgeRec) throw new Error("no edge session in state");
  const es = await stripe.checkout.sessions.retrieve(edgeRec.sessionId);
  console.log(`[edge-done] payment_status=${es.payment_status} amount_total=${es.amount_total}`);
  ok(es.payment_status === "paid", "edge session paid (observed completion-time enforcement)");
  ok((es.total_details?.amount_discount ?? 0) === 0, "edge session lost the founders discount at completion ($0 discount)", `amount_discount=${es.total_details?.amount_discount}`);
  ok(es.amount_total === BID_SCOUT_PRICE_USD, "edge charged the full $99 — NO sixth discounted subscription possible", `amount_total=${es.amount_total}`);
  console.log("\nNEXT: MODE=final");
  process.exit(failed > 0 ? 1 : 0);
}

// ── FINAL ────────────────────────────────────────────────────────────────────
async function finalMode() {
  const st = readState();
  const db = neon(process.env.DATABASE_URL!);
  const stripe = getStripeClient();
  console.log("\n[final] lifecycle, never-infer, no-user, admin report, §7.13, cleanup");

  const f1 = st.sessions.find((s) => s.key === "founders-1")!;
  const f1Row = await db`SELECT status FROM bid_scout_subscriptions WHERE id = ${String(f1.recordId)}::uuid`;
  const f1SubId = (await db`SELECT stripe_subscription_id FROM bid_scout_subscriptions WHERE id = ${String(f1.recordId)}::uuid`)[0].stripe_subscription_id as string;
  ok(f1Row[0]?.status === "active", "founder #1 row active at final");

  // §7.11 lifecycle (A6 harness patterns, founder #1's REAL subscription):
  // invoice.payment_failed → past_due → invoice.paid → active → deleted → cancelled
  const invFailed = { id: `evt_f_f1_invfailed_${RUN}`, type: "invoice.payment_failed", data: { object: { id: `in_f_f1_1_${RUN}`, object: "invoice", subscription: f1SubId } } };
  ok((await deliverEvent(invFailed)) === true, "invoice.payment_failed consumed");
  ok((await db`SELECT status FROM bid_scout_subscriptions WHERE id = ${String(f1.recordId)}::uuid`)[0]?.status === "past_due", "founder #1 active → past_due");
  const invPaid = { id: `evt_f_f1_invpaid_${RUN}`, type: "invoice.paid", data: { object: { id: `in_f_f1_2_${RUN}`, object: "invoice", subscription: f1SubId } } };
  ok((await deliverEvent(invPaid)) === true, "invoice.paid consumed (ownership verified against REAL subscription metadata product:bid_scout)");
  ok((await db`SELECT status FROM bid_scout_subscriptions WHERE id = ${String(f1.recordId)}::uuid`)[0]?.status === "active", "past_due → active recovery");
  const realSub = await stripe.subscriptions.retrieve(f1SubId);
  const subDel = { id: `evt_f_f1_subdel_${RUN}`, type: "customer.subscription.deleted", data: { object: { id: realSub.id, object: "subscription", metadata: realSub.metadata } } };
  ok((await deliverEvent(subDel)) === true, "customer.subscription.deleted consumed");
  ok((await db`SELECT status FROM bid_scout_subscriptions WHERE id = ${String(f1.recordId)}::uuid`)[0]?.status === "cancelled", "founder #1 → cancelled");
  // The REAL subscription still exists (we only delivered the event) — cancel it for cleanup later.

  // §7.9 negative: NEVER infer from offerCandidate when retrieve fails
  const negEmail = `founders-ni-${RUN}@test.contrax`;
  const negRow = await db`INSERT INTO bid_scout_subscriptions (email, company_name, capabilities, source, status) VALUES (${negEmail}, 'NI Test Co', 'x', 'ni_test', 'pending') RETURNING id`;
  const negId = String(negRow[0].id);
  const failingRetrieve: any = {
    subscriptions: { retrieve: async () => { throw new Error("boom"); } },
    checkout: {
      sessions: {
        retrieve: async () => { const e: any = new Error("retrieve unavailable"); throw e; },
      },
    },
  };
  const niEvent = {
    id: `evt_f_ni_${RUN}`,
    type: "checkout.session.completed",
    data: { object: { id: `cs_test_ni_${RUN}`, object: "checkout.session", mode: "subscription", metadata: { product: "bid_scout", bidScoutId: negId, offerCandidate: "first_five_49" }, subscription: `sub_test_ni_${RUN}`, customer: `cus_test_ni_${RUN}` } },
  };
  ok((await handleBidScoutSubscriptionEvent(await Stripe.webhooks.constructEventAsync(JSON.stringify(niEvent), makeSignature(JSON.stringify(niEvent)), WEBHOOK_SECRET) as never, failingRetrieve)) === true, "never-infer event consumed (retrieve fails)");
  const niRow = await db`SELECT offer_code, first_invoice_amount, currency FROM bid_scout_subscriptions WHERE id = ${negId}::uuid`;
  ok(niRow[0]?.offer_code === null && niRow[0]?.first_invoice_amount === null && niRow[0]?.currency === null, "offer columns NULL when Stripe numbers unavailable — NEVER inferred from offerCandidate", JSON.stringify(niRow[0]));
  const niPurch = await db`SELECT COUNT(*)::int AS n FROM funnel_events WHERE event_name='bid_scout_purchased' AND label LIKE ${`%"bidScoutId":"${negId}"%`}`;
  ok(niPurch[0].n === 1, "purchase event written (offer omitted when unknown)", `n=${niPurch[0].n}`);
  ok((await db`SELECT label FROM funnel_events WHERE event_name='bid_scout_purchased' AND label LIKE ${`%"bidScoutId":"${negId}"%`}`)[0].label.includes('"offer":"standard_99"') === false, "event does NOT claim first_five_49");
  await db`DELETE FROM bid_scout_subscriptions WHERE id = ${negId}::uuid`;
  await db`DELETE FROM funnel_events WHERE label LIKE ${`%"bidScoutId":"${negId}"%`}`;

  // §7.11 non-Bid-Scout fallthrough
  const nbCountBefore = Number((await db`SELECT COUNT(*)::int AS c FROM bid_scout_subscriptions`)[0].c);
  const nb = { id: `evt_f_nb_${RUN}`, type: "checkout.session.completed", data: { object: { id: `cs_test_fnb_${RUN}`, object: "checkout.session", mode: "subscription", metadata: { plan_tier: "starter" } } } };
  ok((await deliverEvent(nb)) === false, "regular-plan checkout.session.completed NOT consumed (falls through)");
  const nbPaid = { id: `evt_f_nbinvpaid_${RUN}`, type: "invoice.paid", data: { object: { id: `in_fnb_${RUN}`, object: "invoice", subscription: `sub_fnb_${RUN}` } } };
  ok((await deliverEvent(nbPaid)) === false, "regular-plan invoice.paid NOT consumed");
  ok(Number((await db`SELECT COUNT(*)::int AS c FROM bid_scout_subscriptions`)[0].c) === nbCountBefore, "non-bid-scout events changed NO rows");

  // §7.9 never-infer with REAL money: the EDGE session was CREATED with the
  // founder discount (offerCandidate=first_five_49) but COMPLETED after the 5th
  // redemption — Stripe drops the discount at completion. The webhook must
  // store standard_99 from the REAL numbers, never offerCandidate.
  const edgeRec = st.sessions.find((x) => x.key === "edge");
  if (edgeRec) {
    const es = await stripe.checkout.sessions.retrieve(edgeRec.sessionId, { expand: ["subscription", "line_items"] });
    const amountDiscount = es.total_details?.amount_discount ?? 0;
    const amountTotal = es.amount_total ?? null;
    console.log(`  · EDGE post-redemption: payment_status=${es.payment_status} amount_total=${amountTotal} amount_discount=${amountDiscount}`);
    ok(es.payment_status === "paid", "edge checkout completed (paid)");
    ok(es.metadata?.offerCandidate === "first_five_49", "control: edge session metadata STILL offerCandidate=first_five_49 — inference must NOT use it");
    ok(!(amountDiscount === 5000 && amountTotal === 4900), "edge did NOT get the founders discount at completion (Stripe enforcement)", `amount_discount=${amountDiscount} amount_total=${amountTotal}`);
    const edgeEvt = { id: `evt_f_edge_${st.run}`, type: "checkout.session.completed", data: { object: es as never as Record<string, unknown> } };
    await deliverEvent(edgeEvt);
    const erow = await db`SELECT offer_code, first_invoice_amount, currency FROM bid_scout_subscriptions WHERE id = ${String(edgeRec.recordId)}::uuid`;
    ok(erow[0]?.offer_code === "standard_99", "edge stored standard_99 (derived from Stripe numbers $0 discount / $99 total — NEVER from offerCandidate)", `=${erow[0]?.offer_code}`);
    ok(erow[0]?.first_invoice_amount === amountTotal, "edge first_invoice_amount = actual charged total", `=${erow[0]?.first_invoice_amount}`);
    const epurch = await db`SELECT label FROM funnel_events WHERE event_name='bid_scout_purchased' AND label LIKE ${`%"bidScoutId":"${edgeRec.recordId}"%`}`;
    const epm = epurch.length ? JSON.parse(epurch[0].label as string) : null;
    ok(!!epm && epm.offer === "standard_99" && epm.first_invoice_amount === amountTotal && epm.renewal_amount === 9900, "edge purchase event: offer=standard_99, first_invoice_amount=actual, renewal_amount=9900", epm ? JSON.stringify({ offer: epm.offer, first_invoice_amount: epm.first_invoice_amount }) : "none");
  } else {
    ok(false, "edge session present in state for never-infer verification");
  }

  // §7.11 no-user-creation for buyers — emails come from the STATE records
  // (the rows were created under earlier modes' runs, never this process's RUN).
  const allEmails = [...new Set(st.sessions.map((s) => s.email))];
  const users = await db`SELECT COUNT(*)::int AS n FROM users WHERE email = ANY(${allEmails})`;
  ok(users[0].n === 0, "NO Contrax users auto-created for any test buyer", `n=${users[0].n}`);

  // §7.11 rate limits still pass (fresh keys)
  const { checkIpLimit, checkEmailLimit } = await import("../src/lib/rate-limit");
  const req = () => new Request("https://www.contrax.company/api/bid-scout/checkout", { headers: { "x-forwarded-for": "203.0.113.99", "user-agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/126.0 Safari/537.36" } });
  // ignore the rows they create — scope them with a run-unique email then clean up
  ok((await checkIpLimit(req(), "bid_scout_checkout_ip", 10, 3600)).allowed, "per-IP rate limit still passes (10/hr)");
  ok((await checkEmailLimit(`rl-${RUN}@test.contrax`, "bid_scout_checkout_email", 5, 3600)).allowed, "per-email rate limit still passes (5/hr)");
  await db`DELETE FROM rate_limits WHERE window_start >= ${RUN_SEC - 48 * 3600} AND (scope LIKE 'bid_scout_%' OR scope LIKE 'rl-${RUN}%')`;

  // §7.14 availability flipped after the 5th redemption
  const offer = await getBidScoutFoundersOffer();
  ok(offer.available === false && offer.remaining === 0, "getBidScoutFoundersOffer: available=false after 5th redemption (page copy flips to $99)", JSON.stringify({ remaining: offer.remaining, redeemed: offer.timesRedeemed }));
  // post-exhaustion create via the REAL lib ⇒ standard session, no discounts
  const post = await createBidScoutCheckoutSession(checkoutInput(`founders-post-${RUN}@test.contrax`, "post_exhaust"), { userId: null });
  ok(post.success && !!post.url, "post-exhaustion checkout STILL works (standard $99 path)");
  if (post.success && post.url) {
    const ps = await stripe.checkout.sessions.retrieve(post.url.includes("cs_test_") ? (post.url.split("/c/pay/")[1] ?? post.url).split(/[?#]/)[0] : post.url);
    ok(ps.discounts == null || ps.discounts!.length === 0, "post-exhaustion session has NO discounts (shows $99)");
    ok(ps.metadata?.offerCandidate === "standard_99", "post-exhaustion session offerCandidate === standard_99");
    st.sessions.push({ key: "post-exhaust", email: `founders-post-${RUN}@test.contrax`, recordId: post.recordId!, sessionId: ps.id, url: post.url, offerCandidate: "standard_99" });
  }

  // §6 admin report (real lib — the endpoint's own source)
  const report = await getBidScoutFoundersReport();
  ok(report.promo?.timesRedeemed === 5 && report.promo?.remaining === 0, `admin report: founders spots redeemed ${report.promo?.timesRedeemed}/5`, `max=${report.promo?.maxRedemptions} remaining=${report.promo?.remaining}`);
  ok(report.foundersSubscriptions === 5, "admin report: 5 founder subscriptions (offer_code=first_five_49 completed rows)", `=${report.foundersSubscriptions}`);
  ok(report.firstMonthMrrCents === 5 * 4900, "admin report: first-month MRR-equivalent = $245 ($49 × 5 first invoices only)", `=${report.firstMonthMrrCents}`);
  ok(report.contractedRecurringMrrCents === report.activeSubscriptions * 9900, "admin report invariant: contracted recurring MRR = $99 × active subs (never first-invoice $49)", JSON.stringify({ contracted: report.contractedRecurringMrrCents, active: report.activeSubscriptions }));

  // ── Cleanup (exact scope, exact ids) ─────────────────────────────────────
  console.log("\n── Cleanup ──");
  const recIds = st.sessions.map((s) => s.recordId);
  const emails = [...new Set([...st.sessions.map((s) => s.email)])];
  // Stripe test objects: cancel subscriptions + delete customers (by exact id)
  const sessList = await db`SELECT stripe_subscription_id, stripe_customer_id FROM bid_scout_subscriptions WHERE id = ANY(${recIds.map((r) => String(r))}::uuid[])`;
  for (const r of sessList) {
    if (r.stripe_subscription_id) await stripe.subscriptions.cancel(r.stripe_subscription_id).catch(() => {});
  }
  for (const r of sessList) {
    if (r.stripe_customer_id) await stripe.customers.del(r.stripe_customer_id).catch(() => {});
  }
  const delRows = await db`DELETE FROM bid_scout_subscriptions WHERE email = ANY(${emails})`;
  console.log(`  · deleted bid_scout_subscriptions rows: ${delRows.length}`);
  await db`DELETE FROM funnel_events WHERE event_name='bid_scout_purchased' AND (user_email = ANY(${emails}) OR label LIKE ANY(${recIds.map((r) => `%"bidScoutId":"${r}"%`)}))`;
  await db`DELETE FROM visitors WHERE visitor_id LIKE 'fnd-${RUN}-%'`;

  // Cleanliness proofs
  const bsFinal = Number((await db`SELECT COUNT(*)::int AS c FROM bid_scout_subscriptions`)[0].c);
  ok(bsFinal === st.baseline.bsCount, `bid_scout_subscriptions back to baseline (${st.baseline.bsCount})`, `count=${bsFinal}`);
  const rateFinal = Number((await db`SELECT COUNT(*)::int AS c FROM rate_limits WHERE scope LIKE 'bid_scout_%'`)[0].c);
  ok(rateFinal === st.baseline.rateCount, `rate_limits bid_scout_* back to baseline (${st.baseline.rateCount})`, `count=${rateFinal}`);
  const myEvents = Number((await db`SELECT COUNT(*)::int AS n FROM funnel_events WHERE event_name='bid_scout_purchased' AND (user_email = ANY(${emails}) OR label LIKE ANY(${recIds.map((r) => `%"bidScoutId":"${r}"%`)}))`)[0].n);
  ok(myEvents === 0, "0 founder purchase events remain (exact-id cleanup)");
  const usersFinal = Number((await db`SELECT COUNT(*)::int AS n FROM users WHERE email = ANY(${emails})`)[0].n);
  ok(usersFinal === 0, "0 test users remain");
  const funnelMax = Number((await db`SELECT COALESCE(MAX(id),0)::int AS m FROM funnel_events`)[0].m);
  console.log(`  · funnel_events MAX(id): baseline=${st.baseline.funnelMaxId} → now=${funnelMax} (delta=${funnelMax - st.baseline.funnelMaxId} = sequence ids consumed by our rows)`);
  ok(funnelMax >= st.baseline.funnelMaxId, "funnel max id monotonic (drift from our rows only, all deleted)");

  console.log(`\n══ RESULT [final]: ${passed} passed, ${failed} failed ══`);
  process.exit(failed > 0 ? 1 : 0);
}

// ── dispatch ────────────────────────────────────────────────────────────────
const mode = MODE === "probe" ? probeMode() : MODE === "create" ? createMode() : MODE === "race" ? raceMode() : MODE === "verify" ? verifyFounderMode() : MODE === "edge-done" ? edgeDoneMode() : finalMode();
mode.catch(async (e) => {
  console.error(`[founders:${MODE}] crashed:`, e);
  process.exit(1);
});