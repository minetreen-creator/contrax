import { createFileRoute } from "@tanstack/react-router";
import { getUserFromRequest } from "~/lib/api-auth";
import { createDataFeedPortal } from "~/lib/data-feed-billing.server";

/** GET /api/data-feed/portal → redirect to the Stripe billing portal for the data feed plan. */
async function handler({ request }: { request: Request }) {
  const user = await getUserFromRequest(request);
  if (!user) return Response.redirect(new URL("/login?next=/api/data-feed/portal", request.url).toString(), 302);
  try {
    return Response.redirect(await createDataFeedPortal(user.id), 302);
  } catch (err) {
    console.error("[api/data-feed/portal] error:", err);
    return Response.redirect(new URL("/data?billing=unavailable", request.url).toString(), 302);
  }
}

export const Route = createFileRoute("/api/data-feed/portal")({ server: { handlers: { GET: handler } } });
