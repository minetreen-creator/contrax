import { createFileRoute } from "@tanstack/react-router";
import { getUserFromRequest } from "~/lib/api-auth";
import { createDataFeedCheckout, isDataFeedTier, validatePlanStates } from "~/lib/data-feed-billing.server";

/**
 * POST /api/data-feed/checkout { tier: "starter" | "pro" | "leads", states?: "VA,NC" }
 * → { url } for Stripe Checkout. Requires a signed-in Contrax account (the API
 * key is issued to that account). 401 tells the page to send the buyer to signup.
 */
async function handler({ request }: { request: Request }) {
  try {
    const user = await getUserFromRequest(request);
    if (!user) return Response.json({ error: "Sign in to subscribe", needsAccount: true }, { status: 401 });
    const body = (await request.json().catch(() => ({}))) as { tier?: unknown; states?: unknown };
    if (!isDataFeedTier(body.tier)) return Response.json({ error: "Choose a plan." }, { status: 400 });
    const states = validatePlanStates(body.tier, body.states);
    if (!states.ok) return Response.json({ error: states.error }, { status: 400 });
    const url = await createDataFeedCheckout(user.id, body.tier, states.states);
    return Response.json({ url });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Checkout failed";
    console.error("[api/data-feed/checkout] error:", err);
    return Response.json({ error: /already have/.test(message) ? message : "Checkout is unavailable right now. Please email contrax.companyllc@gmail.com." }, { status: 500 });
  }
}

export const Route = createFileRoute("/api/data-feed/checkout")({ server: { handlers: { POST: handler } } });
