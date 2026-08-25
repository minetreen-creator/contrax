/**
 * Stripe integration for Contrax.
 *
 * Provides Stripe client initialization, webhook handling, and Checkout Session
 * creation for the post-checkout flow — when a user pays on Stripe, this
 * creates/links their Contrax account and returns a session token so they can
 * be logged in automatically.
 */

import Stripe from "stripe";
import { sql } from "~/db";
import { sendWelcomeEmail } from "~/lib/email";
import { hashPassword } from "~/lib/password";

// ── Client Initialization ──────────────────────────────────────────────────────

let stripeClient: Stripe | null = null;

export function getStripe(): Stripe {
  if (stripeClient) return stripeClient;

  const key = process.env.STRIPE_SECRET_KEY;
  if (!key) {
    throw new Error("STRIPE_SECRET_KEY is not set");
  }
  stripeClient = new Stripe(key, {
    apiVersion: "2024-12-18.acacia" as any, // Latest stable at time of writing
  });
  return stripeClient;
}

// ── Types ──────────────────────────────────────────────────────────────────────

export interface WebhookResult {
  success: boolean;
  token?: string;
  email?: string;
  planTier?: string | null;
  redirectTo?: string;
  error?: string;
}

export type PlanTier = "starter" | "professional" | "agency" | "savings_premium";

export interface CreateCheckoutSessionResult {
  success: boolean;
  url?: string;
  error?: string;
}

// ── Plan Tier → Price ID Mapping ───────────────────────────────────────────────
//
// These are the Stripe Price IDs for each plan tier. They are populated via
// the dynamic lookup (getPriceIdForPlanTier) which queries the Stripe API.
// The hardcoded map below serves as a fallback. Update these when the Stripe
// products are created or if the price IDs change.
//
// To find the correct price IDs, run:
//   bun -e 'import Stripe from "stripe"; const s = new Stripe(process.env.STRIPE_SECRET_KEY!);
//   s.prices.list({limit:20}).then(p => p.data.forEach(pr => console.log(pr.id, pr.product, pr.unit_amount)))'

const FALLBACK_PRICE_IDS: Record<PlanTier, string | null> = {
  starter: "price_1U2y1cGdL43e7acF50TNgt3n",
  professional: "price_1U2y2yGdL43e7acFIKCGrdQj",
  agency: "price_1U2y3vGdL43e7acFXKIkatzr",
  savings_premium: "price_1Tz7wZRgqhxm74mTtb7yMkXs",
};

/** Expected unit_amount (in cents) for each plan tier. Used to filter out
 *  stale active prices in the Stripe catalog when looking up by product name. */
const EXPECTED_UNIT_AMOUNTS: Record<PlanTier, number | null> = {
  starter: 1900,       // $19.00
  professional: 7900,  // $79.00
  agency: 19900,       // $199.00
  savings_premium: null, // one-time price — amount varies
};

// ── Veterans Against Diabetes (VAD) partner pricing ────────────────────────────
//
// VAD partner members get EXCLUSIVE pricing for the first 12 months via the
// `VAD26` server-side verification code (entered on the /vad partner page):
//   - Starter:      $14/mo  (normally $19)
//   - Professional: $59/mo  (normally $79)
//   - Agency:       $149/mo (normally $199)
//
// This is NOT a Stripe promo/discount code — `VAD26` is OUR OWN code. When the
// code is presented, the checkout simply uses dedicated exact VAD Stripe prices
// for the tier ($14/$59/$149 recurring). The webhook still grants the customer
// the NORMAL tier (starter/professional/agency) via `plan_tier` metadata; only
// the price differs, so a VAD member gets the exact same product/features.

/** Expected VAD unit_amount (in cents) for the three VAD-paid tiers — used to
 *  prefer the exact VAD price if multiple active VAD prices exist for a tier. */
const VAD_EXPECTED_UNIT_AMOUNTS: Partial<Record<PlanTier, number>> = {
  starter: 1400,        // $14.00
  professional: 5900,   // $59.00
  agency: 14900,        // $149.00
};

/**
 * FALLBACK VAD Stripe Price IDs for each VAD-paid tier.
 *
 * NOTE: These are placeholders — the REAL VAD price IDs are not yet created in
 * Stripe. `getVadPriceIdForPlanTier` prefers the live API lookup (products/prices
 * tagged `vad: "true"` + `plan_tier` matching), and only falls back to this map
 * if the API lookup fails or returns no match. Once the VAD prices are created
 * in Stripe (and tagged with metadata), the API lookup will resolve them
 * automatically. If you prefer to hardcode them instead, replace the `""`
 * placeholders below with the real price IDs (e.g. from
 * `bun -e '...s.prices.list({limit:100})...'` filtering for `vad:"true"` prices).
 */
const FALLBACK_VAD_PRICE_IDS: Partial<Record<PlanTier, string>> = {
  starter: "",        // TODO: replace with real VAD Starter ($14/mo) Stripe price ID
  professional: "",   // TODO: replace with real VAD Professional ($59/mo) Stripe price ID
  agency: "",         // TODO: replace with real VAD Agency ($149/mo) Stripe price ID
};

/**
 * Look up the dedicated VAD Stripe Price ID for a given plan tier.
 *
 * Queries the Stripe API for active prices whose product/price metadata marks
 * them as VAD prices (`vad: "true"`) AND whose product `metadata.plan_tier`
 * matches the requested tier. Prefers the exact expected VAD unit_amount if
 * several VAD prices exist for a tier. Falls back to FALLBACK_VAD_PRICE_IDS.
 *
 * Throws if no VAD price can be resolved for the tier.
 */
async function getVadPriceIdForPlanTier(planTier: PlanTier): Promise<string> {
  const stripe = getStripe();
  const expectedAmount = VAD_EXPECTED_UNIT_AMOUNTS[planTier];

  try {
    const prices = await stripe.prices.list({
      active: true,
      expand: ["data.product"],
      limit: 100,
    });

    const matching: Stripe.Price[] = [];
    for (const price of prices.data) {
      const product = price.product as Stripe.Product | undefined;
      if (!product) continue;
      // Match only prices/products explicitly tagged as VAD.
      const isVad = price.metadata?.vad === "true" || product.metadata?.vad === "true";
      if (!isVad) continue;
      // The tier must match on the product's plan_tier metadata.
      if (product.metadata?.plan_tier !== planTier) continue;
      matching.push(price);
    }

    if (matching.length > 0) {
      // Prefer the exact expected VAD amount if present; otherwise the first.
      const exact = matching.find(
        (p) => expectedAmount != null && p.unit_amount === expectedAmount,
      );
      return (exact ?? matching[0]).id;
    }

    console.warn(
      `No VAD Stripe price found for plan_tier="${planTier}" via API lookup — ` +
        `ensure a price exists with price/product metadata vad="true" and ` +
        `product metadata.plan_tier="${planTier}"`,
    );
  } catch (err) {
    console.warn(
      `VAD Stripe price lookup failed (will try fallback): ${(err as Error).message}`,
    );
  }

  const fallback = FALLBACK_VAD_PRICE_IDS[planTier];
  if (fallback) return fallback;

  throw new Error(
    `No VAD Stripe price ID configured for plan_tier="${planTier}". ` +
      `Create the VAD price in Stripe (metadata vad="true" + product ` +
      `plan_tier="${planTier}") or fill FALLBACK_VAD_PRICE_IDS in src/lib/stripe.ts.`,
  );
}

/**
 * Look up the Stripe Price ID for a given plan tier.
 *
 * Queries the Stripe API for active prices, then matches by product name or
 * metadata.plan_tier. Falls back to the FALLBACK_PRICE_IDS map if the API
 * lookup fails or returns no results.
 */
async function getPriceIdForPlanTier(planTier: PlanTier): Promise<string> {
  const stripe = getStripe();

  try {
    // Fetch all active prices with expanded product data
    const prices = await stripe.prices.list({
      active: true,
      expand: ["data.product"],
      limit: 100,
    });

    // Plan tier → search terms for matching
    const productNameMap: Record<PlanTier, string> = {
      starter: "Starter",
      professional: "Professional",
      agency: "Agency",
      savings_premium: "Premium",
    };

    const targetName = productNameMap[planTier];

    const expectedAmount = EXPECTED_UNIT_AMOUNTS[planTier];

    for (const price of prices.data) {
      const product = price.product as Stripe.Product | undefined;
      if (!product) continue;

      // Skip prices whose unit_amount doesn't match what we expect —
      // this prevents stale active prices (e.g. old $49/$149/$399) from
      // being returned when the catalog has both old and new prices active.
      if (expectedAmount !== null && price.unit_amount !== expectedAmount) {
        continue;
      }

      // Match by metadata.plan_tier first
      if (product.metadata?.plan_tier === planTier) {
        return price.id;
      }

      // Match by product name
      if (
        product.name &&
        product.name.toLowerCase().includes(targetName.toLowerCase())
      ) {
        return price.id;
      }
    }

    // If no match found via API, try the hardcoded fallback
    console.warn(
      `No Stripe price found for plan_tier="${planTier}" via API lookup — ` +
        `ensure products have metadata.plan_tier set in the Stripe dashboard`,
    );
  } catch (err) {
    console.warn(
      `Stripe price lookup failed (will try fallback): ${(err as Error).message}`,
    );
  }

  // Fallback to hardcoded map
  const fallback = FALLBACK_PRICE_IDS[planTier];
  if (fallback) return fallback;

  throw new Error(
    `No Stripe price ID configured for plan_tier="${planTier}". ` +
      `Set metadata.plan_tier on the product in the Stripe dashboard, or ` +
      `update FALLBACK_PRICE_IDS in src/lib/stripe.ts.`,
  );
}

// ── Checkout Session Creation ──────────────────────────────────────────────────

const BASE_URL = process.env.PROD_URL || "https://www.contrax.company";

export type CheckoutMode = "payment" | "subscription";

export interface CreateCheckoutSessionOptions {
  /** Logged-in Contrax user id — stored in session metadata so the webhook can
   *  attribute the payment to the right account without relying on email. */
  userId?: number | string | null;
  /**
   * "payment" for one-time prices, "subscription" for recurring (monthly)
   * prices. Defaults to "subscription" — all three Contrax plans are billed
   * monthly, and a recurring price rejected in "payment" mode.
   */
  mode?: CheckoutMode;
  /**
   * Optional server-side verification code. The only supported value is
   * "VAD26" (Veterans Against Diabetes partner code). When present, the
   * checkout uses the dedicated exact VAD Stripe price for the tier instead of
   * the standard one, and `promo_code: "VAD26"` is recorded on the session
   * metadata for attribution. This is NOT a Stripe promo/discount code — it is
   * our own server-side verification that selects pre-existing VAD prices.
   */
  promoCode?: string;
}

/**
 * Create a Stripe Checkout Session for a given plan tier.
 *
 * The returned URL should be used to redirect the customer to Stripe's hosted
 * checkout page. On completion, the webhook handler will receive the
 * `checkout.session.completed` event with `metadata.plan_tier` (and
 * `metadata.user_id` when the buyer was logged in) set.
 */
export async function createCheckoutSession(
  planTier: PlanTier,
  opts: CreateCheckoutSessionOptions = {},
): Promise<CreateCheckoutSessionResult> {
  try {
    const isVad = opts.promoCode === "VAD26";
    const priceId = isVad
      ? await getVadPriceIdForPlanTier(planTier)
      : await getPriceIdForPlanTier(planTier);
    const mode: CheckoutMode = opts.mode ?? "subscription";

    const metadata: Record<string, string> = { plan_tier: planTier };
    if (opts.userId != null) {
      metadata.user_id = String(opts.userId);
    }
    if (isVad) {
      metadata.promo_code = "VAD26";
    }

    const session = await getStripe().checkout.sessions.create({
      mode,
      line_items: [
        {
          price: priceId,
          quantity: 1,
        },
      ],
      metadata,
      success_url: `${BASE_URL}/post-checkout?session_id={CHECKOUT_SESSION_ID}&plan=${planTier}`,
      cancel_url: `${BASE_URL}/`,
    });

    if (!session.url) {
      return { success: false, error: "Stripe did not return a checkout URL" };
    }

    return { success: true, url: session.url };
  } catch (err) {
    const message = (err as Error).message;
    console.error("Failed to create Stripe checkout session:", message);
    return { success: false, error: message };
  }
}

// ── Webhook Handler ────────────────────────────────────────────────────────────

const SESSION_TTL_DAYS = 30;

/**
 * Process a Stripe webhook event.
 *
 * @param body - Raw request body string (must be raw, not JSON-parsed)
 * @param signature - The `stripe-signature` header value
 * @returns Result with session token and redirect info, or an error
 */
export async function handleStripeWebhook(
  body: string,
  signature: string,
): Promise<WebhookResult> {
  const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;
  if (!webhookSecret) {
    console.warn("STRIPE_WEBHOOK_SECRET not set — cannot verify webhook signatures");
    return { success: false, error: "Webhook secret not configured" };
  }

  let event: Stripe.Event;
  try {
    const stripe = getStripe();
    event = stripe.webhooks.constructEvent(body, signature, webhookSecret);
  } catch (err) {
    console.error("Stripe webhook signature verification failed:", (err as Error).message);
    return { success: false, error: "Invalid signature" };
  }

  // Only handle checkout.session.completed
  if (event.type !== "checkout.session.completed") {
    return { success: true }; // Acknowledge but no action needed
  }

  const session = event.data.object as Stripe.Checkout.Session;

  // Extract customer details
  const customerEmail = session.customer_details?.email;
  const stripeCustomerId =
    typeof session.customer === "string" ? session.customer : session.customer?.id;
  const stripeSubscriptionId =
    typeof session.subscription === "string"
      ? session.subscription
      : session.subscription?.id ?? null;

  if (!customerEmail) {
    console.error("Checkout session completed without customer email:", session.id);
    return { success: false, error: "No customer email in session" };
  }

  const email = customerEmail.trim().toLowerCase();

  // Determine plan tier from session metadata (set by createCheckoutSession).
  // Falls back to null for legacy payment links that don't pass metadata.
  let planTier: string | null = session.metadata?.plan_tier ?? null;

  if (!planTier) {
    console.warn(
      `Checkout session ${session.id} has no plan_tier metadata — ` +
        `the customer may have used a legacy payment link. ` +
        `plan_tier will be null; upgrade them manually if needed.`,
    );
  }

  // When the buyer was logged in, createCheckoutSession stored their Contrax
  // user id in metadata — attribute the payment to that account directly.
  const metadataUserId = session.metadata?.user_id
    ? Number(session.metadata.user_id)
    : null;

  try {
    const db = sql();

    let userId: number | null = null;

    if (metadataUserId && Number.isInteger(metadataUserId)) {
      // Prefer the account captured at checkout time (most reliable).
      const byId = await db`
        SELECT id FROM users WHERE id = ${metadataUserId} LIMIT 1
      `;
      if (byId.length > 0) {
        userId = (byId[0] as { id: number }).id;
      } else {
        console.warn(
          `Checkout session ${session.id} references user_id=${metadataUserId} ` +
            `which does not exist — falling back to email match`,
        );
      }
    }

    if (userId == null) {
      // Look for existing user by email
      const existing = await db`
        SELECT id FROM users WHERE email = ${email} LIMIT 1
      `;
      if (existing.length > 0) {
        userId = (existing[0] as { id: number }).id;
      }
    }

    if (userId != null) {
      // Update existing user with Stripe info; payment ends the trial for good
      await db`
        UPDATE users
        SET stripe_customer_id = ${stripeCustomerId ?? null},
            stripe_subscription_id = ${stripeSubscriptionId},
            subscription_status = 'active',
            plan_tier = ${planTier},
            trial_started_at = NULL
        WHERE id = ${userId}
      `;
    } else {
      // Create new user with a secure random password
      const passwordHash = await hashPassword(
        crypto.randomUUID() + crypto.randomUUID(),
      );
      const inserted = await db`
        INSERT INTO users (email, password_hash, stripe_customer_id, stripe_subscription_id, subscription_status, plan_tier, trial_started_at)
        VALUES (${email}, ${passwordHash}, ${stripeCustomerId ?? null}, ${stripeSubscriptionId}, 'active', ${planTier}, NULL)
        RETURNING id
      `;
      userId = (inserted[0] as { id: number }).id;
    }

    // Create session token
    const token = crypto.randomUUID();
    const expiresAt = new Date(
      Date.now() + SESSION_TTL_DAYS * 24 * 60 * 60 * 1000,
    );

    await db`
      INSERT INTO sessions (user_id, token, expires_at)
      VALUES (${userId}, ${token}, ${expiresAt.toISOString()})
    `;

    // Fire-and-forget welcome email — don't block the webhook response
    sendWelcomeEmail(email).catch((err) => {
      console.error("Failed to send welcome email:", (err as Error).message);
    });

    // Determine redirect target based on plan tier
    const redirectTo = planTier === "savings_premium"
      ? "/savings/dashboard"
      : "/dashboard?onboarding=true";

    return {
      success: true,
      token,
      email,
      planTier,
      redirectTo,
    };
  } catch (err) {
    console.error("Failed to process Stripe checkout:", (err as Error).message);
    return { success: false, error: "Database error" };
  }
}

// ── Session-cookie → user resolution (for raw API-route interceptors) ──────────
//
// The Stripe API endpoints live behind lightweight interceptors in serve.ts /
// vercel-entry.ts (they must handle raw bodies before SSR). Those interceptors
// can't use the @tanstack/react-start server cookie helpers, so they pass the
// raw `cookie` header here. Returns the logged-in user id, or null.

const SESSION_COOKIE_NAME = "contrax_session";

export function parseSessionCookie(cookieHeader: string | null | undefined): string | null {
  if (!cookieHeader) return null;
  for (const part of cookieHeader.split(";")) {
    const idx = part.indexOf("=");
    if (idx === -1) continue;
    const name = part.slice(0, idx).trim();
    if (name === SESSION_COOKIE_NAME) {
      const value = part.slice(idx + 1).trim();
      return value || null;
    }
  }
  return null;
}

export async function resolveUserIdFromCookie(
  cookieHeader: string | null | undefined,
): Promise<number | null> {
  const token = parseSessionCookie(cookieHeader);
  if (!token) return null;
  try {
    const rows = await sql()`
      SELECT s.user_id FROM sessions s
      WHERE s.token = ${token} AND s.expires_at > NOW()
      LIMIT 1
    `;
    if (rows.length === 0) return null;
    return (rows[0] as { user_id: number }).user_id;
  } catch (err) {
    console.error("Failed to resolve user from session cookie:", (err as Error).message);
    return null;
  }
}
