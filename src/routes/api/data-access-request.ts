import { createFileRoute } from "@tanstack/react-router";
import { checkEmailLimit, checkIpLimit, rateLimitedResponse } from "~/lib/rate-limit";
import { insertDataRequest } from "~/lib/data-feed.server";
import { sendDataAccessRequestNotice } from "~/lib/email";

/**
 * POST /api/data-access-request — the /data page's "Request access" form
 * (owner 2026-10-06). Stores the request and emails the owner. Rate-limited
 * per IP and per email; fields are length-capped.
 */
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const clip = (v: unknown, max: number): string => (typeof v === "string" ? v.trim().slice(0, max) : "");

async function handler({ request }: { request: Request }) {
  try {
    const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
    // Honeypot: real people never fill this hidden field.
    if (clip(body.website, 200)) return Response.json({ ok: true });
    const name = clip(body.name, 120);
    const email = clip(body.email, 200).toLowerCase();
    const company = clip(body.company, 160);
    if (!name || !company) return Response.json({ error: "Please enter your name and company." }, { status: 400 });
    if (!EMAIL_PATTERN.test(email)) return Response.json({ error: "Please enter a valid email address." }, { status: 400 });
    const ip = await checkIpLimit(request, "data_request_ip", 10, 60 * 60);
    if (!ip.allowed) return rateLimitedResponse(ip);
    const acct = await checkEmailLimit(email, "data_request_email", 5, 60 * 60);
    if (!acct.allowed) return rateLimitedResponse(acct);
    const input = {
      name,
      email,
      company,
      useCase: clip(body.useCase, 120) || null,
      states: clip(body.states, 300) || null,
      message: clip(body.message, 2000) || null,
    };
    const id = await insertDataRequest(input);
    await sendDataAccessRequestNotice({ id, ...input });
    return Response.json({ ok: true });
  } catch (err) {
    console.error("[api/data-access-request] error:", err);
    return Response.json({ error: "Something went wrong. Please email contrax.companyllc@gmail.com." }, { status: 500 });
  }
}

export const Route = createFileRoute("/api/data-access-request")({ server: { handlers: { POST: handler } } });
