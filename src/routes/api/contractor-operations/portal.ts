import { createFileRoute } from "@tanstack/react-router";
import { getUserFromRequest } from "~/lib/api-auth";
import { createOperationsPortal, getOperationsSubscription } from "~/lib/contractor-operations-billing.server";

async function post({ request }: { request: Request }) {
  const user = await getUserFromRequest(request);
  if (!user) return Response.json({ error: "Sign in to manage billing" }, { status: 401 });
  const state = await getOperationsSubscription(user.id);
  if (!state.customerId) return Response.json({ error: "No Contrax Payments subscription" }, { status: 403 });
  try { return Response.json({ url: await createOperationsPortal(user.id) }); }
  catch (error) {
    console.error("[contractor-operations] portal failed", error);
    return Response.json({ error: "Billing portal unavailable" }, { status: 503 });
  }
}
export const Route = createFileRoute("/api/contractor-operations/portal")({ server: { handlers: { POST: post } } });
