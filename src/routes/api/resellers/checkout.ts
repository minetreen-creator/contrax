import { createFileRoute } from "@tanstack/react-router";
import { checkIpLimit, checkEmailLimit, rateLimitedResponse } from "~/lib/rate-limit";
import { isBlockedIp } from "~/lib/request-ip";
import { cleanPartnerOrder } from "~/lib/reseller";
import { createPartnerCheckout } from "~/lib/reseller.server";

/** POST { email, firm, clients } → { url } for the reseller subscription (src/lib/reseller.ts). */
async function handler({ request }: { request: Request }) {
  if (isBlockedIp(request)) return Response.json({ error: "Forbidden" }, { status: 403 });
  const body = await request.text();
  if (body.length > 3000) return Response.json({ error: "Request too large" }, { status: 413 });
  let raw: unknown;
  try { raw = JSON.parse(body); }
  catch { return Response.json({ error: "Invalid request" }, { status: 400 }); }
  // Honeypot: a filled "website" field is a bot; answer as if it worked.
  if (raw && typeof raw === "object" && (raw as { website?: unknown }).website) return Response.json({ ok: true });
  const order = cleanPartnerOrder(raw);
  if (!order) return Response.json({ error: "Enter your work email, your firm's name and how many clients (1 to 200)." }, { status: 400 });
  const ip = await checkIpLimit(request, "reseller_checkout_ip", 8, 3600);
  if (!ip.allowed) return rateLimitedResponse(ip);
  const email = await checkEmailLimit(order.email, "reseller_checkout_email", 5, 3600);
  if (!email.allowed) return rateLimitedResponse(email);
  try {
    const { url } = await createPartnerCheckout(order);
    return Response.json({ url }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    console.error("[resellers/checkout] failed", error);
    return Response.json({ error: "Checkout is unavailable right now. Email contrax.companyllc@gmail.com and we will send a payment link." }, { status: 503 });
  }
}

export const Route = createFileRoute("/api/resellers/checkout")({ server: { handlers: { POST: handler } } });
