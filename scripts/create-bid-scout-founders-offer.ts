/**
 * Bid Scout Founders first-five offer — ONE-TIME Stripe setup (owner spec
 * 2026-09-11 §2). Creates the coupon + promotion code pair in the environment
 * your STRIPE_SECRET_KEY points at.
 *
 *   coupon:        "Bid Scout Founders — $50 off first month"
 *                  amount_off 5_000, currency usd, duration once,
 *                  metadata { product:"bid_scout", offer:"first_five_49_first_month" }
 *   promotionCode: code "BIDSCOUTFIRST5", coupon ref, max_redemptions 5,
 *                  restrictions.first_time_transaction true, same metadata.
 *
 * SAFETY:
 *   · REFUSES live keys (sk_live_*) — the LIVE promo is created by the OWNER
 *     in the Stripe dashboard (no live key is stored machine-side). This
 *     script is TEST-mode only.
 *   · Refuses to run without CONFIRM=1 (explicit intent).
 *   · Logs ONLY ids (livemode, couponId, promotionCodeId, code,
 *     maxRedemptions) — never the API key, never the secret.
 *   · NEVER called from the application or checkout route (pricing objects are
 *     dashboard/script-created once; the app only RETRIEVES — see
 *     getBidScoutFoundersOffer in src/lib/bid-scout.ts).
 *
 * After a run, set STRIPE_BID_SCOUT_FOUNDERS_PROMO_ID for that environment
 * (Vercel preview/local = the test id; production = the live id).
 *
 * Usage (TEST mode only):
 *   source /etc/profile.d/zz-stripe-ops.sh
 *   export STRIPE_SECRET_KEY=$STRIPE_TEST_SECRET_KEY
 *   CONFIRM=1 bun run scripts/create-bid-scout-founders-offer.ts
 */
import Stripe from "stripe";

const API_VERSION = "2024-12-18.acacia"; // same version the codebase uses (src/lib/stripe.ts)

async function main() {
  const key = process.env.STRIPE_SECRET_KEY;
  if (!key) {
    console.error("REFUSING: STRIPE_SECRET_KEY is not set.");
    process.exit(1);
  }
  if (key.startsWith("sk_live_")) {
    console.error(
      "REFUSING: live secret key detected — the LIVE founders promo must be created " +
        "by the OWNER in the Stripe dashboard (same coupon+code spec). This script is TEST-mode only.",
    );
    process.exit(1);
  }
  if (process.env.CONFIRM !== "1") {
    console.error(
      "REFUSING: pass CONFIRM=1 to run (creates a coupon + promotion code in TEST mode).",
    );
    process.exit(1);
  }

  const stripe = new Stripe(key, { apiVersion: API_VERSION as any });

  const coupon = await stripe.coupons.create({
    name: "Bid Scout Founders — $50 off first month",
    amount_off: 5_000,
    currency: "usd",
    duration: "once",
    metadata: { product: "bid_scout", offer: "first_five_49_first_month" },
  });

  const promo = await stripe.promotionCodes.create({
    code: "BIDSCOUTFIRST5",
    coupon: coupon.id,
    max_redemptions: 5,
    restrictions: { first_time_transaction: true },
    metadata: { product: "bid_scout", offer: "first_five_49_first_month" },
  } as any); // v22 types omit coupon param — API accepts it (verified in probe)

  // IDs ONLY — never the key/secret.
  console.log(
    JSON.stringify(
      {
        livemode: promo.livemode,
        couponId: coupon.id,
        promotionCodeId: promo.id,
        code: promo.code,
        maxRedemptions: promo.max_redemptions,
      },
      null,
      2,
    ),
  );
  console.log(
    `\nNext: set STRIPE_BID_SCOUT_FOUNDERS_PROMO_ID=${promo.id} for this environment ` +
      `(test → Vercel preview + local; live → Vercel production).`,
  );
}

main().catch((e) => {
  console.error("❌ Setup failed:", (e as Error).message);
  process.exit(1);
});