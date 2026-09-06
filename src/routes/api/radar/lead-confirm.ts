import { createFileRoute } from "@tanstack/react-router";
import { sql } from "~/db";

/**
 * GET /api/radar/lead-confirm?token=… — the ONE confirmation link sent by the
 * confirmation email (owner 2026-09-06). Sets `confirmed_at` exactly once and
 * returns a simple honest HTML page. Idempotent: a second click reports
 * "already confirmed". An unsubscribed address can never be re-confirmed.
 * The same token also powers the one-click unsubscribe link.
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
    <p style="margin-top:24px;font-size:12px;color:#64748b;">No account required · unsubscribe anytime with one click</p>
  </div>
</body>
</html>`;

async function handler({ request }: { request: Request }) {
  try {
    const url = new URL(request.url);
    const token = (url.searchParams.get("token") ?? "").trim();
    if (!token || token.length > 200) {
      return new Response(PAGE("Invalid link", "This confirmation link is invalid or expired."), {
        headers: { "content-type": "text/html; charset=utf-8" },
      });
    }
    const rows = (await sql()`
      SELECT email, confirmed_at, unsubscribed_at FROM radar_leads WHERE unsubscribe_token = ${token}
    `) as Array<{ email: string; confirmed_at: string | null; unsubscribed_at: string | null }>;
    const lead = rows[0];
    if (!lead) {
      return new Response(
        PAGE("Link not found", "This confirmation link doesn't match a Contrax match-alert subscription. It may already have been used."),
        { headers: { "content-type": "text/html; charset=utf-8" } },
      );
    }
    if (lead.unsubscribed_at) {
      return new Response(
        PAGE("Already unsubscribed", "This address was unsubscribed from Contrax match alerts, so it can't be confirmed again."),
        { headers: { "content-type": "text/html; charset=utf-8" } },
      );
    }
    if (lead.confirmed_at) {
      return new Response(
        PAGE("You're already confirmed ✓", "Your Contrax match alerts are active. We'll email you when we find new matching opportunities."),
        { headers: { "content-type": "text/html; charset=utf-8" } },
      );
    }
    await sql()`
      UPDATE radar_leads SET confirmed_at = NOW(), updated_at = NOW() WHERE unsubscribe_token = ${token}
    `;
    return new Response(
      PAGE("You're confirmed ✓", "You're on the list. We'll email you when new government contract matches for your business open up."),
      { headers: { "content-type": "text/html; charset=utf-8" } },
    );
  } catch (err) {
    console.error("[api/radar/lead-confirm] error:", err);
    return new Response(PAGE("Something went wrong", "Please try the link again in a moment."), {
      headers: { "content-type": "text/html; charset=utf-8" },
      status: 500,
    });
  }
}

export const Route = createFileRoute("/api/radar/lead-confirm")({
  server: { handlers: { GET: handler } },
});