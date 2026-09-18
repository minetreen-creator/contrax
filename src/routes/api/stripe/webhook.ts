import { createFileRoute } from "@tanstack/react-router";
import { handleStripeWebhook } from "~/lib/stripe";

/**
 * POST /api/stripe/webhook
 *
 * Stripe webhook endpoint. Requires the `stripe-signature` header; the raw
 * request body is verified against STRIPE_WEBHOOK_SECRET before any DB work.
 *
 * ONE endpoint, THREE product lines — the dispatcher in src/lib/stripe.ts
 * (handleStripeWebhook) consumes an event for whichever line owns it, in this
 * order, and stops:
 *
 *   1. Bid Scout ($99/month, bid_scout_subscriptions) — src/lib/bid-scout.ts
 *   2. Contrax Grants ($19/month, grants_subscriptions)
 *         — src/lib/grants-subscription.server.ts
 *   3. Contrax plan TIERS (Starter/Professional/Agency, state on the `users`
 *      row) — src/lib/tier-subscription.server.ts:
 *        customer.subscription.updated / .deleted (cancel → plan downgrade to
 *        'basic'), invoice.paid / invoice_payment.paid (→ active),
 *        invoice.payment_failed (→ past_due)
 *
 * Handles `checkout.session.completed` for the plan tiers:
 *   - sets the user's plan_tier to the purchased tier
 *   - sets subscription_status = 'active'
 *   - clears trial_started_at (payment ends the 14-day trial)
 *   - stores the Stripe customer id and subscription id on the user
 *
 * The user is matched by `metadata.user_id` (set at checkout when logged in),
 * falling back to `customer_details.email`. A brand-new user is created when
 * neither matches (e.g. legacy payment links).
 *
 * NOTE: in production this endpoint is served by the lightweight interceptor
 * in vercel-entry.ts (raw-body handling must happen before SSR). This route
 * file is the canonical TanStack implementation — used by `vite dev` and kept
 * in lockstep with the interceptor, both delegating to handleStripeWebhook.
 */

async function handler({ request }: { request: Request }) {
  try {
    const signature = request.headers.get("stripe-signature");
    if (!signature) {
      return Response.json({ error: "Missing signature" }, { status: 400 });
    }

    // Must be the RAW body — Stripe signs the exact bytes received
    const body = await request.text();

    const result = await handleStripeWebhook(body, signature);

    if (!result.success) {
      const status = result.error === "Invalid signature" ? 400 : 500;
      return Response.json({ error: result.error }, { status });
    }

    return Response.json({ received: true });
  } catch (err) {
    console.error("[stripe-webhook] failed:", err);
    return Response.json({ error: "Internal server error" }, { status: 500 });
  }
}

export const Route = createFileRoute("/api/stripe/webhook")({
  server: { handlers: { POST: handler } },
});
