/**
 * Launchpad "Email me my capability statement" (owner 2026-10-17). Pure and
 * client-safe: request validation plus the email body.
 *
 * The statement goes ONLY to the business email typed into the profile. Every
 * profile value is escaped and nothing the visitor typed becomes a link, so
 * the email can't be used to deliver someone else's links or markup.
 */
import { capabilityReady, capabilityText, type LaunchpadProfile } from "~/lib/launchpad";

export const STATEMENT_SUBJECT = "Your capability statement from Contrax Launchpad";

export interface StatementRequest {
  profile: LaunchpadProfile;
  alerts: boolean;
  visitorId: string | null;
}

const PROFILE_FIELDS: (keyof LaunchpadProfile)[] = [
  "company", "trade", "state", "contact", "email", "phone", "website", "summary",
  "competencies", "differentiators", "experience", "naics", "uei", "cage", "certifications",
];

/** Parse an untrusted request body. Returns null unless the statement is complete. */
export function parseStatementRequest(body: unknown): StatementRequest | null {
  if (!body || typeof body !== "object") return null;
  const raw = (body as { profile?: Record<string, unknown> }).profile;
  if (!raw || typeof raw !== "object") return null;
  const profile = {} as LaunchpadProfile;
  for (const field of PROFILE_FIELDS) {
    const value = raw[field];
    profile[field] = typeof value === "string" ? value.trim().slice(0, 4000) : "";
  }
  profile.email = profile.email.toLowerCase().slice(0, 254);
  if (!/^[A-Z]{2}$/.test(profile.state)) profile.state = "";
  if (!capabilityReady(profile)) return null;
  const vid = (body as { visitor_id?: unknown }).visitor_id;
  return {
    profile,
    alerts: (body as { alerts?: unknown }).alerts === true,
    visitorId: typeof vid === "string" && vid.trim() ? vid.trim().slice(0, 64) : null,
  };
}

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
}

export function statementEmailHtml(profile: LaunchpadProfile, alerts: boolean): string {
  const body = escapeHtml(capabilityText(profile).split("\n").slice(3, -2).join("\n"));
  const alertLine = alerts
    ? `<p style="margin:16px 0 0;color:#4b5563;font-size:14px;line-height:1.6;">You also asked for matching bids by email. Look for a separate message asking you to confirm. Nothing is sent until you do.</p>`
    : "";
  return `<!DOCTYPE html>
<html lang="en">
<head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1.0"><title>${escapeHtml(STATEMENT_SUBJECT)}</title></head>
<body style="margin:0;padding:0;background-color:#f4f4f5;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;">
  <table role="presentation" cellpadding="0" cellspacing="0" width="100%" style="background-color:#f4f4f5;"><tr><td align="center" style="padding:32px 16px;">
    <table role="presentation" cellpadding="0" cellspacing="0" width="100%" style="max-width:640px;background:#ffffff;border-radius:12px;overflow:hidden;">
      <tr><td style="background:#102342;padding:28px 32px;color:#ffffff;">
        <p style="margin:0;font-size:12px;font-weight:700;letter-spacing:2px;text-transform:uppercase;color:#bfdbfe;">Capability statement</p>
        <h1 style="margin:8px 0 0;font-size:26px;line-height:1.2;">${escapeHtml(profile.company)}</h1>
      </td></tr>
      <tr><td style="padding:28px 32px;">
        <pre style="margin:0;white-space:pre-wrap;word-break:break-word;font:15px/1.6 -apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;color:#14233b;">${body}</pre>
        ${alertLine}
        <p style="margin:24px 0 0;"><a href="https://www.contrax.company/launchpad" style="display:inline-block;background:#1d4ed8;color:#ffffff;text-decoration:none;padding:12px 22px;border-radius:10px;font-weight:700;font-size:14px;">Edit it in Launchpad</a></p>
      </td></tr>
      <tr><td style="padding:16px 32px 24px;border-top:1px solid #e5e7eb;color:#6b7280;font-size:12px;line-height:1.5;">
        Prepared with Contrax Launchpad from the details entered on that page. Verify every claim before sharing it with a buyer.
        This copy was requested at contrax.company/launchpad. If you didn't ask for it, you can ignore this email; you won't get another unless it's requested again.
      </td></tr>
    </table>
  </td></tr></table>
</body>
</html>`;
}
