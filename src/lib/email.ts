/**
 * Transactional email module for Contrax.
 *
 * Uses Resend to send welcome emails after successful Stripe checkout
 * and bid-digest emails after each sync run.
 */

import { Resend } from "resend";

// ── Types ──────────────────────────────────────────────────────────────────────

export interface NewBidSummary {
  title: string;
  agency: string;
  source_url: string;
  location: string;
  due_date: string | null;
  set_aside?: string | null;
  bid_id?: number;
}

// ── Client Initialization ──────────────────────────────────────────────────────

let resendClient: Resend | null = null;

function getResend(): Resend | null {
  if (resendClient) return resendClient;

  const key = process.env.RESEND_API_KEY;
  if (!key) {
    console.warn("RESEND_API_KEY is not set — email sending disabled");
    return null;
  }
  resendClient = new Resend(key);
  return resendClient;
}

// ── Welcome Email ──────────────────────────────────────────────────────────────

/**
 * Send a welcome email to a new Contrax user after checkout.
 *
 * This is fire-and-forget — errors are logged but never thrown so they don't
 * block the webhook response.
 */
export async function sendWelcomeEmail(to: string): Promise<void> {
  try {
    const resend = getResend();
    if (!resend) {
      console.warn("Cannot send welcome email — RESEND_API_KEY not set");
      return;
    }

    await resend.emails.send({
      from: "Contrax <hello@contrax.company>",
      to: [to],
      subject: "Welcome to Contrax — let's find your first contract",
      html: welcomeEmailHtml(to),
    });

    console.log(`Welcome email sent to ${to}`);
  } catch (err) {
    console.error(
      `Failed to send welcome email to ${to}:`,
      (err as Error).message,
    );
    // Never throw — this is non-blocking
  }
}

// ── Password Reset Email ───────────────────────────────────────────────────────

/**
 * Send a password reset link to a user who requested one via /forgot-password.
 *
 * Fire-and-forget — errors are logged but never thrown so they don't break the
 * request handler (which must always return success to avoid user enumeration).
 */
export async function sendPasswordResetEmail(
  to: string,
  token: string,
): Promise<void> {
  try {
    const resend = getResend();
    if (!resend) {
      console.warn("Cannot send password reset email — RESEND_API_KEY not set");
      return;
    }

    await resend.emails.send({
      from: "Contrax <hello@contrax.company>",
      to: [to],
      subject: "Reset your Contrax password",
      html: passwordResetEmailHtml(token),
    });

    console.log(`Password reset email sent to ${to}`);
  } catch (err) {
    console.error(
      `Failed to send password reset email to ${to}:`,
      (err as Error).message,
    );
    // Never throw — this is non-blocking
  }
}

// ── Bid Digest Email ───────────────────────────────────────────────────────────

/**
 * Send a digest email to all registered users with summaries of newly discovered
 * government bids. Uses BCC so recipients don't see each other's addresses.
 *
 * Fire-and-forget — errors are logged but never thrown.
 */
export async function sendBidDigest(
  recipients: string[],
  newBids: NewBidSummary[],
): Promise<void> {
  if (recipients.length === 0) return;

  try {
    const resend = getResend();
    if (!resend) {
      console.warn("Cannot send bid digest — RESEND_API_KEY not set");
      return;
    }

    await resend.emails.send({
      from: "Contrax <hello@contrax.company>",
      to: ["hello@contrax.company"],
      bcc: recipients,
      subject: `🆕 ${newBids.length} new government bids found — Contrax`,
      html: bidDigestHtml(newBids),
    });

    console.log(
      `Bid digest sent to ${recipients.length} recipient(s) with ${newBids.length} new bid(s)`,
    );
  } catch (err) {
    console.error(`Failed to send bid digest:`, (err as Error).message);
    // Never throw — this is non-blocking
  }
}

// ── Radar Alert Email ──────────────────────────────────────────────────────────
export interface RadarAlertMatch {
  title: string;
  agency: string;
  estimated_value: string | null;
  due_date: string | null;
  set_aside: string | null;
  source_url: string | null;
}

/**
 * Send a "new matching solicitations" digest to ONE opted-in Contract Radar
 * lead. This is the fulfillment of the "Save your matches" promise ("We'll
 * only email you about matching contract opportunities. Unsubscribe anytime.").
 *
 * Honesty rules baked in:
 *   * Every email carries a REAL working unsubscribe link (flips
 *     radar_saves.unsubscribed via /api/radar-unsubscribe).
 *   * No fabricated urgency, no "unlimited", no invented deadlines — it lists
 *     the actual open matching bids with their real (or "not disclosed") value
 *     and their real close date.
 *   * One email per lead per run, listing all NEW matches.
 *
 * Unlike the fire-and-forget helpers above, this RETURNS a boolean so the
 * alert job can mark a lead as alerted ONLY after the send actually resolves
 * successfully (idempotency: never mark-and-send twice, never mark-without-
 * sending). It still never throws — errors are logged and result in `false`.
 */
export async function sendRadarAlertEmail(opts: {
  to: string;
  certLabel: string;
  stateLabel: string; // human label: a state code or "nationwide"
  matches: RadarAlertMatch[];
  unsubscribeUrl: string;
}): Promise<boolean> {
  const { to, certLabel, stateLabel, matches, unsubscribeUrl } = opts;
  try {
    const resend = getResend();
    if (!resend) {
      console.warn("Cannot send radar alert \u2014 RESEND_API_KEY not set");
      return false;
    }
    const n = matches.length;
    const subject = `${n} new matching ${certLabel} ${stateLabel === "nationwide" ? "" : stateLabel + " "}contract${n === 1 ? "" : "s"} \u2014 Contrax Radar`;
    const html = radarAlertHtml({
      certLabel,
      stateLabel,
      matches,
      unsubscribeUrl,
    });
    const sent = await resend.emails.send({
      from: "Contrax <hello@contrax.company>",
      to: [to],
      subject,
      html,
    });
    if (sent && sent.error) {
      console.error(`Radar alert to ${to} rejected by Resend:`, sent.error);
      return false;
    }
    return true;
  } catch (err) {
    console.error(
      `Failed to send radar alert to ${to}:`,
      (err as Error).message,
    );
    return false;
  }
}

function radarAlertHtml(opts: {
  certLabel: string;
  stateLabel: string;
  matches: RadarAlertMatch[];
  unsubscribeUrl: string;
}): string {
  const { certLabel, stateLabel, matches, unsubscribeUrl } = opts;
  const rows = matches
    .map((m) => {
      const value =
        m.estimated_value &&
        String(m.estimated_value).trim() &&
        !/not disclosed|not specified/i.test(String(m.estimated_value))
          ? escapeHtml(String(m.estimated_value))
          : "not disclosed";
      const close = m.due_date
        ? new Date(m.due_date).toLocaleDateString("en-US", {
            month: "short",
            day: "numeric",
            year: "numeric",
          })
        : "not stated";
      const setAside = m.set_aside
        ? escapeHtml(String(m.set_aside))
        : "Set-aside";
      const link = m.source_url || "https://sam.gov/";
      return `
<tr>
  <td style="padding:16px;border-bottom:1px solid #e5e7eb;">
    <a href="${link}" style="color:#2563eb;font-size:16px;font-weight:600;text-decoration:none;display:block;margin-bottom:6px;">
      ${escapeHtml(m.title)}
    </a>
    <table role="presentation" cellpadding="0" cellspacing="0" width="100%">
      <tr>
        <td style="color:#6b7280;font-size:13px;padding-right:16px;padding-bottom:4px;"><strong>Agency:</strong> ${escapeHtml(m.agency)}</td>
        <td style="color:#6b7280;font-size:13px;padding-right:16px;padding-bottom:4px;"><strong>${setAside}:</strong></td>
      </tr>
      <tr>
        <td style="color:#6b7280;font-size:13px;padding-right:16px;"><strong>Est. value:</strong> ${value}</td>
        <td style="color:#6b7280;font-size:13px;"><strong>Close:</strong> ${close}</td>
      </tr>
    </table>
  </td>
</tr>`;
    })
    .join("\n");

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>${matches.length} new matching contracts \u2014 Contrax</title>
</head>
<body style="margin:0;padding:0;background-color:#f4f4f5;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;">
<table role="presentation" cellpadding="0" cellspacing="0" width="100%" style="background-color:#f4f4f5;">
<tr>
  <td align="center" style="padding:40px 16px;">
    <table role="presentation" cellpadding="0" cellspacing="0" width="100%" style="max-width:600px;background:#ffffff;border-radius:12px;overflow:hidden;box-shadow:0 1px 3px rgba(0,0,0,0.08);">
      <!-- Header -->
      <tr>
        <td style="background:linear-gradient(135deg,#2563eb,#1d4ed8);padding:32px 32px 24px;text-align:center;">
          <h1 style="margin:0;color:#ffffff;font-size:22px;font-weight:700;letter-spacing:-0.5px;">
            🎯 ${matches.length} new matching ${certLabel} contract${matches.length === 1 ? "" : "s"}
          </h1>
          <p style="margin:8px 0 0;color:rgba(255,255,255,0.85);font-size:14px;">
            ${stateLabel === "nationwide" ? "Open nationwide" : `In ${stateLabel}`} · as of today
          </p>
        </td>
      </tr>
      <!-- Body -->
      <tr>
        <td style="padding:24px 32px 8px;">
          <p style="margin:0 0 16px;color:#374151;font-size:15px;line-height:1.6;">
            ${matches.length} ${certLabel.toLowerCase()} set-aside opportunity${matches.length === 1 ? "" : "ies"} matching your saved ${stateLabel === "nationwide" ? "nationwide" : stateLabel + " "}search opened recently. Here they are:
          </p>
        </td>
      </tr>
      <!-- Bid list -->
      <tr>
        <td style="padding:8px 32px 16px;">
          <table role="presentation" cellpadding="0" cellspacing="0" width="100%" style="border:1px solid #e5e7eb;border-radius:8px;overflow:hidden;">
            ${rows}
          </table>
        </td>
      </tr>
      <tr>
        <td style="padding:0 32px 24px;">
          <p style="margin:0;color:#6b7280;font-size:13px;line-height:1.6;">
            Each link goes to the official solicitation on <strong>sam.gov</strong> (or the source that listed it). Values and close dates are shown as published; "not disclosed" means the agency did not state an estimate.
          </p>
        </td>
      </tr>
      <!-- Footer -->
      <tr>
        <td style="background:#f9fafb;padding:20px 32px;text-align:center;border-top:1px solid #e5e7eb;">
          <p style="margin:0 0 12px;color:#6b7280;font-size:12px;line-height:1.6;">
            You're receiving this because you asked us to alert you when matching ${certLabel} opportunities open.
          </p>
          <a href="${unsubscribeUrl}"
             style="display:inline-block;color:#9ca3af;font-size:12px;text-decoration:underline;">
            Unsubscribe from radar alerts
          </a>
          <p style="margin:12px 0 0;color:#9ca3af;font-size:12px;">
            Contrax \u2014 AI-powered government contract discovery
          </p>
        </td>
      </tr>
    </table>
  </td>
</tr>
</table>
</body>
</html>`;
}

// ── HTML Template ──────────────────────────────────────────────────────────────

function welcomeEmailHtml(email: string): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Welcome to Contrax</title>
</head>
<body style="margin:0;padding:0;background-color:#f4f4f5;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;">
  <table role="presentation" cellpadding="0" cellspacing="0" width="100%" style="background-color:#f4f4f5;">
    <tr>
      <td align="center" style="padding:40px 16px;">
        <table role="presentation" cellpadding="0" cellspacing="0" width="100%" style="max-width:560px;background:#ffffff;border-radius:12px;overflow:hidden;box-shadow:0 1px 3px rgba(0,0,0,0.08);">
          <!-- Header -->
          <tr>
            <td style="background:linear-gradient(135deg,#2563eb,#1d4ed8);padding:32px 32px 24px;text-align:center;">
              <h1 style="margin:0;color:#ffffff;font-size:24px;font-weight:700;letter-spacing:-0.5px;">Contrax</h1>
            </td>
          </tr>
          <!-- Body -->
          <tr>
            <td style="padding:32px;">
              <h2 style="margin:0 0 12px;color:#111827;font-size:20px;font-weight:600;">Welcome aboard!</h2>
              <p style="margin:0 0 16px;color:#4b5563;font-size:15px;line-height:1.6;">
                Your Contrax account for <strong>${email}</strong> is ready to go.
              </p>
              <p style="margin:0 0 16px;color:#4b5563;font-size:15px;line-height:1.6;">
                Contrax is your AI-powered government contract discovery platform. We monitor
                procurement sites, summarize bid documents, and draft proposals so you can
                find and win government contracts faster than ever.
              </p>

              <!-- CTA -->
              <table role="presentation" cellpadding="0" cellspacing="0" width="100%" style="margin:24px 0;">
                <tr>
                  <td align="center">
                    <a href="https://www.contrax.company/login"
                       style="display:inline-block;background:#2563eb;color:#ffffff;text-decoration:none;padding:12px 32px;border-radius:8px;font-size:15px;font-weight:600;text-align:center;">
                      Log in to Contrax
                    </a>
                  </td>
                </tr>
              </table>

              <p style="margin:0 0 8px;color:#6b7280;font-size:13px;line-height:1.5;">
                Your account is ready — head to the login page and set your password to get started.
              </p>

              <!-- Divider -->
              <hr style="border:none;border-top:1px solid #e5e7eb;margin:24px 0;">

              <p style="margin:0 0 8px;color:#374151;font-size:15px;font-weight:600;">What's next?</p>
              <ol style="margin:0;padding:0 0 0 20px;color:#4b5563;font-size:14px;line-height:1.7;">
                <li>Log in at <a href="https://www.contrax.company/login" style="color:#2563eb;">www.contrax.company/login</a></li>
                <li>Complete your onboarding — tell us about your services and locations</li>
                <li>Browse live government contracts matched to your profile</li>
                <li>Use AI to summarize bids and draft proposals in seconds</li>
              </ol>
            </td>
          </tr>
          <!-- Footer -->
          <tr>
            <td style="background:#f9fafb;padding:20px 32px;text-align:center;border-top:1px solid #e5e7eb;">
              <p style="margin:0 0 4px;color:#9ca3af;font-size:12px;">
                Contrax — AI-powered government contract discovery
              </p>
              <p style="margin:0;color:#9ca3af;font-size:12px;">
                &copy; ${new Date().getFullYear()} Contrax. All rights reserved.
              </p>
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;
}

// ── Password Reset HTML Template ───────────────────────────────────────────────

function passwordResetEmailHtml(token: string): string {
  const resetUrl = `https://www.contrax.company/reset-password?token=${encodeURIComponent(token)}`;
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Reset Your Contrax Password</title>
</head>
<body style="margin:0;padding:0;background-color:#f4f4f5;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;">
  <table role="presentation" cellpadding="0" cellspacing="0" width="100%" style="background-color:#f4f4f5;">
    <tr>
      <td align="center" style="padding:40px 16px;">
        <table role="presentation" cellpadding="0" cellspacing="0" width="100%" style="max-width:560px;background:#ffffff;border-radius:12px;overflow:hidden;box-shadow:0 1px 3px rgba(0,0,0,0.08);">
          <!-- Header -->
          <tr>
            <td style="background:linear-gradient(135deg,#2563eb,#1d4ed8);padding:32px 32px 24px;text-align:center;">
              <h1 style="margin:0;color:#ffffff;font-size:24px;font-weight:700;letter-spacing:-0.5px;">Contrax</h1>
            </td>
          </tr>
          <!-- Body -->
          <tr>
            <td style="padding:32px;">
              <h2 style="margin:0 0 12px;color:#111827;font-size:20px;font-weight:600;">Reset your password</h2>
              <p style="margin:0 0 16px;color:#4b5563;font-size:15px;line-height:1.6;">
                We received a request to reset the password for your Contrax account.
                Click the button below to choose a new password. This link expires in 1 hour.
              </p>

              <!-- CTA -->
              <table role="presentation" cellpadding="0" cellspacing="0" width="100%" style="margin:24px 0;">
                <tr>
                  <td align="center">
                    <a href="${resetUrl}"
                       style="display:inline-block;background:#2563eb;color:#ffffff;text-decoration:none;padding:12px 32px;border-radius:8px;font-size:15px;font-weight:600;text-align:center;">
                      Reset Password
                    </a>
                  </td>
                </tr>
              </table>

              <p style="margin:0 0 8px;color:#6b7280;font-size:13px;line-height:1.5;">
                If the button doesn't work, copy and paste this link into your browser:
              </p>
              <p style="margin:0 0 16px;color:#2563eb;font-size:13px;line-height:1.5;word-break:break-all;">
                ${resetUrl}
              </p>
              <p style="margin:0;color:#6b7280;font-size:13px;line-height:1.5;">
                If you didn't request a password reset, you can safely ignore this email.
              </p>
            </td>
          </tr>
          <!-- Footer -->
          <tr>
            <td style="background:#f9fafb;padding:20px 32px;text-align:center;border-top:1px solid #e5e7eb;">
              <p style="margin:0 0 4px;color:#9ca3af;font-size:12px;">
                Contrax — AI-powered government contract discovery
              </p>
              <p style="margin:0;color:#9ca3af;font-size:12px;">
                &copy; ${new Date().getFullYear()} Contrax. All rights reserved.
              </p>
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;
}

// ── Bid Digest HTML Template ───────────────────────────────────────────────────

function bidDigestHtml(bids: NewBidSummary[]): string {
  const now = new Date().toLocaleDateString("en-US", {
    weekday: "long",
    year: "numeric",
    month: "long",
    day: "numeric",
  });

  const bidRows = bids
    .map(
      (bid) => `
<tr>
  <td style="padding:16px;border-bottom:1px solid #e5e7eb;">
    <a href="${bid.source_url}"
       style="color:#2563eb;font-size:16px;font-weight:600;text-decoration:none;display:block;margin-bottom:6px;">
      ${escapeHtml(bid.title)}
    </a>
    <table role="presentation" cellpadding="0" cellspacing="0" width="100%">
      <tr>
        <td style="color:#6b7280;font-size:13px;padding-right:16px;">
          <strong>Agency:</strong> ${escapeHtml(bid.agency)}
        </td>
        <td style="color:#6b7280;font-size:13px;padding-right:16px;">
          <strong>Location:</strong> ${escapeHtml(bid.location)}
        </td>
        <td style="color:#6b7280;font-size:13px;">
          <strong>Due:</strong> ${bid.due_date ? new Date(bid.due_date).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" }) : "N/A"}
        </td>
      </tr>
    </table>
  </td>
</tr>`,
    )
    .join("\n");

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>New Government Bids — Contrax</title>
</head>
<body style="margin:0;padding:0;background-color:#f4f4f5;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;">
<table role="presentation" cellpadding="0" cellspacing="0" width="100%" style="background-color:#f4f4f5;">
<tr>
  <td align="center" style="padding:40px 16px;">
    <table role="presentation" cellpadding="0" cellspacing="0" width="100%" style="max-width:600px;background:#ffffff;border-radius:12px;overflow:hidden;box-shadow:0 1px 3px rgba(0,0,0,0.08);">
      <!-- Header -->
      <tr>
        <td style="background:linear-gradient(135deg,#2563eb,#1d4ed8);padding:32px 32px 24px;text-align:center;">
          <h1 style="margin:0;color:#ffffff;font-size:24px;font-weight:700;letter-spacing:-0.5px;">
            🆕 ${bids.length} New Bid${bids.length === 1 ? "" : "s"} Found
          </h1>
          <p style="margin:8px 0 0;color:rgba(255,255,255,0.85);font-size:14px;">
            ${now}
          </p>
        </td>
      </tr>
      <!-- Summary -->
      <tr>
        <td style="padding:24px 32px 8px;">
          <p style="margin:0;color:#374151;font-size:15px;line-height:1.6;">
            Contrax discovered <strong>${bids.length} new government contract${bids.length === 1 ? "" : "s"}</strong> in your latest sync. Here's what's new:
          </p>
        </td>
      </tr>
      <!-- Bid List -->
      <tr>
        <td style="padding:8px 32px 16px;">
          <table role="presentation" cellpadding="0" cellspacing="0" width="100%" style="border:1px solid #e5e7eb;border-radius:8px;overflow:hidden;">
            ${bidRows}
          </table>
        </td>
      </tr>
      <!-- CTA -->
      <tr>
        <td style="padding:8px 32px 24px;text-align:center;">
          <a href="https://www.contrax.company/dashboard"
             style="display:inline-block;background:#2563eb;color:#ffffff;text-decoration:none;padding:12px 32px;border-radius:8px;font-size:15px;font-weight:600;text-align:center;">
            View All Bids in Contrax
          </a>
        </td>
      </tr>
      <!-- Footer -->
      <tr>
        <td style="background:#f9fafb;padding:20px 32px;text-align:center;border-top:1px solid #e5e7eb;">
          <p style="margin:0 0 4px;color:#9ca3af;font-size:12px;">
            Contrax — AI-powered government contract discovery
          </p>
          <p style="margin:0;color:#9ca3af;font-size:12px;">
            &copy; ${new Date().getFullYear()} Contrax. All rights reserved.
          </p>
        </td>
      </tr>
    </table>
  </td>
</tr>
</table>
</body>
</html>`;
}

// ── Helpers ────────────────────────────────────────────────────────────────────

function escapeHtml(str: string): string {
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}
