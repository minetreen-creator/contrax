/**
 * Starter 30-day pass (owner 2026-10-30: "do 2, 3 and 4"). Buyers backed out
 * of a "$5, then $19.00 per month" subscription checkout, so the $5 is now a
 * one-time payment for 30 days of Starter with NO automatic renewal. Five days
 * before the end the buyer gets one email asking whether to continue at
 * $19/month; doing nothing charges nothing and the account returns to free
 * Basic (never locked out).
 *
 * PURE and client-safe: the rules and the copy. Stripe and the database live in
 * stripe.ts and starter-pass.server.ts.
 */

export const STARTER_PASS_DAYS = 30;
/** $5, in cents. */
export const STARTER_PASS_AMOUNT = 500;
/** The reminder goes out this many days before the pass ends (day 25). */
export const STARTER_PASS_REMIND_DAYS = 5;
/** Stripe session/user metadata flag for a pass checkout. */
export const STARTER_PASS_FLAG = "starter_pass";
/** users.subscription_status once a pass has run out without a subscription. */
export const PASS_ENDED_STATUS = "pass_ended";

const DAY_MS = 24 * 60 * 60 * 1000;

/** What the Stripe page shows as the product line. */
export const STARTER_PASS_PRODUCT_NAME = "Contrax Starter: 30 days of bid emails";
export const STARTER_PASS_PRODUCT_DESCRIPTION =
  "New government bids in your trade and states, emailed every morning at 6 AM. One-time $5. No automatic renewal: we ask before charging you again.";

/** Shown under Stripe's pay button on every plan checkout (owner item 3). */
export const CHECKOUT_SUBMIT_MESSAGE =
  "Pick your trade and states on the next screen and your first bid email arrives the next morning at 6 AM. Questions? Reply to any Contrax email and Nathaniel answers.";

/** Short line under the Starter price on /pricing and /upgrade. */
export const STARTER_PASS_NOTE = "$5 for your first 30 days. No automatic renewal: we'll ask before charging $19/month.";

export type StarterCheckoutKind = "pass" | "subscription" | "subscription_full_price";

/**
 * Which monthly Starter checkout a buyer gets. A first-time buyer (signed out,
 * or signed in and not paying) gets the $5 pass. Someone who already bought a
 * pass continues at the full $19 a month (no second $5 month). A paying
 * account keeps the existing subscription checkout.
 */
export function starterCheckoutKind(account: {
  signedIn: boolean;
  subscriptionStatus?: string | null;
  passBoughtAt?: string | Date | null;
}): StarterCheckoutKind {
  if (!account.signedIn) return "pass";
  if (account.passBoughtAt) return "subscription_full_price";
  if (account.subscriptionStatus === "active") return "subscription";
  return "pass";
}

/** Only a plain monthly Starter checkout can become a pass (no promo, founding or yearly). PURE. */
export function starterPassEligibleRequest(body: {
  planTier?: string;
  mode?: string;
  interval?: string;
  promoCode?: string;
  founding?: boolean;
}): boolean {
  return (
    body.planTier === "starter" &&
    (body.mode ?? "subscription") === "subscription" &&
    body.interval !== "year" &&
    !(body.promoCode ?? "").trim() &&
    !body.founding
  );
}

/** When a pass bought at `createdSec` (Stripe's epoch seconds) ends. PURE. */
export function starterPassEndsAt(createdSec: number): Date {
  return new Date(createdSec * 1000 + STARTER_PASS_DAYS * DAY_MS);
}

/** "November 29" in Eastern time. PURE. */
export function passEndDateLabel(endsAt: Date): string {
  return endsAt.toLocaleDateString("en-US", { month: "long", day: "numeric", timeZone: "America/New_York" });
}

export const PASS_RENEW_URL = "https://www.contrax.company/upgrade?plan=starter&source=pass_reminder";

function esc(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

/** The one reminder email, five days before the pass ends. PURE. */
export function passReminderEmail(endsAt: Date): { subject: string; text: string; html: string } {
  const day = passEndDateLabel(endsAt);
  const subject = `Your Contrax bid emails stop on ${day}`;
  const lines = [
    `Your 30 days of Contrax Starter end on ${day}.`,
    "Want to keep the 6 AM bid emails coming? Starter is $19 a month, and you can cancel anytime with one click.",
    `Keep my bid emails: ${PASS_RENEW_URL}`,
    "If you do nothing, you won't be charged. Your account simply goes back to free Basic.",
    "Questions? Just reply to this email.",
    "Nathaniel Minetree, Contrax",
  ];
  const html = `<div style="font-family:Arial,Helvetica,sans-serif;font-size:16px;line-height:1.5;color:#0f172a;max-width:560px">
<p>Your 30 days of Contrax Starter end on <b>${esc(day)}</b>.</p>
<p>Want to keep the 6 AM bid emails coming? Starter is $19 a month, and you can cancel anytime with one click.</p>
<p><a href="${PASS_RENEW_URL}" style="display:inline-block;background:#f59e0b;color:#ffffff;text-decoration:none;font-weight:bold;padding:12px 20px;border-radius:10px">Keep my bid emails</a></p>
<p>If you do nothing, you won't be charged. Your account simply goes back to free Basic.</p>
<p>Questions? Just reply to this email.</p>
<p>Nathaniel Minetree, Contrax</p>
</div>`;
  return { subject, text: lines.join("\n\n"), html };
}
