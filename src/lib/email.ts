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
