import { createFileRoute } from "@tanstack/react-router";
import { checkIpLimit, rateLimitedResponse } from "~/lib/rate-limit";
import { isBlockedIp } from "~/lib/request-ip";
import { cleanIntake } from "~/lib/bid-prep";
import { sendBidPrepIntake } from "~/lib/bid-prep.server";

/** POST { session, ...answers } → { ok } : the company details for a paid Bid Prep order, emailed to the owner. */
async function handler({ request }: { request: Request }) {
  if (isBlockedIp(request)) return Response.json({ error: "Forbidden" }, { status: 403 });
  const body = await request.text();
  if (body.length > 12000) return Response.json({ error: "Request too large" }, { status: 413 });
  let raw: unknown;
  try { raw = JSON.parse(body); }
  catch { return Response.json({ error: "Invalid request" }, { status: 400 }); }
  const session = raw && typeof raw === "object" ? String((raw as { session?: unknown }).session ?? "") : "";
  if (!/^cs_[A-Za-z0-9_]{10,200}$/.test(session)) return Response.json({ error: "We could not find your order. Reply to your confirmation email with your answers instead." }, { status: 400 });
  const answers = cleanIntake(raw);
  if (!answers) return Response.json({ error: "Please fill in every field that is not marked optional." }, { status: 400 });
  const ip = await checkIpLimit(request, "bid_prep_intake_ip", 6, 3600);
  if (!ip.allowed) return rateLimitedResponse(ip);
  try {
    const result = await sendBidPrepIntake(session, answers);
    if (result === "not_paid") return Response.json({ error: "We could not find a paid order for this page. Reply to your confirmation email with your answers instead." }, { status: 404 });
    return Response.json({ ok: true }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    console.error("[bid-prep/intake] failed", error);
    return Response.json({ error: "We could not save your answers. Please reply to your confirmation email with them instead." }, { status: 503 });
  }
}

export const Route = createFileRoute("/api/bid-prep/intake")({ server: { handlers: { POST: handler } } });
