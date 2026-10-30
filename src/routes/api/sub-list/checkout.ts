import { createFileRoute } from "@tanstack/react-router";
import { isBlockedIp } from "~/lib/request-ip";
import { cleanField } from "~/lib/sub-list";

/** POST { trade, city } → { url } for the $49 local-subcontractor list (owner 2026-10-30). */
async function handler({ request }: { request: Request }) {
  if (isBlockedIp(request)) return Response.json({ error: "Forbidden" }, { status: 403 });
  let body: Record<string, unknown>;
  try {
    body = (await request.json()) as Record<string, unknown>;
  } catch {
    return Response.json({ error: "Invalid request" }, { status: 400 });
  }
  const trade = cleanField(body.trade);
  const city = cleanField(body.city);
  if (!trade || !city) return Response.json({ error: "Enter the trade and the city." }, { status: 400 });
  try {
    const { createSubListCheckout } = await import("~/lib/sub-list.server");
    return Response.json({ url: await createSubListCheckout(trade, city) }, { headers: { "Cache-Control": "no-store" } });
  } catch (e) {
    console.error("[sub-list/checkout]", (e as Error).message);
    return Response.json({ error: "Checkout is unavailable right now." }, { status: 500 });
  }
}

export const Route = createFileRoute("/api/sub-list/checkout")({ server: { handlers: { POST: handler } } });
