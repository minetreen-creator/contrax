import { createFileRoute } from "@tanstack/react-router";
import {
  createCheckoutSession,
  resolveUserIdFromCookie,
  type PlanTier,
} from "~/lib/stripe";

/**
 * POST /api/stripe/create-checkout-session
 *
 * Body: { "planTier": "starter"|"professional"|"agency"|"savings_premium",
 *         "mode": "payment"|"subscription" }   (mode optional, defaults to
 *         "subscription" since all Contrax plans are billed monthly)
 *
 * Creates a Stripe Checkout Session for the requested plan tier and returns
 * `{ url }` — the client redirects the browser to that URL. The logged-in
 * user's id (from the `contrax_session` cookie) is stored in the session's
 * metadata so the webhook can attribute the payment to the right account.
 *
 * NOTE: in production this endpoint is served by the lightweight interceptor
 * in vercel-entry.ts (which must handle the raw request before SSR). This
 * route file is the canonical TanStack implementation — used by `vite dev`
 * and kept in lockstep with the interceptor, both delegating to the same
 * functions in src/lib/stripe.ts.
 */

const VALID_TIERS: PlanTier[] = [
  "starter",
  "professional",
  "agency",
  "savings_premium",
];

async function handler({ request }: { request: Request }) {
  try {
    const body = (await request.json().catch(() => ({}))) as {
      planTier?: string;
      mode?: "payment" | "subscription";
      promoCode?: string;
    };

    if (!body.planTier || !(VALID_TIERS as string[]).includes(body.planTier)) {
      return Response.json(
        {
          error: `Invalid planTier. Must be one of: ${VALID_TIERS.join(", ")}`,
        },
        { status: 400 },
      );
    }
    if (body.mode && !["payment", "subscription"].includes(body.mode)) {
      return Response.json(
        { error: `Invalid mode. Must be "payment" or "subscription"` },
        { status: 400 },
      );
    }

    const userId = await resolveUserIdFromCookie(request.headers.get("cookie"));
    // Optional server-side verification code ("VAD26"). Normalized to lowercase,
    // then passed through as "VAD26" when it matches — the checkout then uses
    // the dedicated exact VAD Stripe price for the tier.
    const normalized = (body.promoCode ?? "").trim().toLowerCase();
    const promoCode = normalized === "vad26" ? "VAD26" : undefined;
    const result = await createCheckoutSession(body.planTier as PlanTier, {
      userId,
      mode: body.mode ?? "subscription",
      ...(promoCode ? { promoCode } : {}),
    });

    if (!result.success) {
      return Response.json({ error: result.error }, { status: 500 });
    }

    return Response.json({ url: result.url });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    console.error("[create-checkout-session] failed:", err);
    return Response.json({ error: message }, { status: 500 });
  }
}

export const Route = createFileRoute("/api/stripe/create-checkout-session")({
  server: { handlers: { POST: handler } },
});
