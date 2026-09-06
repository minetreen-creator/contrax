import { createFileRoute } from "@tanstack/react-router";
import { sql } from "~/db";

/**
 * GET /api/radar/lead-unsubscribe?token=… — the honest one-click unsubscribe
 * the consent microcopy promises ("unsubscribe anytime"). Marks
 * `unsubscribed_at` once and returns a simple HTML page. The capture endpoint
 * never resurrects an unsubscribed address (repeat submissions after this get
 * status "unsubscribed" and no email). Idempotent: a second click reports
 * "already unsubscribed".
 */

const PAGE = (title: string, body: string) =>
  `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>${title} — Contrax</title>
</head>
<body style="margin:0;padding:0;background-color:#020617;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;">
  <div style="max-width:520px;margin:0 auto;padding:48px 20px;text-align:center;">
    <p style="margin:0 0 8px;font-size:13px;font-weight:700;letter-spacing:0.12em;color:#fbbf24;text-transform:uppercase;">Contrax</p>
    <h1 style="margin:0 0 12px;font-size:24px;font-weight:800;color:#ffffff;">${title}</h1>
    <p style="margin:0;font-size:15px;line-height:1.6;color:#cbd5e1;">${body}</p>
    <a href="https://www.contrax.company/radar" style="display:inline-block;margin-top:28px;background:#fbbf24;color:#020617;text-decoration:none;padding:12px 28px;border-radius:10px;font-size:15px;font-weight:700;">Back to Contract Radar</a>
  </div>
</body>
</html>`;

async function handler({ request }: { request: Request }) {
  try {
    const url = new URL(request.url);
    const token = (url.searchParams.get("token") ?? "").trim();
    if (!token || token.length > 200) {
      return new Response(PAGE("Invalid link", "This unsubscribe link is invalid or expired."), {
        headers: { "content-type": "text/html; charset=utf-8" },
      });
    }
    const rows = (await sql()`
      SELECT email, unsubscribed_at FROM radar_leads WHERE unsubscribe_token = ${token}
    `) as Array<{ email: string; unsubscribed_at: string | null }>;
    const lead = rows[0];
    if (!lead) {
      return new Response(
        PAGE("Link not found", "This unsubscribe link doesn't match a Contrax match-alert subscription."),
        { headers: { "content-type": "text/html; charset=utf-8" } },
      );
    }
    if (lead.unsubscribed_at) {
      return new Response(
        PAGE("You're unsubscribed ✓", "This address was already unsubscribed from Contrax match alerts — you won't hear from us."),
        { headers: { "content-type": "text/html; charset=utf-8" } },
      );
    }
    await sql()`
      UPDATE radar_leads SET unsubscribed_at = NOW(), updated_at = NOW() WHERE unsubscribe_token = ${token}
    `;
    return new Response(
      PAGE("You're unsubscribed ✓", "You won't receive any more Contrax match-alert emails to this address. Signing up again on the Contract Radar page is always possible if you change your mind."),
      { headers: { "content-type": "text/html; charset=utf-8" } },
    );
  } catch (err) {
    console.error("[api/radar/lead-unsubscribe] error:", err);
    return new Response(PAGE("Something went wrong", "Please try the link again in a moment."), {
      headers: { "content-type": "text/html; charset=utf-8" },
      status: 500,
    });
  }
}

export const Route = createFileRoute("/api/radar/lead-unsubscribe")({
  server: { handlers: { GET: handler } },
});