import { createFileRoute } from "@tanstack/react-router";
import { checkIpLimit, checkEmailLimit, rateLimitedResponse } from "~/lib/rate-limit";
import { isBlockedIp } from "~/lib/request-ip";
import { cleanManagedOrder } from "~/lib/contrax-managed";
import { createManagedCheckout } from "~/lib/contrax-managed.server";

/** POST { email, company, states, trade } → { url } for the Contrax Managed monthly subscription. */
async function handler({ request }: { request: Request }) {
  if (isBlockedIp(request)) return Response.json({ error: "Forbidden" }, { status: 403 });
  const body = await request.text();
  if (body.length > 3000) return Response.json({ error: "Request too large" }, { status: 413 });
  let raw: unknown;
  try { raw = JSON.parse(body); }
  catch { return Response.json({ error: "Invalid request" }, { status: 400 }); }
  // Honeypot: a filled "website" field is a bot; answer as if it worked.
  if (raw && typeof raw === "object" && (raw as { website?: unknown }).website) return Response.json({ ok: true });
  const order = cleanManagedOrder(raw);
  if (!order) return Response.json({ error: "Enter your work email, company, states and what you sell." }, { status: 400 });
  const ip = await checkIpLimit(request, "managed_checkout_ip", 8, 3600);
  if (!ip.allowed) return rateLimitedResponse(ip);
  const email = await checkEmailLimit(order.email, "managed_checkout_email", 5, 3600);
  if (!email.allowed) return rateLimitedResponse(email);
  try {
    const { url, credited } = await createManagedCheckout(order);
    return Response.json({ url, credited }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    console.error("[managed/checkout] failed", error);
    return Response.json({ error: "Checkout is unavailable right now. Email contrax.companyllc@gmail.com and we will send a payment link." }, { status: 503 });
  }
}

export const Route = createFileRoute("/api/managed/checkout")({ server: { handlers: { POST: handler } } });
