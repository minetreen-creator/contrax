import { createFileRoute } from "@tanstack/react-router";
import { checkIpLimit, rateLimitedResponse } from "~/lib/rate-limit";
import { isBlockedIp } from "~/lib/request-ip";
import { createBidPackCheckout } from "~/lib/bid-pack.server";

/** POST → { url } for the $19 one-time Public Bid Paperwork Pack. */
async function handler({ request }: { request: Request }) {
  if (isBlockedIp(request)) return Response.json({ error: "Forbidden" }, { status: 403 });
  const ip = await checkIpLimit(request, "bid_pack_checkout_ip", 10, 3600);
  if (!ip.allowed) return rateLimitedResponse(ip);
  // The daily site check labels its request so its session is marked and short-lived.
  const raw = (await request.text().catch(() => "")).slice(0, 200);
  let probe = false;
  try { probe = (JSON.parse(raw || "{}") as { probe?: unknown }).probe === "path-check"; } catch { /* a buyer's click sends no body */ }
  try {
    return Response.json({ url: await createBidPackCheckout({ probe }) }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    console.error("[bid-pack/checkout] failed", error);
    return Response.json({ error: "Checkout is unavailable right now. Email contrax.companyllc@gmail.com and we will send a payment link." }, { status: 503 });
  }
}

export const Route = createFileRoute("/api/bid-pack/checkout")({ server: { handlers: { POST: handler } } });
