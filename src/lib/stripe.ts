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

// ── Client Initialization ──────────────────────────────────────────────────────

let stripeClient: Stripe | null = null;

export function getStripe(): Stripe {
  if (stripeClient) return stripeClient;

  const key = process.env.STRIPE_SECRET_KEY;
  if (!key) {
    throw new Error("STRIPE_SECRET_KEY is not set");
  }
  stripeClient = new Stripe(key, {
    apiVersion: "2025-06-16.acacia" as any, // Latest stable at time of writing
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
  starter: "price_1TxnzpRgqhxm74mTkyEfvYdY",
  professional: "price_1TxnzpRgqhxm74mThJnrL2XA",
  agency: "price_1TxnzqRgqhxm74mTl1LeJ0rl",
  savings_premium: "price_1Tz7wZRgqhxm74mTtb7yMkXs",
};

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

    for (const price of prices.data) {
      const product = price.product as Stripe.Product | undefined;
      if (!product) continue;

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

const BASE_URL = process.env.PROD_URL || "https://contrax.company";

/**
 * Create a Stripe Checkout Session for a given plan tier.
 *
 * The returned URL should be used to redirect the customer to Stripe's hosted
 * checkout page. On completion, the webhook handler will receive the
 * `checkout.session.completed` event with `metadata.plan_tier` set.
 */
export async function createCheckoutSession(
  planTier: PlanTier,
): Promise<CreateCheckoutSessionResult> {
  try {
    const priceId = await getPriceIdForPlanTier(planTier);

    const session = await getStripe().checkout.sessions.create({
      mode: "payment",
      line_items: [
        {
          price: priceId,
          quantity: 1,
        },
      ],
      metadata: {
        plan_tier: planTier,
      },
      success_url: `${BASE_URL}/post-checkout?session_id={CHECKOUT_SESSION_ID}&plan=${planTier}`,
      cancel_url: `${BASE_URL}/pricing`,
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

  try {
    const db = sql();

    // Look for existing user by email
    const existing = await db`
      SELECT id, email FROM users WHERE email = ${email}
    `;

    let userId: number;

    if (existing.length > 0) {
      // Update existing user with Stripe info
      userId = existing[0].id as number;
      await db`
        UPDATE users
        SET stripe_customer_id = ${stripeCustomerId ?? null},
            subscription_status = 'active',
            plan_tier = ${planTier}
        WHERE id = ${userId}
      `;
    } else {
      // Create new user with a secure random password
      const passwordHash = await Bun.password.hash(
        crypto.randomUUID() + crypto.randomUUID(),
      );
      const inserted = await db`
        INSERT INTO users (email, password_hash, stripe_customer_id, subscription_status, plan_tier)
        VALUES (${email}, ${passwordHash}, ${stripeCustomerId ?? null}, 'active', ${planTier})
        RETURNING id
      `;
      userId = inserted[0].id as number;
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
