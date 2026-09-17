import { createFileRoute } from "@tanstack/react-router";
import { getUserFromRequest } from "~/lib/api-auth";
import {
  createGrantsCheckoutSession,
  validateGrantsCheckoutBody,
} from "~/lib/grants-subscription.server";

/**
 * POST /api/stripe/grants-checkout-session
 *
 * Starts the Contrax Grants $19/month subscription checkout. SIGN-IN REQUIRED —
 * the Stripe customer is created/looked up for the authenticated Contrax user
 * and `metadata.user_id` is set on both the session and the subscription so the
 * verified webhook can attribute the event to the right account.
 *
 * Takes NO input: price (process.env.STRIPE_GRANTS_PRICE_ID), quantity (1), mode
 * ("subscription"), customer and redirect URLs are all server-side, so a caller
 * can never influence price or quantity. Any supplied field is a 400.
 *
 * Responses: 200 { url } · 400 invalid input · 401 not signed in · 500 Stripe
 * failure. Mirrors src/routes/api/stripe/create-checkout-session.ts and is kept
 * in lockstep with the interceptors in serve.ts / vercel-entry.ts.
 */
async function handler({ request }: { request: Request }): Promise<Response> {
  try {
    const user = await getUserFromRequest(request);
    if (!user) {
      return Response.json(
        { error: "Sign in to subscribe to Contrax Grants." },
        { status: 401 },
      );
    }

    const raw = await request.text();
    let body: unknown = {};
    if (raw.trim() !== "") {
      try {
        body = JSON.parse(raw);
      } catch {
        return Response.json({ error: "Invalid JSON body" }, { status: 400 });
      }
    }
    const valid = validateGrantsCheckoutBody(body);
    if (!valid.ok) {
      return Response.json({ error: valid.error }, { status: 400 });
    }

    const result = await createGrantsCheckoutSession(user.id);
    if (!result.success || !result.url) {
      return Response.json(
        { error: result.error ?? "Could not start checkout" },
        { status: 500 },
      );
    }
    return Response.json({ url: result.url });
  } catch (err) {
    console.error("[grants-checkout-session] failed:", err);
    return Response.json({ error: "Internal server error" }, { status: 500 });
  }
}

export const Route = createFileRoute("/api/stripe/grants-checkout-session")({
  server: { handlers: { POST: handler } },
});
