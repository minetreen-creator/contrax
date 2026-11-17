import { createFileRoute } from "@tanstack/react-router";
import { sql } from "~/db";
import { checkIpLimit, checkEmailLimit, rateLimitedResponse } from "~/lib/rate-limit";
import { isBlockedIp } from "~/lib/request-ip";
import { BID_PREP_MIN_DAYS, bidPrepOffered, bidPrepSource, cleanPrepRequest, prepAlert, type BidPrepOrder } from "~/lib/bid-prep";
import { createBidPrepCheckout } from "~/lib/bid-prep.server";

/** POST { email, company, bidId } → { url } for the $199 one-time bid package. The bid's own details are read here, never taken from the browser. */
async function handler({ request }: { request: Request }) {
  if (isBlockedIp(request)) return Response.json({ error: "Forbidden" }, { status: 403 });
  const body = await request.text();
  if (body.length > 3000) return Response.json({ error: "Request too large" }, { status: 413 });
  let raw: unknown;
  try { raw = JSON.parse(body); }
  catch { return Response.json({ error: "Invalid request" }, { status: 400 }); }
  // Honeypot: a filled "website" field is a bot; answer as if it worked.
  if (raw && typeof raw === "object" && (raw as { website?: unknown }).website) return Response.json({ ok: true });
  const req = cleanPrepRequest(raw);
  if (!req) return Response.json({ error: "Enter your work email and company name." }, { status: 400 });
  const ip = await checkIpLimit(request, "bid_prep_checkout_ip", 8, 3600);
  if (!ip.allowed) return rateLimitedResponse(ip);
  const email = await checkEmailLimit(req.email, "bid_prep_checkout_email", 5, 3600);
  if (!email.allowed) return rateLimitedResponse(email);
  try {
    const rows = (await sql()`SELECT id, title, agency, due_date, source FROM bids WHERE id = ${req.bidId} LIMIT 1`) as { id: number; title: string | null; agency: string | null; due_date: string | Date | null; source: string | null }[];
    const bid = rows[0];
    if (!bid) return Response.json({ error: "That bid is no longer listed." }, { status: 404 });
    if (!bidPrepSource(bid.source)) return Response.json({ error: "Bid Prep is for state, county, city and school bids. We do not offer it on federal solicitations." }, { status: 409 });
    if (!bidPrepOffered(bid.due_date)) {
      return Response.json({ error: `This bid is due in under ${BID_PREP_MIN_DAYS} days, which is too close for us to prepare it properly.` }, { status: 409 });
    }
    const order: BidPrepOrder = {
      ...req,
      bidTitle: String(bid.title ?? `Bid ${bid.id}`).replace(/\s+/g, " ").trim().slice(0, 300),
      agency: String(bid.agency ?? "").replace(/\s+/g, " ").trim().slice(0, 200),
      due: new Date(bid.due_date as string).toISOString(),
    };
    const { url, sessionId } = await createBidPrepCheckout(order);
    // Mission Control hears about a started order too: an unpaid one is a lead with a name and an email.
    const { alertReportOrder } = await import("~/lib/live-push.server");
    await alertReportOrder(prepAlert(order, sessionId, false));
    return Response.json({ url }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    console.error("[bid-prep/checkout] failed", error);
    return Response.json({ error: "Checkout is unavailable right now. Email contrax.companyllc@gmail.com and we will send a payment link." }, { status: 503 });
  }
}

export const Route = createFileRoute("/api/bid-prep/checkout")({ server: { handlers: { POST: handler } } });
