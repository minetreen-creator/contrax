import { createFileRoute } from "@tanstack/react-router";
import { sql } from "~/db";
/**
 * GET /api/radar-unsubscribe?email=...
 *
 * One-click honest unsubscribe for the Contract Radar "Save your matches"
 * alert emails. The radar_saves email is public/lowercase (a lead-capture
 * list, no account), so a plain link with the email is enough — no auth, no
 * token, no friction: the promise we made was "Unsubscribe anytime."
 *
 * Flips radar_saves.unsubscribed = true (and unsubscribed_at). From the NEXT
 * alert run on, that address is never emailed. Idempotent: clicking twice is a
 * no-op. Returns a friendly confirmation page.
 */
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function page(title: string, body: string): Response {
  const html = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>${title} · Contrax</title>
</head>
<body style="margin:0;padding:0;background-color:#f4f4f5;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;">
<table role="presentation" cellpadding="0" cellspacing="0" width="100%" style="background-color:#f4f4f5;">
<tr><td align="center" style="padding:48px 16px;">
  <table role="presentation" cellpadding="0" cellspacing="0" width="100%" style="max-width:480px;background:#ffffff;border-radius:12px;overflow:hidden;box-shadow:0 1px 3px rgba(0,0,0,0.08);">
    <tr><td style="background:linear-gradient(135deg,#2563eb,#1d4ed8);padding:28px 32px;text-align:center;">
      <h1 style="margin:0;color:#ffffff;font-size:22px;font-weight:700;">Contrax</h1>
    </td></tr>
    <tr><td style="padding:32px;">
      <h2 style="margin:0 0 12px;color:#111827;font-size:20px;font-weight:600;">${title}</h2>
      ${body}
    </td></tr>
    <tr><td style="background:#f9fafb;padding:16px 32px;text-align:center;border-top:1px solid #e5e7eb;">
      <p style="margin:0;color:#9ca3af;font-size:12px;">Contrax — AI-powered government contract discovery</p>
    </td></tr>
  </table>
</td></tr>
</table>
</body>
</html>`;
  return new Response(html, {
    status: 200,
    headers: { "Content-Type": "text/html; charset=utf-8" },
  });
}

async function handler({ request }: { request: Request }) {
  try {
    const url = new URL(request.url);
    const rawEmail = url.searchParams.get("email") ?? "";
    const email = rawEmail.trim().toLowerCase();
    if (!email || !EMAIL_PATTERN.test(email) || email.length > 254) {
      return page(
        "Unsubscribe",
        `<p style="margin:0 0 16px;color:#4b5563;font-size:15px;line-height:1.6;">We couldn't find a valid email address in that link.</p>
         <p style="margin:0;color:#6b7280;font-size:13px;line-height:1.6;">If this doesn't look right, you can contact us and we'll remove you from the list manually.</p>`,
      );
    }

    // Defensive DDL guard: ensure the alert columns exist even if migration 019
    // hasn't been applied to this environment yet (lazy self-heal, same pattern
    // as /api/radar-save and /api/event).
    try {
      await sql()`ALTER TABLE radar_saves ADD COLUMN IF NOT EXISTS unsubscribed BOOLEAN NOT NULL DEFAULT false`;
      await sql()`ALTER TABLE radar_saves ADD COLUMN IF NOT EXISTS unsubscribed_at TIMESTAMPTZ`;
    } catch (e) {
      console.error(
        "[api/radar-unsubscribe] ensure columns:",
        (e as Error).message,
      );
    }

    await sql()`
      UPDATE radar_saves
      SET unsubscribed = true, unsubscribed_at = COALESCE(unsubscribed_at, NOW())
      WHERE email = ${email}
        AND unsubscribed = false
    `;

    return page(
      "You're unsubscribed",
      `<p style="margin:0 0 16px;color:#4b5563;font-size:15px;line-height:1.6;">
         <strong>${email}</strong> will no longer receive contract-matching radar alerts from Contrax.
       </p>
       <p style="margin:0;color:#6b7280;font-size:13px;line-height:1.6;">
         We'll stop emailing you from the next alert run. If this was a mistake or you'd like alerts again, please reach out and we'll be glad to help.
       </p>`,
    );
  } catch (error) {
    console.error("[api/radar-unsubscribe] error:", error);
    return page(
      "Something went wrong",
      `<p style="margin:0;color:#4b5563;font-size:15px;line-height:1.6;">We couldn't process that request right now. Please try again in a moment.</p>`,
    );
  }
}

export const Route = createFileRoute("/api/radar-unsubscribe")({
  server: { handlers: { GET: handler } },
});
