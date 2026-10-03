import { createFileRoute } from "@tanstack/react-router";
import {
  FOUNDING_MEMBER_LIMIT,
  FOUNDING_MEMBER_UNIT_AMOUNT,
  foundingSpotsRemaining,
} from "~/lib/stripe";

/**
 * GET /api/founding-offer → { available, remaining, limit, monthlyUsd }
 *
 * Public: how many founding-member spots (Starter at $9/month for life, owner
 * 2026-10-03) are left, read live from Stripe. `available` is false when all
 * spots are taken or the count cannot be read (the UI then hides the offer).
 * Edge-cached for 5 minutes so the pricing pages don't each cost a Stripe call;
 * the checkout itself re-checks the live count, so the cache can never sell an
 * 11th spot.
 */
async function handler(): Promise<Response> {
  const remaining = await foundingSpotsRemaining();
  return Response.json(
    {
      available: remaining !== null && remaining > 0,
      remaining: remaining ?? 0,
      limit: FOUNDING_MEMBER_LIMIT,
      monthlyUsd: FOUNDING_MEMBER_UNIT_AMOUNT / 100,
    },
    { headers: { "cache-control": "public, s-maxage=300" } },
  );
}

export const Route = createFileRoute("/api/founding-offer")({
  server: { handlers: { GET: handler } },
});
