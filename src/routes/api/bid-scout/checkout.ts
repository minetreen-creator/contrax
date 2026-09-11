import { createFileRoute } from "@tanstack/react-router";
import {
  bidScoutCheckoutSchema,
  normalizeBidScoutInput,
  createBidScoutCheckoutSession,
} from "~/lib/bid-scout";
import { resolveUserIdFromCookie } from "~/lib/stripe";
import {
  checkEmailLimit,
  checkIpLimit,
  rateLimitedResponse,
} from "~/lib/rate-limit";
import { isBlockedIp } from "~/lib/request-ip";

/**
 * POST /api/bid-scout/checkout
 *
 * Bid Scout purchase + intake (owner spec 2026-09-10, Phase A). Validates the
 * /bid-scout intake form, applies the same guards the other public POST
 * endpoints use (blocked-IP exact match, per-IP + per-email DB-backed rate
 * limits, zod validation with oversized-input rejection), reuses the logged-in
 * user id when present, then creates the PENDING bid_scout_subscriptions row
 * BEFORE the Stripe Checkout Session and returns `{ url }`.
 *
 * Attribution: `source` (e.g. ?source=dashboard) is stored on the row as the
 * Bid Scout CTA source; the visitor's first-touch acquisition attribution
 * cookie is never read, written, or overwritten here (it stays on the visitor
 * row via the existing tracking pipeline).
 *
 * When the logged-in user is unknown this still works — the row is simply
 * anonymous (user_id NULL) and the webhook transitions it to 'active'.
 */

// Guardrails — same family as /api/radar/lead + /api/lead-capture. Fail-open.
const IP_LIMIT = 10; // checkout starts per IP per hour
const IP_WINDOW = 60 * 60;
const EMAIL_LIMIT = 5; // checkout starts per email per hour
const EMAIL_WINDOW = 60 * 60;

async function handler({ request }: { request: Request }) {
  // Known hostile IPs never reach the handler body (exact-match, generic 403).
  if (isBlockedIp(request)) {
    return Response.json({ error: "Forbidden" }, { status: 403 });
  }

  try {
    const body = (await request.json().catch(() => null)) as unknown;
    const parsed = bidScoutCheckoutSchema.safeParse(body ?? {});
    if (!parsed.success) {
      const first = parsed.error.issues[0];
      const message = first
        ? `${first.path.join(".") || "field"}: ${first.message}`
        : "Invalid submission";
      return Response.json(
        { error: `Please check your details — ${message}` },
        { status: 400 },
      );
    }
    const d = parsed.data;
    const input = normalizeBidScoutInput(d);

    // Rate limits (per-IP + per-email) run before any write. Fail-open.
    const ipLimit = await checkIpLimit(request, "bid_scout_checkout_ip", IP_LIMIT, IP_WINDOW);
    if (!ipLimit.allowed) return rateLimitedResponse(ipLimit);
    const acctLimit = await checkEmailLimit(input.email, "bid_scout_checkout_email", EMAIL_LIMIT, EMAIL_WINDOW);
    if (!acctLimit.allowed) return rateLimitedResponse(acctLimit);

    // Reuse the logged-in user id (session cookie) when present.
    const userId = await resolveUserIdFromCookie(request.headers.get("cookie"));

    const result = await createBidScoutCheckoutSession(input, { userId });
    if (!result.success) {
      return Response.json(
        { error: result.error ?? "Checkout could not be started. Please try again." },
        { status: 500 },
      );
    }

    return Response.json({ url: result.url });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    console.error("[api/bid-scout/checkout] failed:", message);
    return Response.json({ error: "Internal server error" }, { status: 500 });
  }
}

export const Route = createFileRoute("/api/bid-scout/checkout")({
  server: { handlers: { POST: handler } },
});