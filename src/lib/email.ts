/**
 * Transactional email module for Contrax.
 *
 * Uses Resend to send welcome emails after successful Stripe checkout
 * and bid-digest emails after each sync run.
 */

import { digestBidsToList } from "./digest-recipients";
import { displayCompanyName, formatAwardAmount } from "./award-check";
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
  /**
   * The stored `bids.source` label for this row (PR-1 restructure, owner
   * ruling d). Carried so the sync runner can keep AWARD-TYPE sources
   * (Chicago/SF/Austin open-data awards) out of the opportunity surfaces —
   * bid alerts, in-app notifications and this digest e-mail — without
   * re-reading the database. The e-mail templates do not render it.
   */
  source?: string | null;
  /**
   * Owner-exact "Why it matches: CERT · Category · Size" line (Radar match
   * alerts, 2026-09-07). Computed by the sender from the ACTUAL match flags
   * that fired for this bid (whyBidMatchesLeadProfile) — never invented.
   * Null/omitted → the honest "your Radar profile" fallback.
   */
  why_line?: string | null;
  /**
   * Per-bid "View opportunity →" CTA through the PII-safe click redirect
   * (/api/radar/opportunity-click?bid=<id>&token=…). Falls back to source_url
   * when absent (e.g. the legacy bid-digest path, which never sets it).
   */
  click_url?: string | null;
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
      replyTo: "contrax.companyllc@gmail.com",
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
      replyTo: "contrax.companyllc@gmail.com",
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
 * The free Basic plan's weekly email (src/lib/weekly-digest.ts). Unlike the
 * daily digest it is addressed to each person separately, because each copy
 * carries that person's own unsubscribe link (also sent as List-Unsubscribe).
 * Sent through Resend's batch API, up to 100 per call. Returns how many were
 * accepted; never throws.
 */
export const WEEKLY_DIGEST_BATCH_SIZE = 100;

export async function sendWeeklyBidDigest(
  recipients: { email: string; unsubscribeUrl: string }[],
  newBids: NewBidSummary[],
  headStartCount = 0,
  foundingSpots: number | null = null,
): Promise<number> {
  if (recipients.length === 0 || newBids.length === 0) return 0;
  const resend = getResend();
  if (!resend) {
    console.warn("Cannot send weekly bid digest — RESEND_API_KEY not set");
    return 0;
  }
  const listed = digestBidsToList(newBids);
  const subject = `Your weekly bid digest: ${newBids.length} new government bid${newBids.length === 1 ? "" : "s"} — Contrax`;
  let accepted = 0;
  for (let i = 0; i < recipients.length; i += WEEKLY_DIGEST_BATCH_SIZE) {
    const chunk = recipients.slice(i, i + WEEKLY_DIGEST_BATCH_SIZE);
    try {
      const { error } = await resend.batch.send(
        chunk.map((r) => ({
          from: "Contrax <hello@contrax.company>",
          replyTo: "contrax.companyllc@gmail.com",
          to: [r.email],
          subject,
          html: bidDigestHtml(listed, newBids.length, { unsubscribeUrl: r.unsubscribeUrl, headStartCount, foundingSpots }),
          headers: {
            "List-Unsubscribe": `<${r.unsubscribeUrl}>`,
            "List-Unsubscribe-Post": "List-Unsubscribe=One-Click",
          },
        })),
      );
      if (error) {
        console.error(`Weekly digest batch ${i / WEEKLY_DIGEST_BATCH_SIZE + 1} rejected:`, error.message);
        continue;
      }
      accepted += chunk.length;
    } catch (err) {
      console.error(`Weekly digest batch ${i / WEEKLY_DIGEST_BATCH_SIZE + 1} failed:`, (err as Error).message);
    }
  }
  console.log(`Weekly bid digest accepted for ${accepted} of ${recipients.length} recipient(s), ${newBids.length} new bid(s)`);
  return accepted;
}

/**
 * The paying members' personal 6 AM emails (src/jobs/send-bid-digest.ts):
 * one email per member, listing the new bids that match their profile.
 * Sent through Resend's batch API, up to 100 per call. Returns how many were
 * accepted; never throws.
 */
export async function sendPersonalBidDigests(
  emails: { to: string; bids: NewBidSummary[]; options: DailyDigestHtmlOptions }[],
): Promise<number> {
  const ready = emails.filter((e) => e.bids.length > 0);
  if (ready.length === 0) return 0;
  const resend = getResend();
  if (!resend) {
    console.warn("Cannot send bid digest — RESEND_API_KEY not set");
    return 0;
  }
  let accepted = 0;
  for (let i = 0; i < ready.length; i += WEEKLY_DIGEST_BATCH_SIZE) {
    const chunk = ready.slice(i, i + WEEKLY_DIGEST_BATCH_SIZE);
    try {
      const { error } = await resend.batch.send(
        chunk.map((e) => ({
          from: "Contrax <hello@contrax.company>",
          replyTo: "contrax.companyllc@gmail.com",
          to: [e.to],
          subject: `Your morning bid digest: ${e.bids.length} new ${e.options.matchLabel ? "matching " : ""}government bid${e.bids.length === 1 ? "" : "s"} — Contrax`,
          html: bidDigestHtml(digestBidsToList(e.bids), e.bids.length, null, e.options),
        })),
      );
      if (error) {
        console.error(`Daily digest batch ${i / WEEKLY_DIGEST_BATCH_SIZE + 1} rejected:`, error.message);
        continue;
      }
      accepted += chunk.length;
    } catch (err) {
      console.error(`Daily digest batch ${i / WEEKLY_DIGEST_BATCH_SIZE + 1} failed:`, (err as Error).message);
    }
  }
  console.log(`Personal bid digests accepted for ${accepted} of ${ready.length} member(s)`);
  return accepted;
}

// ── Radar Match-Alert Confirmation Email ──────────────────────────────────────

/**
 * Send the ONE confirmation email for a new anonymous Radar match-alert lead
 * (owner 2026-09-06). Goes ONLY to the address that just submitted it — the
 * opt-in capture is personal and never cold. Protects deliverability + verifies
 * a real address before the (separately queued) periodic sender ever touches
 * this lead. The confirmation link is the only link in the email; the same
 * token powers the one-click unsubscribe so one email carries both promises
 * ("unsubscribe anytime").
 *
 * Fire-and-forget + fail-open: errors are logged (never the raw address — the
 * generic confirmation path omits the email from the log line to stay PII-safe)
 * and never thrown, so the capture endpoint can never be blocked by email-send
 * failure.
 */
export async function sendRadarLeadConfirmationEmail(
  to: string,
  token: string,
): Promise<void> {
  try {
    const resend = getResend();
    if (!resend) {
      console.warn("Cannot send radar lead confirmation — RESEND_API_KEY not set");
      return;
    }
    const confirmUrl = `https://www.contrax.company/api/radar/lead-confirm?token=${encodeURIComponent(token)}`;
    const unsubscribeUrl = `https://www.contrax.company/api/radar/lead-unsubscribe?token=${encodeURIComponent(token)}`;

    await resend.emails.send({
      from: "Contrax <hello@contrax.company>",
      replyTo: "contrax.companyllc@gmail.com",
      to: [to],
      subject: "Confirm your Contrax match alerts",
      html: radarLeadConfirmationHtml(confirmUrl, unsubscribeUrl),
    });

    // PII-safe: log the outcome WITHOUT the address.
    console.log("Radar lead confirmation email sent (1 lead)");
  } catch (err) {
    // PII-safe: never include the target address in the log line.
    console.error(
      "Failed to send radar lead confirmation email:",
      (err as Error).message,
    );
    // Never throw — this is non-blocking
  }
}

function radarLeadConfirmationHtml(confirmUrl: string, unsubscribeUrl: string): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Confirm your Contrax match alerts</title>
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
              <p style="margin:8px 0 0;color:rgba(255,255,255,0.85);font-size:14px;">Confirm your match alerts</p>
            </td>
          </tr>
          <!-- Body -->
          <tr>
            <td style="padding:32px;">
              <h2 style="margin:0 0 12px;color:#111827;font-size:20px;font-weight:600;">Please confirm your subscription</h2>
              <p style="margin:0 0 16px;color:#4b5563;font-size:15px;line-height:1.6;">
                You asked us to email you once a week with new government contract
                matches for your business — no account required. Tap the button below to
                confirm your address. Until you confirm, we won't send match alerts
                to this inbox.
              </p>

              <!-- CTA -->
              <table role="presentation" cellpadding="0" cellspacing="0" width="100%" style="margin:24px 0;">
                <tr>
                  <td align="center">
                    <a href="${confirmUrl}"
                       style="display:inline-block;background:#2563eb;color:#ffffff;text-decoration:none;padding:12px 32px;border-radius:8px;font-size:15px;font-weight:600;text-align:center;">
                      Confirm my match alerts
                    </a>
                  </td>
                </tr>
              </table>

              <p style="margin:0 0 8px;color:#6b7280;font-size:13px;line-height:1.5;">
                If the button doesn't work, copy and paste this link into your browser:
              </p>
              <p style="margin:0 0 16px;color:#2563eb;font-size:13px;line-height:1.5;word-break:break-all;">
                ${confirmUrl}
              </p>

              <!-- Divider -->
              <hr style="border:none;border-top:1px solid #e5e7eb;margin:24px 0;">

              <p style="margin:0 0 8px;color:#374151;font-size:15px;font-weight:600;">Unsubscribe anytime</p>
              <p style="margin:0 0 8px;color:#4b5563;font-size:13px;line-height:1.5;">
                Don't want alerts anymore? One click removes you:
                <a href="${unsubscribeUrl}" style="color:#2563eb;">unsubscribe from Contrax match alerts</a>.
              </p>
              <p style="margin:0;color:#9ca3af;font-size:12px;">If you didn't request this, you can safely ignore this email.</p>
            </td>
          </tr>
          <!-- Footer -->
          <tr>
            <td style="background:#f9fafb;padding:20px 32px;text-align:center;border-top:1px solid #e5e7eb;">
              <p style="margin:0 0 4px;color:#9ca3af;font-size:12px;">
                Contrax — AI-powered government contract discovery
              </p>
              <p style="margin:0 0 4px;color:#9ca3af;font-size:12px;">
                Contrax LLC · contrax.company
              </p>
              <p style="margin:0;color:#9ca3af;font-size:12px;">
                &copy; ${new Date().getFullYear()} Contrax LLC. All rights reserved.
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

// ── Radar Match-Alert Email (periodic sender) ───────────────────────────────── ──

/**
 * Send the periodic "new matching opportunities" email to ONE confirmed Radar
 * lead (owner 2026-09-06). Goes ONLY to confirmed, not-unsubscribed, consenting
 * leads who opted in at capture — the useful follow-up, never cold. Each bid is
 * a real NEW match against the lead's own Radar profile; no newsletters, no
 * company news, no generic re-engagement copy. One-click unsubscribe always.
 *
 * Returns TRUE only when Resend accepted the send — the sender advances its
 * per-lead dedupe ONLY on TRUE, so a failed email retries next run. Fire and
 * forget, fail-open, PII-safe (never logs the address).
 */
export async function sendRadarMatchAlertEmail(
  to: string,
  token: string,
  bids: NewBidSummary[],
  truncatedCount: number,
  foundingSpots: number | null = null,
): Promise<boolean> {
  try {
    const resend = getResend();
    if (!resend) {
      console.warn("Cannot send radar match alert — RESEND_API_KEY not set");
      return false;
    }
    const unsubscribeUrl = `https://www.contrax.company/api/radar/lead-unsubscribe?token=${encodeURIComponent(token)}`;

    await resend.emails.send({
      from: "Contrax <hello@contrax.company>",
      replyTo: "contrax.companyllc@gmail.com",
      to: [to],
      subject: `Contrax found ${bids.length} new opportunity${bids.length === 1 ? "" : "ies"} matching your Radar profile`,
      html: radarMatchAlertHtml(bids, truncatedCount, unsubscribeUrl, foundingSpots),
    });

    console.log(`Radar match alert sent (${bids.length} bid${bids.length === 1 ? "" : "s"}, +${truncatedCount} truncated, 1 lead)`);
    return true;
  } catch (err) {
    // PII-safe: never include the target address in the log line.
    console.error("Failed to send radar match alert:", (err as Error).message);
    return false;
  }
}

/** Owner-exact V1 layout: header + per-bid cards + "See all my matches →", nothing else. */
export function radarMatchAlertHtml(
  bids: NewBidSummary[],
  truncatedCount: number,
  unsubscribeUrl: string,
  foundingSpots: number | null = null,
): string {
  const bidCards = bids
    .map((bid) => {
      // "View opportunity →" goes through the PII-safe click redirect (logs the
      // opportunity_clicked funnel event, then 302s to the real source_url).
      // Legacy callers (bid digest) never set click_url → source_url fallback.
      const primaryUrl = bid.click_url || bid.source_url;
      // "Why it matches" shows ONLY reasons that actually fired (computed by
      // the sender); the honest "your Radar profile" fallback covers the rare
      // state-only match where no concrete flag fired. Escaped — never raw.
      const whyLine = bid.why_line?.trim() ? bid.why_line.trim() : "your Radar profile";
      return `
<tr>
  <td style="padding:0 32px 24px;">
    <table role="presentation" cellpadding="0" cellspacing="0" width="100%" style="border:1px solid #e5e7eb;border-radius:8px;overflow:hidden;margin-bottom:12px;">
      <tr>
        <td style="padding:16px 20px;">
          <a href="${primaryUrl}"
             style="color:#2563eb;font-size:16px;font-weight:600;text-decoration:none;display:block;margin-bottom:8px;line-height:1.4;">
            ${escapeHtml(bid.title)}
          </a>
          <p style="margin:0 0 8px;color:#6b7280;font-size:13px;line-height:1.5;">
            ${escapeHtml(bid.agency)} · ${escapeHtml(bid.location)} · ${escapeHtml(bid.set_aside ?? "Not set aside")} · Due ${bid.due_date ? new Date(bid.due_date).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" }) : "TBA"}
          </p>
          <p style="margin:0;color:#374151;font-size:13px;line-height:1.5;">
            <strong>Why it matches:</strong> ${escapeHtml(whyLine)}
          </p>
          <p style="margin:12px 0 0;">
            <a href="${primaryUrl}"
               style="color:#2563eb;font-size:13px;font-weight:600;text-decoration:none;">
              View opportunity →
            </a>
          </p>
        </td>
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
<title>New matching opportunities — Contrax</title>
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
            Contrax found ${bids.length} new opportunity${bids.length === 1 ? "" : "ies"} matching your Radar profile
          </h1>
        </td>
      </tr>
      <!-- Bids -->
      <tr>
        <td style="padding:24px 0 8px;">
          ${bidCards}
          ${truncatedCount > 0 ? `<p style="margin:0 32px 16px;color:#6b7280;font-size:13px;line-height:1.5;">…plus ${truncatedCount} more</p>` : ""}
        </td>
      </tr>
      <!-- See all my matches -->
      <tr>
        <td style="padding:8px 32px 24px;text-align:center;">
          <a href="https://www.contrax.company/radar"
             style="display:inline-block;background:#2563eb;color:#ffffff;text-decoration:none;padding:12px 32px;border-radius:8px;font-size:15px;font-weight:600;text-align:center;">
            See all my matches →
          </a>
          <p style="margin:16px 0 0;color:#6b7280;font-size:13px;line-height:1.5;">
            Free match alerts arrive once a week. Want every new bid each morning?
            ${foundingOfferOpen(foundingSpots)
              ? `Starter is ${starterPriceHtml(foundingSpots)}. <a href="https://www.contrax.company/pricing" style="color:#2563eb;font-weight:600;">Claim a founding spot →</a>`
              : `<a href="https://www.contrax.company/pricing" style="color:#2563eb;">Starter is $19/month</a>.`}
          </p>
        </td>
      </tr>
      <!-- Footer -->
      <tr>
        <td style="background:#f9fafb;padding:20px 32px;text-align:center;border-top:1px solid #e5e7eb;">
          <p style="margin:0 0 8px;color:#9ca3af;font-size:12px;">
            We only send you new opportunities that match your Radar profile.
          </p>
          <p style="margin:0;color:#9ca3af;font-size:12px;">
            <a href="${unsubscribeUrl}" style="color:#9ca3af;">Unsubscribe from match alerts</a>
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
              <p style="margin:0 0 4px;color:#9ca3af;font-size:12px;">
                Contrax LLC · contrax.company
              </p>
              <p style="margin:0;color:#9ca3af;font-size:12px;">
                &copy; ${new Date().getFullYear()} Contrax LLC. All rights reserved.
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
              <p style="margin:0 0 4px;color:#9ca3af;font-size:12px;">
                Contrax LLC · contrax.company
              </p>
              <p style="margin:0;color:#9ca3af;font-size:12px;">
                &copy; ${new Date().getFullYear()} Contrax LLC. All rights reserved.
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

// ── "Did I win?" award results (owner 2026-10-03) ──────────────────────────────
// One email per member listing the awards posted on bids in their pipeline
// (src/jobs/check-awards.ts). Pure HTML builder below, unit-tested.

export interface AwardEmailItem {
  bidId: number;
  title: string;
  agency: string;
  awardeeName: string;
  amount: number | null;
  awardDate: string | null;
  /** won = awardee UEI is theirs; lost = they bid, someone else won; submitted = they bid, can't tell; saved = only saved it. */
  outcome: "won" | "lost" | "submitted" | "saved";
}

export function awardResultsSubject(items: AwardEmailItem[]): string {
  if (items.some((i) => i.outcome === "won")) return "You won a government contract 🎉 — Contrax";
  if (items.length === 1) return `Award posted: ${items[0].title.slice(0, 80)}`;
  return `${items.length} bids in your pipeline were awarded — Contrax`;
}

export function awardResultsHtml(items: AwardEmailItem[]): string {
  const rows = items
    .map((i) => {
      const amount = formatAwardAmount(i.amount);
      const date = i.awardDate
        ? new Date(`${i.awardDate}T12:00:00Z`).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })
        : null;
      const winner = escapeHtml(displayCompanyName(i.awardeeName));
      const headline =
        i.outcome === "won"
          ? `<strong style="color:#15803d;">You won.</strong> Awarded to ${winner}${amount ? ` for <strong>${amount}</strong>` : ""}.`
          : `Awarded to <strong>${winner}</strong>${amount ? ` for <strong>${amount}</strong>` : ""}.`;
      const note =
        i.outcome === "won"
          ? "Congratulations. Mark it Won in your pipeline so we can track your wins."
          : i.outcome === "lost"
            ? `Not this time. ${amount ? `The winning price, ${amount}, is your benchmark for the next one like it. ` : ""}Log it as a loss to get a short debrief on what to change.`
            : i.outcome === "submitted"
              ? `If that's you, congratulations: mark it Won in your pipeline. If not, ${amount ? `the winning price, ${amount}, is your benchmark for next time, and ` : ""}logging it as a loss gets you a short debrief. Add your UEI in Settings and we'll tell you outright next time.`
            : `${amount ? `${amount} is what this agency paid. ` : ""}A useful benchmark if a bid like this comes up again.`;
      const link =
        i.outcome === "lost" || i.outcome === "submitted"
          ? `<a href="https://www.contrax.company/losses" style="color:#2563eb;font-weight:600;text-decoration:none;">Get a debrief →</a>`
          : `<a href="https://www.contrax.company/pipeline" style="color:#2563eb;font-weight:600;text-decoration:none;">Open my pipeline →</a>`;
      return `
<tr>
  <td style="padding:0 32px 16px;">
    <table role="presentation" cellpadding="0" cellspacing="0" width="100%" style="border:1px solid #e5e7eb;border-radius:8px;">
      <tr>
        <td style="padding:16px 20px;">
          <p style="margin:0 0 4px;color:#111827;font-size:16px;font-weight:600;line-height:1.4;">${escapeHtml(i.title)}</p>
          <p style="margin:0 0 10px;color:#6b7280;font-size:13px;">${escapeHtml(i.agency)}${date ? ` · Awarded ${date}` : ""}</p>
          <p style="margin:0 0 6px;color:#111827;font-size:15px;line-height:1.5;">${headline}</p>
          <p style="margin:0 0 10px;color:#374151;font-size:13px;line-height:1.5;">${escapeHtml(note)}</p>
          ${link}
        </td>
      </tr>
    </table>
  </td>
</tr>`;
    })
    .join("\n");
  return `<!DOCTYPE html>
<html lang="en">
<head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1.0"><title>Award results — Contrax</title></head>
<body style="margin:0;padding:0;background-color:#f4f4f5;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;">
<table role="presentation" cellpadding="0" cellspacing="0" width="100%" style="background-color:#f4f4f5;">
<tr>
  <td align="center" style="padding:40px 16px;">
    <table role="presentation" cellpadding="0" cellspacing="0" width="100%" style="max-width:600px;background:#ffffff;border-radius:12px;overflow:hidden;">
      <tr>
        <td style="background:#0f1f38;padding:28px 32px;text-align:center;">
          <h1 style="margin:0;color:#ffffff;font-size:21px;font-weight:700;">Award results for bids you saved</h1>
        </td>
      </tr>
      <tr>
        <td style="padding:24px 32px 12px;color:#374151;font-size:14px;line-height:1.6;">
          The government posted the award${items.length === 1 ? "" : "s"} below on SAM.gov. Contrax checks every federal bid in your pipeline after its deadline, so you don't have to.
        </td>
      </tr>
      ${rows}
      <tr>
        <td style="background:#f9fafb;padding:20px 32px;text-align:center;border-top:1px solid #e5e7eb;">
          <p style="margin:0 0 4px;color:#9ca3af;font-size:12px;">You get this because these bids are saved in your Contrax pipeline. Remove a bid from your pipeline to stop updates on it.</p>
          <p style="margin:0;color:#9ca3af;font-size:12px;">Contrax LLC · contrax.company</p>
        </td>
      </tr>
    </table>
  </td>
</tr>
</table>
</body>
</html>`;
}

/** Sends the award results email; true only when Resend accepted. Never throws. */
export async function sendAwardResultsEmail(to: string, items: AwardEmailItem[]): Promise<boolean> {
  if (items.length === 0) return false;
  try {
    const resend = getResend();
    if (!resend) {
      console.warn("Cannot send award results — RESEND_API_KEY not set");
      return false;
    }
    const { error } = await resend.emails.send({
      from: "Contrax <hello@contrax.company>",
      replyTo: "contrax.companyllc@gmail.com",
      to: [to],
      subject: awardResultsSubject(items),
      html: awardResultsHtml(items),
    });
    if (error) {
      console.error("Award results email rejected:", error.message);
      return false;
    }
    return true;
  } catch (err) {
    // PII-safe: never log the address.
    console.error("Failed to send award results:", (err as Error).message);
    return false;
  }
}

// ── Founding-member offer line (owner 2026-10-03) ──────────────────────────────
// The free emails pitch Starter at the founding price while spots remain
// (Starter at $9/month for life, first 10 members, src/lib/stripe.ts). The
// caller passes foundingSpotsRemaining(): null (count unavailable) or 0 falls
// back to the regular $19/month line, so a full or unknown offer is never sold.

/** True when the founding price should be shown. */
export function foundingOfferOpen(spots: number | null | undefined): spots is number {
  return typeof spots === "number" && Number.isFinite(spots) && spots > 0;
}

/** "$9/month for life … (3 spots left)" while founding spots remain, else "$19/month". */
export function starterPriceHtml(spots: number | null | undefined): string {
  if (!foundingOfferOpen(spots)) return "$19/month";
  return `<strong>$9/month for life</strong> as one of our first 10 founding members (${spots} spot${spots === 1 ? "" : "s"} left)`;
}

// ── Bid Digest HTML Template ───────────────────────────────────────────────────

/** The free Basic plan's weekly variant: weekly wording, a Starter line and an unsubscribe link. */
export interface WeeklyDigestHtmlOptions {
  unsubscribeUrl: string;
  /** Open bids added in the last 72 hours, still in their paid head start (not listed). */
  headStartCount?: number;
  /** Founding-member spots left (null/0 = show the regular Starter price). */
  foundingSpots?: number | null;
}

/** The paying member's personal daily variant (src/lib/digest-match.ts). */
export interface DailyDigestHtmlOptions {
  /** "janitorial in VA, MD": the profile the list was filtered to. */
  matchLabel?: string;
  /** True when the member has no trade/states set: suggest setting them. */
  setupHint?: boolean;
}

export function bidDigestHtml(
  bids: NewBidSummary[],
  totalNew: number = bids.length,
  weekly: WeeklyDigestHtmlOptions | null = null,
  daily: DailyDigestHtmlOptions | null = null,
): string {
  const moreCount = Math.max(0, totalNew - bids.length);
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
            🆕 ${totalNew} New Bid${totalNew === 1 ? "" : "s"} Found
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
            Contrax found <strong>${totalNew} new government contract${totalNew === 1 ? "" : "s"}</strong> ${weekly ? "this past week" : "since your last digest"}${daily?.matchLabel ? ` that match your profile (${escapeHtml(daily.matchLabel)})` : ""}. ${moreCount > 0 ? `Here are the ${bids.length} closing soonest:` : "Here's what's new:"}
          </p>
        </td>
      </tr>
      <!-- Bid List -->
      <tr>
        <td style="padding:8px 32px 16px;">
          <table role="presentation" cellpadding="0" cellspacing="0" width="100%" style="border:1px solid #e5e7eb;border-radius:8px;overflow:hidden;">
            ${bidRows}
          </table>
          ${moreCount > 0 ? `<p style="margin:12px 0 0;color:#374151;font-size:14px;text-align:center;">+ ${moreCount} more new bid${moreCount === 1 ? "" : "s"} on Contrax.</p>` : ""}
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
      ${daily?.setupHint ? `<!-- Profile hint -->
      <tr>
        <td style="padding:0 32px 24px;text-align:center;">
          <p style="margin:0;color:#374151;font-size:14px;line-height:1.6;">
            This is every new bid nationwide. Add your trade and states and this email will list only the bids that fit you.
            <a href="https://www.contrax.company/settings" style="color:#2563eb;font-weight:600;text-decoration:none;">Set your trade and states →</a>
          </p>
        </td>
      </tr>` : ""}
      ${weekly ? `<!-- Starter -->
      <tr>
        <td style="padding:0 32px 24px;text-align:center;">
          <p style="margin:0;color:#374151;font-size:14px;line-height:1.6;">
            ${weekly.headStartCount ? `<strong>+ ${weekly.headStartCount} newer bid${weekly.headStartCount === 1 ? " was" : "s were"} posted in the last 3 days.</strong> Starter members already have ${weekly.headStartCount === 1 ? "it" : "them"}; free accounts see new bids after a 3-day head start.<br>` : ""}
            You get this once a week on the free Basic plan. <strong>Starter</strong> sends every new bid at 6 AM Eastern, every morning, for ${starterPriceHtml(weekly.foundingSpots)}.
            <a href="https://www.contrax.company/pricing" style="color:#2563eb;font-weight:600;text-decoration:none;">${foundingOfferOpen(weekly.foundingSpots) ? "Claim a founding spot →" : "See Starter →"}</a>
          </p>
        </td>
      </tr>` : ""}
      <!-- Footer -->
      <tr>
        <td style="background:#f9fafb;padding:20px 32px;text-align:center;border-top:1px solid #e5e7eb;">
          <p style="margin:0 0 4px;color:#9ca3af;font-size:12px;">
            Contrax — AI-powered government contract discovery
          </p>
          <p style="margin:0 0 4px;color:#9ca3af;font-size:12px;">
            Contrax LLC · contrax.company
          </p>
          <p style="margin:0;color:#9ca3af;font-size:12px;">
            &copy; ${new Date().getFullYear()} Contrax LLC. All rights reserved.
          </p>
          ${weekly ? `<p style="margin:8px 0 0;color:#9ca3af;font-size:12px;">
            <a href="${escapeHtml(weekly.unsubscribeUrl)}" style="color:#6b7280;">Unsubscribe from the weekly bid email</a>
          </p>` : ""}
        </td>
      </tr>
    </table>
  </td>
</tr>
</table>
</body>
</html>`;
}

// ── Nonprofit Free applicant emails (owner decision 4, phase 2) ────────────────
/**
 * ONE plain email on `approved`, ONE neutral email on `denied`. Nothing is sent on
 * request-info in this unit.
 *
 * Both are transactional answers to an application the recipient submitted, both are
 * fail-open (no RESEND_API_KEY → a warning and `false`, never a thrown error that would
 * change the stored outcome), and both return `true` ONLY when Resend accepted the send
 * — so a caller can log a real send rather than an attempt.
 *
 * The verification sentence is passed in, already built from the IRS mirror's posting
 * date by `verificationWording()`. When it is null (the mirror has never been imported,
 * which is also when nothing can be auto-approved) the line is omitted entirely — a
 * verification badge with no date is never shown.
 */
export async function sendNonprofitApprovedEmail(
  to: string,
  input: { orgName: string; verificationWording: string | null },
): Promise<boolean> {
  try {
    const resend = getResend();
    if (!resend) {
      console.warn("Cannot send nonprofit approval email — RESEND_API_KEY not set");
      return false;
    }
    const wordingLine = input.verificationWording
      ? `<p style="margin:0 0 16px;color:#6b7280;font-size:13px;">${escapeHtml(input.verificationWording)}</p>`
      : "";
    const html = `<body style="margin:0;padding:0;background:#f3f4f6;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Arial,sans-serif;">
<table role="presentation" cellpadding="0" cellspacing="0" width="100%" style="background:#f3f4f6;padding:32px 0;"><tr><td align="center">
<table role="presentation" cellpadding="0" cellspacing="0" width="600" style="max-width:600px;background:#ffffff;border-radius:12px;overflow:hidden;">
  <tr><td style="padding:32px 32px 8px;"><h1 style="margin:0 0 12px;color:#111827;font-size:22px;">Nonprofit Free access is active</h1>
    <p style="margin:0 0 12px;color:#374151;font-size:15px;">We verified ${escapeHtml(input.orgName)} against IRS tax-exempt records, and free government grant search is now active on your account.</p>
    ${wordingLine}
    <p style="margin:0 0 12px;color:#374151;font-size:15px;">You can search federal grants and the state grant sources Contrax covers, open the official application links, and save up to 10 grants. There is no card on file and nothing to renew — basic searching stays free for a verified nonprofit.</p>
  </td></tr>
  <tr><td style="padding:8px 32px 24px;text-align:center;">
    <a href="https://www.contrax.company/grants" style="display:inline-block;background:#2563eb;color:#ffffff;text-decoration:none;padding:12px 32px;border-radius:8px;font-size:15px;font-weight:600;">Open Contrax Grants</a>
  </td></tr>
  <tr><td style="background:#f9fafb;padding:20px 32px;text-align:center;border-top:1px solid #e5e7eb;">
    <p style="margin:0 0 4px;color:#9ca3af;font-size:12px;">Questions? Write to contrax.companyllc@gmail.com.</p>
    <p style="margin:0 0 4px;color:#9ca3af;font-size:12px;">Contrax LLC · contrax.company</p>
    <p style="margin:0;color:#9ca3af;font-size:12px;">&copy; ${new Date().getFullYear()} Contrax LLC</p>
  </td></tr>
</table></td></tr></table></body>`;
    const result = await resend.emails.send({
      from: "Contrax <hello@contrax.company>",
      replyTo: "contrax.companyllc@gmail.com",
      to: [to],
      subject: "Your Contrax nonprofit access is active",
      html,
    });
    return !result.error;
  } catch (error) {
    console.error("Failed to send nonprofit approval email:", error);
    return false;
  }
}

/**
 * The not-granted email. Neutral and non-accusatory by rule (build plan §6): it never
 * uses the deny-lane vocabulary, never states the reason class, and always carries the
 * appeal path.
 */
export async function sendNonprofitDeniedEmail(to: string, orgName: string): Promise<boolean> {
  try {
    const resend = getResend();
    if (!resend) {
      console.warn("Cannot send nonprofit decision email — RESEND_API_KEY not set");
      return false;
    }
    const html = `<body style="margin:0;padding:0;background:#f3f4f6;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Arial,sans-serif;">
<table role="presentation" cellpadding="0" cellspacing="0" width="100%" style="background:#f3f4f6;padding:32px 0;"><tr><td align="center">
<table role="presentation" cellpadding="0" cellspacing="0" width="600" style="max-width:600px;background:#ffffff;border-radius:12px;overflow:hidden;">
  <tr><td style="padding:32px 32px 24px;">
    <h1 style="margin:0 0 12px;color:#111827;font-size:22px;">About your Nonprofit Free application</h1>
    <p style="margin:0 0 12px;color:#374151;font-size:15px;">We reviewed the application for ${escapeHtml(orgName)} and could not verify it against IRS tax-exempt records, so free nonprofit access was not granted.</p>
    <p style="margin:0 0 12px;color:#374151;font-size:15px;">If you believe this is a mistake, write to contrax.companyllc@gmail.com and we will take another look — many organizations are simply not in the IRS records yet, and we can review supporting documentation.</p>
    <p style="margin:0;color:#6b7280;font-size:13px;">Your Contrax account is unchanged, and anything you had saved is still there.</p>
  </td></tr>
  <tr><td style="background:#f9fafb;padding:20px 32px;text-align:center;border-top:1px solid #e5e7eb;">
    <p style="margin:0 0 4px;color:#9ca3af;font-size:12px;">Contrax LLC · contrax.company</p>
    <p style="margin:0;color:#9ca3af;font-size:12px;">&copy; ${new Date().getFullYear()} Contrax LLC</p>
  </td></tr>
</table></td></tr></table></body>`;
    const result = await resend.emails.send({
      from: "Contrax <hello@contrax.company>",
      replyTo: "contrax.companyllc@gmail.com",
      to: [to],
      subject: "Your Contrax nonprofit application",
      html,
    });
    return !result.error;
  } catch (error) {
    console.error("Failed to send nonprofit decision email:", error);
    return false;
  }
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
