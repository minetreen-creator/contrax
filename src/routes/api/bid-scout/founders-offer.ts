import { createFileRoute } from "@tanstack/react-router";
import { getBidScoutFoundersOffer, BID_SCOUT_FOUNDERS_LIMIT } from "~/lib/bid-scout";

/**
 * GET /api/bid-scout/founders-offer
 *
 * Server-side founders-availability read for the /bid-scout landing page
 * (owner spec 2026-09-11 §5). The Stripe Promotion Code is RETRIEVED on the
 * server (never touched, never created); the response exposes ONLY the
 * informational fields the page needs — no Stripe secrets, no keys, no
 * customer data. When STRIPE_BID_SCOUT_FOUNDERS_PROMO_ID is unset (or the
 * code is inactive/exhausted) this returns available:false and the page shows
 * the standard $99 copy. Display is informational — Stripe's max_redemptions
 * remains the concurrency authority for the checkout itself (the checkout
 * endpoint handles the create-time race with isPromotionUnavailableError).
 */
async function handler(): Promise<Response> {
  const offer = await getBidScoutFoundersOffer();
  return Response.json({
    available: offer.available,
    remaining: offer.remaining,
    maxRedemptions: BID_SCOUT_FOUNDERS_LIMIT,
  });
}

export const Route = createFileRoute("/api/bid-scout/founders-offer")({
  server: { handlers: { GET: handler } },
});