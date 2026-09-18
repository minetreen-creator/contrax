import { createFileRoute } from "@tanstack/react-router";
import { getUserFromRequest } from "~/lib/api-auth";
import {
  createTierPortalSession,
  getTierBilling,
} from "~/lib/tier-subscription.server";

/**
 * POST /api/stripe/portal-session
 *
 * Opens the Stripe Customer Portal for a Contrax PLAN TIER customer
 * (Starter/Professional/Agency) and returns `{ url }` — the "Manage
 * subscription" button in Settings → Plan & Trial. Sign-in required, and the
 * caller must have a stored Stripe customer, so this endpoint can never be used
 * to poke at another account's billing.
 *
 * Takes NO input: the customer and the return URL are server-side.
 *
 * Responses: 200 { url } · 401 not signed in · 403 no billing profile ·
 * 503 the Stripe account has no billing-portal CONFIGURATION yet (the portal is
 * configured on the Stripe account, not in code — this failure is reported
 * explicitly rather than as a generic error) · 500 any other Stripe failure.
 *
 * Mirrors src/routes/api/stripe/grants-portal-session.ts and is kept in lockstep
 * with the interceptor in serve.ts / vercel-entry.ts.
 */
async function handler({ request }: { request: Request }): Promise<Response> {
  try {
    const user = await getUserFromRequest(request);
    if (!user) {
      return Response.json(
        { error: "Sign in to manage your subscription." },
        { status: 401 },
      );
    }
    const billing = await getTierBilling(user.id);
    if (!billing.stripeCustomerId) {
      return Response.json(
        { error: "No paid Contrax subscription found for your account." },
        { status: 403 },
      );
    }
    const result = await createTierPortalSession(user.id);
    if (!result.success || !result.url) {
      return Response.json(
        { error: result.error ?? "Could not open the billing portal" },
        { status: result.code === "portal_not_configured" ? 503 : 500 },
      );
    }
    return Response.json({ url: result.url });
  } catch (err) {
    console.error("[portal-session] failed:", err);
    return Response.json({ error: "Internal server error" }, { status: 500 });
  }
}

export const Route = createFileRoute("/api/stripe/portal-session")({
  server: { handlers: { POST: handler } },
});
