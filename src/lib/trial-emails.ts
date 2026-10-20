/**
 * Trial-ending emails (owner 2026-10-19). PURE (no DB, no server imports) so
 * the daily job and tests share one rule.
 *
 * Two emails per trial, at most once each:
 *   - "reminder": 1–2 days before the 7-day trial ends.
 *   - "ended":    within 3 days after it ends without payment. Older endings
 *                 are skipped, so trials that ran out before this shipped are
 *                 never emailed out of the blue.
 * Never to admins, paying members, access-grant accounts or accounts that
 * never had a trial. Every number in the email is the member's own count;
 * a zero count is left out rather than shown.
 */
import { DIGEST_TRIAL_DAYS } from "~/lib/digest-recipients";

const DAY_MS = 24 * 60 * 60 * 1000;
export const REMINDER_DAYS_BEFORE_END = 2;
export const ENDED_EMAIL_WINDOW_DAYS = 3;

export type TrialEmailStage = "reminder" | "ended";

export interface TrialEmailRow {
  is_admin?: boolean | null;
  trial_started_at: string | Date | null;
  subscription_status: string | null;
  access_expires_at?: string | Date | null;
  trial_reminder_sent_at?: string | Date | null;
  trial_ended_sent_at?: string | Date | null;
}

function time(value: string | Date | null | undefined): number | null {
  if (!value) return null;
  const t = new Date(value).getTime();
  return Number.isNaN(t) ? null : t;
}

export function trialEndsAt(row: Pick<TrialEmailRow, "trial_started_at">): number | null {
  const started = time(row.trial_started_at);
  return started === null ? null : started + DIGEST_TRIAL_DAYS * DAY_MS;
}

/** Which trial email (if any) this member should get now. */
export function trialEmailStage(row: TrialEmailRow, now: number = Date.now()): TrialEmailStage | null {
  if (row.is_admin) return null;
  if (row.subscription_status === "active") return null;
  if (time(row.access_expires_at) !== null) return null;
  const ends = trialEndsAt(row);
  if (ends === null) return null;
  if (now < ends) {
    if (ends - now <= REMINDER_DAYS_BEFORE_END * DAY_MS && !row.trial_reminder_sent_at) return "reminder";
    return null;
  }
  if (now - ends <= ENDED_EMAIL_WINDOW_DAYS * DAY_MS && !row.trial_ended_sent_at) return "ended";
  return null;
}

export interface TrialRecap {
  /** Open bids matching the member's trade/states (0 when no profile is set). */
  openMatches: number;
  /** Of those, how many close in the next 7 days. */
  closingThisWeek: number;
  /** Bids the member saved. */
  saved: number;
  /** Saved bids still open that close in the next 10 days. */
  savedClosingSoon: number;
  /** e.g. "janitorial in Virginia", or null when the profile has no trade/states. */
  matchLabel: string | null;
}

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
}

const plural = (n: number, one: string, many = `${one}s`) => `${n.toLocaleString("en-US")} ${n === 1 ? one : many}`;

/** The member's own numbers as sentences; zero counts are left out. */
export function recapLines(r: TrialRecap): string[] {
  const lines: string[] = [];
  if (r.openMatches > 0) {
    const where = r.matchLabel ? ` for ${r.matchLabel}` : "";
    const soon = r.closingThisWeek > 0 ? `, and ${plural(r.closingThisWeek, "closes", "close")} this week` : "";
    lines.push(`Contrax has ${plural(r.openMatches, "open bid")}${where} right now${soon}.`);
  }
  if (r.saved > 0) {
    const soon = r.savedClosingSoon > 0 ? `, and ${plural(r.savedClosingSoon, "closes", "close")} in the next 10 days` : "";
    lines.push(`You saved ${plural(r.saved, "bid")}${soon}.`);
  }
  return lines;
}

export function trialEmailContent(stage: TrialEmailStage, r: TrialRecap): { subject: string; html: string; text: string } {
  const lines = recapLines(r);
  const subject =
    stage === "reminder" ? "Your Contrax trial ends soon" : "Your Contrax trial ended: your daily bid email is paused";
  const intro =
    stage === "reminder"
      ? "Your 7-day Professional trial ends in the next 2 days. Here's where things stand:"
      : "Your 7-day trial ended, so your account is now on free Basic. Search still works, but your daily bid email is paused and you can keep only 1 saved bid.";
  const close =
    stage === "reminder"
      ? "Keep the daily bid email, every state and trade, unlimited saved bids and who to contact on federal bids with Starter for $19/month. Cancel anytime."
      : "Starter brings back the daily bid email, every state and trade, unlimited saved bids and who to contact on federal bids for $19/month. Cancel anytime.";
  const cta = stage === "reminder" ? "Keep my bids coming" : "Pick up where I left off";
  const url = "https://www.contrax.company/upgrade?utm_source=email&utm_campaign=trial_" + stage;
  const list = lines.length ? `<ul style="margin:0 0 16px;padding-left:20px;color:#111827;font-size:15px;line-height:1.6;">${lines.map((l) => `<li>${escapeHtml(l)}</li>`).join("")}</ul>` : "";
  const html = `<!DOCTYPE html>
<html lang="en"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1.0"><title>${escapeHtml(subject)}</title></head>
<body style="margin:0;padding:0;background-color:#f4f4f5;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;">
  <table role="presentation" cellpadding="0" cellspacing="0" width="100%" style="background-color:#f4f4f5;"><tr><td align="center" style="padding:32px 16px;">
    <table role="presentation" cellpadding="0" cellspacing="0" width="100%" style="max-width:560px;background:#ffffff;border-radius:12px;overflow:hidden;">
      <tr><td style="background:#102342;padding:24px 32px;color:#ffffff;"><h1 style="margin:0;font-size:22px;">Contrax</h1></td></tr>
      <tr><td style="padding:28px 32px;">
        <p style="margin:0 0 16px;color:#4b5563;font-size:15px;line-height:1.6;">${escapeHtml(intro)}</p>
        ${list}
        <p style="margin:0 0 20px;color:#4b5563;font-size:15px;line-height:1.6;">${escapeHtml(close)}</p>
        <p style="margin:0;"><a href="${url}" style="display:inline-block;background:#1d4ed8;color:#ffffff;text-decoration:none;padding:12px 22px;border-radius:10px;font-weight:700;font-size:15px;">${escapeHtml(cta)} →</a></p>
      </td></tr>
      <tr><td style="padding:16px 32px 24px;border-top:1px solid #e5e7eb;color:#6b7280;font-size:12px;line-height:1.5;">
        You're getting this account notice because you started a Contrax trial. We send at most two about your trial. Questions? Reply to this email.
      </td></tr>
    </table>
  </td></tr></table>
</body></html>`;
  const text = [intro, ...lines.map((l) => `- ${l}`), close, `${cta}: ${url}`].join("\n\n");
  return { subject, html, text };
}
