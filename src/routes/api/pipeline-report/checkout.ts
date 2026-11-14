import { createFileRoute } from "@tanstack/react-router";
import { checkIpLimit, checkEmailLimit, rateLimitedResponse } from "~/lib/rate-limit";
import { isBlockedIp } from "~/lib/request-ip";
import { cleanOrder, orderAlert } from "~/lib/pipeline-report";
import { createReportCheckout } from "~/lib/pipeline-report.server";

/** POST { email, company, state, trade } → { url } for the $149 one-time pipeline report. */
async function handler({ request }: { request: Request }) {
  if (isBlockedIp(request)) return Response.json({ error: "Forbidden" }, { status: 403 });
  const body = await request.text();
  if (body.length > 3000) return Response.json({ error: "Request too large" }, { status: 413 });
  let raw: unknown;
  try { raw = JSON.parse(body); }
  catch { return Response.json({ error: "Invalid request" }, { status: 400 }); }
  // Honeypot: a filled "website" field is a bot; answer as if it worked.
  if (raw && typeof raw === "object" && (raw as { website?: unknown }).website) return Response.json({ ok: true });
  const order = cleanOrder(raw);
  if (!order) return Response.json({ error: "Enter your work email, company, state and what you sell." }, { status: 400 });
  const ip = await checkIpLimit(request, "pipeline_report_checkout_ip", 8, 3600);
  if (!ip.allowed) return rateLimitedResponse(ip);
  const email = await checkEmailLimit(order.email, "pipeline_report_checkout_email", 5, 3600);
  if (!email.allowed) return rateLimitedResponse(email);
  try {
    const from = raw && typeof raw === "object" && (raw as { from?: unknown }).from === "sample" ? "sample" : "teams";
    const { url, sessionId } = await createReportCheckout(order, undefined, from);
    // Mission Control hears about a started order too: an unpaid one is a lead with a name and an email.
    const { alertReportOrder } = await import("~/lib/live-push.server");
    await alertReportOrder(orderAlert(order, sessionId, false));
    return Response.json({ url }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    console.error("[pipeline-report/checkout] failed", error);
    return Response.json({ error: "Checkout is unavailable right now. Email contrax.companyllc@gmail.com and we will send a payment link." }, { status: 503 });
  }
}

export const Route = createFileRoute("/api/pipeline-report/checkout")({ server: { handlers: { POST: handler } } });
