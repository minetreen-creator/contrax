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
  starter: "price_1U0KVIGdL43e7acFz6JxgRfO",
  professional: "price_1U0KWFGdL43e7acFg4YV4l37",
  agency: "price_1U0KWFGdL43e7acFb4xrwVpb",
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
    const priceId = await getPriceIdForPlanTier(planTier);
    const mode: CheckoutMode = opts.mode ?? "subscription";

    const metadata: Record<string, string> = { plan_tier: planTier };
    if (opts.userId != null) {
      metadata.user_id = String(opts.userId);
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
