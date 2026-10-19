/**
 * One-time product announcements to every signed-up account (owner 2026-10-19:
 * "send email to all signed up accounts about the upgrade"). Each announcement
 * has a key; src/jobs/send-announcement.ts records every address it reaches
 * under that key, so a re-run never emails anyone twice.
 *
 * Recipients: every account email, minus admins, @test.contrax accounts and
 * anyone who unsubscribed from the weekly bid email (email_preferences); the
 * email's unsubscribe link sets that same flag.
 */

export const ANNOUNCEMENT_KEY = "federal-coverage-2026-10";

export interface AnnouncementUserRow {
  email: string | null;
  is_admin?: boolean | null;
}

/** Unique (case-insensitive) addresses to email, in first-seen order. */
export function announcementRecipients(
  users: readonly AnnouncementUserRow[],
  optedOut: ReadonlySet<string>,
  alreadySent: ReadonlySet<string> = new Set(),
): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const u of users) {
    const email = String(u.email ?? "").trim();
    const lower = email.toLowerCase();
    if (!email || !email.includes("@")) continue;
    if (u.is_admin) continue;
    if (lower.endsWith("@test.contrax")) continue;
    if (optedOut.has(lower) || alreadySent.has(lower) || seen.has(lower)) continue;
    seen.add(lower);
    out.push(email);
  }
  return out;
}

function escapeHtml(value: string): string {
  return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

const SUBJECT = "Contrax now tracks nearly 3× more federal bids";
const URL = "https://www.contrax.company/?utm_source=email&utm_campaign=federal_coverage";

const HIGHLIGHTS = [
  "🇺🇸 Over 5,700 open federal bids nationwide",
  "🏛️ Over 7,300 open state & local bids on top of that",
  "📍 All 50 states + DC. Yes, even Maine.",
];

const PARAGRAPHS = [
  "Every bid we show now has a real, future deadline. No expired listings. No award notices dressed up as bids. No filler.",
  "⚡ Federal bids now update every night straight from SAM.gov, the federal government's official contract source, alongside the state and local boards we already cover.",
  "🔨 Janitorial. HVAC. Roofing. Landscaping. Trucking. IT. Construction. Whatever your trade, there's government work out there with your name on it, and now you'll actually see it.",
];

export function federalUpgradeEmail(unsubscribeUrl: string): { subject: string; html: string; text: string } {
  const p = (t: string) => `<p style="margin:0 0 16px;color:#4b5563;font-size:15px;line-height:1.6;">${escapeHtml(t)}</p>`;
  const html = `<!DOCTYPE html>
<html lang="en"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1.0"><title>${escapeHtml(SUBJECT)}</title></head>
<body style="margin:0;padding:0;background-color:#f4f4f5;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;">
  <table role="presentation" cellpadding="0" cellspacing="0" width="100%" style="background-color:#f4f4f5;"><tr><td align="center" style="padding:32px 16px;">
    <table role="presentation" cellpadding="0" cellspacing="0" width="100%" style="max-width:560px;background:#ffffff;border-radius:12px;overflow:hidden;">
      <tr><td style="background:#102342;padding:24px 32px;color:#ffffff;"><h1 style="margin:0;font-size:22px;">Contrax</h1></td></tr>
      <tr><td style="padding:28px 32px;">
        <h2 style="margin:0 0 16px;color:#111827;font-size:20px;line-height:1.3;">🚨 Big upgrade: ${escapeHtml(SUBJECT)}</h2>
        <ul style="margin:0 0 16px;padding-left:20px;color:#111827;font-size:15px;line-height:1.7;font-weight:600;">${HIGHLIGHTS.map((l) => `<li>${escapeHtml(l)}</li>`).join("")}</ul>
        ${PARAGRAPHS.map(p).join("\n        ")}
        ${p("💰 Pick your trade and your state, and see what's open near you in seconds.")}
        <p style="margin:0 0 20px;"><a href="${URL}" style="display:inline-block;background:#1d4ed8;color:#ffffff;text-decoration:none;padding:12px 22px;border-radius:10px;font-weight:700;font-size:15px;">See what's open near you →</a></p>
        <p style="margin:0;color:#4b5563;font-size:15px;line-height:1.6;">Nathaniel Minetree<br>Owner and CEO, Contrax LLC</p>
      </td></tr>
      <tr><td style="padding:16px 32px 24px;border-top:1px solid #e5e7eb;color:#6b7280;font-size:12px;line-height:1.5;">
        You're getting this one-time update because you have a Contrax account. Live counts change daily as bids open and close. Questions? Reply to this email.
        <a href="${escapeHtml(unsubscribeUrl)}" style="color:#6b7280;">Unsubscribe from Contrax updates and the weekly bid email</a>.
      </td></tr>
    </table>
  </td></tr></table>
</body></html>`;
  const text = [
    `Big upgrade: ${SUBJECT}`,
    HIGHLIGHTS.join("\n"),
    ...PARAGRAPHS,
    "Pick your trade and your state, and see what's open near you in seconds.",
    `See what's open near you: ${URL}`,
    "Nathaniel Minetree\nOwner and CEO, Contrax LLC",
    `You're getting this one-time update because you have a Contrax account. Unsubscribe: ${unsubscribeUrl}`,
  ].join("\n\n");
  return { subject: SUBJECT, html, text };
}
