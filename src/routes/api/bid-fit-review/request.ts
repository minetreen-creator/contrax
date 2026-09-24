import { createFileRoute } from "@tanstack/react-router";
import { Resend } from "resend";
import { z } from "zod";
import { checkIpLimit, checkEmailLimit, rateLimitedResponse } from "~/lib/rate-limit";
import { isBlockedIp } from "~/lib/request-ip";
import { createBidFitReviewRequest, setBidFitNotificationStatus } from "~/lib/bid-fit-review.server";

const schema = z.object({
  name: z.string().trim().min(1).max(100),
  business: z.string().trim().min(1).max(150),
  email: z.email().max(254),
  solicitationUrl: z.url().max(2000).refine((s) => /^https?:\/\//i.test(s)),
  capabilities: z.string().trim().min(10).max(2000),
  deadline: z.string().trim().min(4).max(100),
  documentsAvailable: z.enum(["yes", "login", "unsure"]),
  website: z.string().max(200).optional(),
});

async function handler({ request }: { request: Request }) {
  if (isBlockedIp(request)) return Response.json({ error: "Forbidden" }, { status: 403 });
  const contentLength = Number(request.headers.get("content-length") ?? 0);
  if (contentLength > 6000) return Response.json({ error: "Request too large" }, { status: 413 });
  const body = await request.text();
  if (body.length > 6000) return Response.json({ error: "Request too large" }, { status: 413 });
  let parsed;
  try { parsed = schema.safeParse(JSON.parse(body)); }
  catch { return Response.json({ error: "Invalid request" }, { status: 400 }); }
  if (!parsed.success) return Response.json({ error: "Invalid request" }, { status: 400 });
  const data = parsed.data;
  if (data.website) return Response.json({ ok: true });
  const ip = await checkIpLimit(request, "bid_fit_review_request_ip", 5, 3600);
  if (!ip.allowed) return rateLimitedResponse(ip);
  const email = await checkEmailLimit(data.email, "bid_fit_review_request_email", 3, 3600);
  if (!email.allowed) return rateLimitedResponse(email);
  let id: number;
  let notificationStatus: "sent" | "failed" = "failed";
  try {
    id = await createBidFitReviewRequest(data);
  } catch (error) {
    console.error("[bid-fit-review/request] storage failed", error);
    return Response.json({ error: "Could not save request" }, { status: 503 });
  }
  // The stored admin queue is authoritative; notification failure is visible
  // there and does not prompt the customer to resubmit the same request.
  try {
    if (!process.env.RESEND_API_KEY) throw new Error("Email service unavailable");
    const result = await new Resend(process.env.RESEND_API_KEY).emails.send({
      from: "Contrax <hello@contrax.company>",
      to: ["minetreen@gmail.com"],
      replyTo: data.email,
      subject: "Bid Fit Review request",
      text: ["New $99 review request (unpaid; qualify before sending payment link)", `Name: ${data.name}`, `Business: ${data.business}`, `Email: ${data.email}`, `Solicitation: ${data.solicitationUrl}`, `Capabilities: ${data.capabilities}`, `Deadline: ${data.deadline}`, `Document access: ${data.documentsAvailable}`].join("\n\n"),
    });
    if (result.error) throw result.error;
    notificationStatus = "sent";
  } catch (error) {
    console.error("[bid-fit-review/request] email failed", error);
  }
  try { await setBidFitNotificationStatus(id, notificationStatus); }
  catch (updateError) { console.error("[bid-fit-review/request] notification status update failed", updateError); }
  return Response.json({ ok: true });
}

export const Route = createFileRoute("/api/bid-fit-review/request")({ server: { handlers: { POST: handler } } });
