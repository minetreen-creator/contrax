import { createFileRoute } from "@tanstack/react-router";
import { sql } from "~/db";

/**
 * GET|POST /api/email/weekly-unsubscribe?token=… — one-click unsubscribe from
 * the free weekly bid email (src/jobs/send-weekly-digest.ts). GET is the link
 * in the email; POST is the RFC 8058 List-Unsubscribe-Post one-click that mail
 * apps send. Sets `weekly_digest_unsubscribed_at` once; idempotent.
 */

const PAGE = (title: string, body: string) =>
  `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>${title} — Contrax</title>
</head>
<body style="margin:0;padding:0;background-color:#f4f4f5;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;">
  <div style="max-width:520px;margin:0 auto;padding:48px 20px;text-align:center;">
    <p style="margin:0 0 8px;font-size:13px;font-weight:700;letter-spacing:0.12em;color:#2563eb;text-transform:uppercase;">Contrax</p>
    <h1 style="margin:0 0 12px;font-size:24px;font-weight:800;color:#0f172a;">${title}</h1>
    <p style="margin:0;font-size:15px;line-height:1.6;color:#475569;">${body}</p>
    <a href="https://www.contrax.company/dashboard" style="display:inline-block;margin-top:28px;background:#2563eb;color:#ffffff;text-decoration:none;padding:12px 28px;border-radius:10px;font-size:15px;font-weight:700;">Go to Contrax</a>
  </div>
</body>
</html>`;

const html = (title: string, body: string, status = 200) =>
  new Response(PAGE(title, body), { status, headers: { "content-type": "text/html; charset=utf-8" } });

async function handler({ request }: { request: Request }) {
  try {
    const token = (new URL(request.url).searchParams.get("token") ?? "").trim();
    if (!token || token.length > 200) return html("Invalid link", "This unsubscribe link is invalid.");
    const rows = (await sql()`
      UPDATE email_preferences
      SET weekly_digest_unsubscribed_at = COALESCE(weekly_digest_unsubscribed_at, NOW())
      WHERE unsubscribe_token = ${token}
      RETURNING email_lower
    `) as { email_lower: string }[];
    if (!rows[0]) return html("Link not found", "This unsubscribe link doesn't match a Contrax weekly email.");
    return html(
      "You're unsubscribed ✓",
      "You won't get the weekly bid email any more. Your account and saved bids are unchanged.",
    );
  } catch (err) {
    console.error("[api/email/weekly-unsubscribe] error:", err);
    return html("Something went wrong", "Please try the link again in a moment.", 500);
  }
}

export const Route = createFileRoute("/api/email/weekly-unsubscribe")({
  server: { handlers: { GET: handler, POST: handler } },
});
