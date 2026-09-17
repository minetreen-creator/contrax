import { createFileRoute } from "@tanstack/react-router";
import { getUserFromRequest } from "~/lib/api-auth";
import {
  createGrantsPortalSession,
  getGrantsSubscription,
} from "~/lib/grants-subscription.server";

/**
 * POST /api/stripe/grants-portal-session
 *
 * Opens the Stripe Customer Portal for a Grants SUBSCRIBER (the "Manage
 * subscription" button on /grants) and returns `{ url }`. Sign-in required, and
 * the caller must have a stored Grants subscription with a Stripe customer —
 * everything else is 403, so this endpoint can never be used to poke at another
 * account's billing.
 *
 * Responses: 200 { url } · 401 not signed in · 403 no Grants subscription ·
 * 500 Stripe failure.
 */
async function handler({ request }: { request: Request }): Promise<Response> {
  try {
    const user = await getUserFromRequest(request);
    if (!user) {
      return Response.json({ error: "Sign in to manage your subscription." }, { status: 401 });
    }
    const subscription = await getGrantsSubscription(user.id);
    if (!subscription.stripeCustomerId) {
      return Response.json(
        { error: "No Contrax Grants subscription found for your account." },
        { status: 403 },
      );
    }
    const result = await createGrantsPortalSession(user.id);
    if (!result.success || !result.url) {
      return Response.json(
        { error: result.error ?? "Could not open the billing portal" },
        { status: 500 },
      );
    }
    return Response.json({ url: result.url });
  } catch (err) {
    console.error("[grants-portal-session] failed:", err);
    return Response.json({ error: "Internal server error" }, { status: 500 });
  }
}

export const Route = createFileRoute("/api/stripe/grants-portal-session")({
  server: { handlers: { POST: handler } },
});
