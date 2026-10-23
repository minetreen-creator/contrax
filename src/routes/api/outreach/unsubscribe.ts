import { createFileRoute } from "@tanstack/react-router";
import { suppress, verifyUnsubscribeToken } from "~/lib/outreach.server";

/**
 * GET/POST /api/outreach/unsubscribe?t=… — the one-click unsubscribe printed
 * in every outreach email (and its List-Unsubscribe header; POST is the
 * RFC 8058 one-click form mail providers use). Suppresses the address for
 * good. Idempotent.
 */
const page = (title: string, body: string) =>
  new Response(
    `<!DOCTYPE html><html lang="en"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1.0"><title>${title} — Contrax</title></head><body style="margin:0;background:#f8fafc;font-family:Arial,Helvetica,sans-serif"><div style="max-width:520px;margin:0 auto;padding:56px 20px;text-align:center"><p style="margin:0 0 8px;font-size:13px;font-weight:700;letter-spacing:.12em;color:#2563eb;text-transform:uppercase">Contrax</p><h1 style="margin:0 0 12px;font-size:24px;color:#0f172a">${title}</h1><p style="margin:0;font-size:15px;line-height:1.6;color:#475569">${body}</p></div></body></html>`,
    { headers: { "content-type": "text/html; charset=utf-8" } },
  );

async function handler({ request }: { request: Request }) {
  const token = new URL(request.url).searchParams.get("t") ?? "";
  const email = token.length <= 400 ? verifyUnsubscribeToken(token) : null;
  if (!email) return page("Link not valid", "This unsubscribe link is invalid. Reply to the email with \"stop\" and we'll remove you by hand.");
  try {
    await suppress(email, "unsubscribed");
  } catch (e) {
    console.error("[outreach/unsubscribe]", e);
    return page("Something went wrong", "Please reply to the email with \"stop\" and we'll remove you by hand.");
  }
  return page("You're unsubscribed ✓", "You won't receive any more emails from Contrax about open bids.");
}

export const Route = createFileRoute("/api/outreach/unsubscribe")({ server: { handlers: { GET: handler, POST: handler } } });
