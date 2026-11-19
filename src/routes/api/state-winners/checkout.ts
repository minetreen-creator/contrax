import { createFileRoute } from "@tanstack/react-router";
import { checkIpLimit, rateLimitedResponse } from "~/lib/rate-limit";
import { isBlockedIp } from "~/lib/request-ip";
import { cleanWinnersState } from "~/lib/state-winners";
import { createWinnersCheckout } from "~/lib/state-winners.server";

/** POST { state } → { url } for the $29 one-time state winners list. */
async function handler({ request }: { request: Request }) {
  if (isBlockedIp(request)) return Response.json({ error: "Forbidden" }, { status: 403 });
  const body = await request.text();
  if (body.length > 500) return Response.json({ error: "Request too large" }, { status: 413 });
  let raw: unknown;
  try { raw = JSON.parse(body); }
  catch { return Response.json({ error: "Invalid request" }, { status: 400 }); }
  const state = cleanWinnersState((raw as { state?: unknown } | null)?.state);
  if (!state) return Response.json({ error: "Choose your state." }, { status: 400 });
  const ip = await checkIpLimit(request, "state_winners_checkout_ip", 10, 3600);
  if (!ip.allowed) return rateLimitedResponse(ip);
  try {
    return Response.json({ url: await createWinnersCheckout(state) }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    console.error("[state-winners/checkout] failed", error);
    return Response.json({ error: "Checkout is unavailable right now. Email contrax.companyllc@gmail.com and we will send a payment link." }, { status: 503 });
  }
}

export const Route = createFileRoute("/api/state-winners/checkout")({ server: { handlers: { POST: handler } } });
