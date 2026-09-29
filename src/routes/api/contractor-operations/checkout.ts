import { createFileRoute } from "@tanstack/react-router";
import { getUserFromRequest } from "~/lib/api-auth";
import { createOperationsCheckout } from "~/lib/contractor-operations-billing.server";

async function post({ request }: { request: Request }) {
  const user = await getUserFromRequest(request);
  if (!user) return Response.json({ error: "Sign in to subscribe" }, { status: 401 });
  const body = await request.json().catch(() => null);
  if (!body || Object.keys(body).length !== 1 || !["month", "year"].includes(body.interval)) {
    return Response.json({ error: "Choose monthly or annual billing" }, { status: 400 });
  }
  try {
    return Response.json({ url: await createOperationsCheckout(user.id, body.interval) });
  } catch (error) {
    console.error("[contractor-operations] checkout failed", error);
    return Response.json({ error: "Checkout unavailable. Please try again." }, { status: 503 });
  }
}
export const Route = createFileRoute("/api/contractor-operations/checkout")({ server: { handlers: { POST: post } } });
