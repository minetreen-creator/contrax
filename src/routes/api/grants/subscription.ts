import { createFileRoute } from "@tanstack/react-router";
import { getUserFromRequest } from "~/lib/api-auth";
import { getGrantsSubscription } from "~/lib/grants-subscription.server";

/**
 * GET /api/grants/subscription — the CURRENT visitor's Grants entitlement.
 *
 * Read-only and never authoritative for anything but UI affordances: the search
 * API re-reads the same helper server-side on every request. Returns
 * `{ authenticated, subscribed, status, currentPeriodEnd }`; an anonymous
 * visitor gets `subscribed: false` (200 — "no subscription" is not an error, the
 * page just shows the subscribe CTA).
 */
async function handler({ request }: { request: Request }): Promise<Response> {
  try {
    const user = await getUserFromRequest(request);
    if (!user) {
      return Response.json({
        authenticated: false,
        subscribed: false,
        status: null,
        currentPeriodEnd: null,
      });
    }
    const sub = await getGrantsSubscription(user.id);
    return Response.json({
      authenticated: true,
      subscribed: sub.subscribed,
      status: sub.status,
      currentPeriodEnd: sub.currentPeriodEnd,
    });
  } catch (err) {
    console.error("[grants-subscription] failed:", err);
    // Fail closed for UI state; the search API still enforces server-side.
    return Response.json({
      authenticated: false,
      subscribed: false,
      status: null,
      currentPeriodEnd: null,
    });
  }
}

export const Route = createFileRoute("/api/grants/subscription")({
  server: { handlers: { GET: handler } },
});
