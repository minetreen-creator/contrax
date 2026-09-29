import { createFileRoute } from "@tanstack/react-router";
import { getUserFromRequest } from "~/lib/api-auth";
import { getOperationsSubscription, priceFor } from "~/lib/contractor-operations-billing.server";

async function get({ request }: { request: Request }) {
  const user = await getUserFromRequest(request);
  if (!user) return Response.json({ authenticated: false, subscribed: false, checkoutEnabled: !!priceFor("month") && !!priceFor("year") });
  const state = await getOperationsSubscription(user.id);
  return Response.json({ authenticated: true, subscribed: state.subscribed, status: state.status,
    interval: state.interval, checkoutEnabled: !!priceFor("month") && !!priceFor("year") });
}

export const Route = createFileRoute("/api/contractor-operations/subscription")({ server: { handlers: { GET: get } } });
