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
  "New government bids in your trade and states, emailed every morning at 6 AM, for 30 days. One-time $5 payment. Nothing renews: on day 30 the pass ends unless you choose Starter at $14/month.";

/** Shown under Stripe's pay button on every plan checkout (owner item 3). */
export const CHECKOUT_SUBMIT_MESSAGE =
  "Pick your trade and states on the next screen and your first bid email arrives the next morning at 6 AM. Questions? Reply to any Contrax email and Nathaniel answers.";

/**
 * The offer, said one way everywhere (owner 2026-11-09, "Priority 1 — fix the customer journey"):
 * searching is free, a Basic account is free, and the $5 Starter pass is a one-time payment for 30
 * days that ENDS ON ITS OWN. Nothing renews and nothing is charged unless the buyer chooses Starter
 * at $19/month. There is no trial. "We'll ask before charging $19/month" read as a charge that would
 * come unless they said no, so it is gone.
 */
export const STARTER_PASS_NOTE = "$5 one time for 30 days. Nothing renews: on day 30 the pass simply ends, unless you choose Starter at $14/month.";
/** What happens on day 30, in full. */
export const STARTER_DAY30_LINE =
  "On day 30 your pass ends and your account goes back to free Basic. We never charge your card again on our own: five days before, we email you once, and Starter at $14/month starts only if you choose it.";
/** Under Stripe's pay button on the $5 pass checkout. */
export const STARTER_PASS_SUBMIT_MESSAGE =
  "One-time $5. Nothing renews, and you won't be charged again unless you choose to keep going. Pick your trade and states on the next screen; your first bid email arrives the next morning at 6 AM.";

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
/** Owner 2026-11-04: the renewal reminder asks for a success story. */
export const SHARE_STORY_URL = "https://www.contrax.company/share-your-story";

function esc(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

/** What the pass found for this buyer (owner 2026-11-07: the renewal email shows it). */
export interface PassRecap {
  /** When the pass started. */
  since: Date;
  /** New bids matched to the buyer's trade and states since then that are still open. */
  newMatches: number;
  /** Up to three of them, newest first. */
  examples: { id: number; title: string; agency: string | null; dueDate: string | null }[];
  /** "Construction in Tennessee", "your trade"… */
  tradePlace: string;
}

/** "Dec 3" in Eastern time, or null. PURE. */
function shortDue(iso: string | null): string | null {
  if (!iso) return null;
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? null : d.toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "America/New_York" });
}

/** "Construction in Tennessee" → "construction in Tennessee"; "IT Services" stays. PURE. */
const lowerFirst = (s: string) => (/^[A-Z][a-z]/.test(s) ? s[0].toLowerCase() + s.slice(1) : s);

const BID_URL = (id: number) => `https://www.contrax.company/bid/${id}?source=pass_reminder`;

/**
 * The one reminder email, five days before the pass ends. PURE.
 * Owner 2026-11-07 ("2 only"): when the pass matched open bids, the email leads
 * with them (count plus three of the newest) and the button opens the $19/month
 * checkout in one click (`renewUrl`, a signed link). Nothing is charged unless
 * the buyer completes that checkout.
 */
export function passReminderEmail(
  endsAt: Date,
  opts: { recap?: PassRecap | null; renewUrl?: string } = {},
): { subject: string; text: string; html: string } {
  const day = passEndDateLabel(endsAt);
  const renew = opts.renewUrl || PASS_RENEW_URL;
  const recap = opts.recap && opts.recap.newMatches > 0 ? opts.recap : null;
  const n = recap?.newMatches ?? 0;
  const bidsWord = n === 1 ? "bid" : "bids";
  const subject = recap
    ? `Your Contrax pass found ${n.toLocaleString("en-US")} open ${bidsWord}. It ends ${day}`
    : `Your Contrax bid emails stop on ${day}`;
  const started = recap ? passEndDateLabel(recap.since) : "";
  const intro = recap
    ? `Since your pass started on ${started}, Contrax has matched ${n.toLocaleString("en-US")} new ${bidsWord} for ${lowerFirst(recap.tradePlace)} that ${n === 1 ? "is" : "are"} still open.`
    : null;
  const examples = recap?.examples.slice(0, 3) ?? [];
  const exampleLine = (b: PassRecap["examples"][number]) =>
    [b.title, b.agency, shortDue(b.dueDate) ? `due ${shortDue(b.dueDate)}` : null].filter(Boolean).join(" · ");
  const keep = "Want to keep the 6 AM bid emails coming? Starter is $14 a month, and you can cancel anytime with one click.";

  const lines = [
    ...(intro ? [intro] : []),
    ...(examples.length ? [`${examples.length === 1 ? "The newest" : `${examples.length} of the newest`}:`, ...examples.map((b) => `- ${exampleLine(b)}: ${BID_URL(b.id)}`)] : []),
    `Your 30 days of Contrax Starter end on ${day}.`,
    keep,
    `Keep my bid emails ($14/month): ${renew}`,
    "If you do nothing, you won't be charged. Your account simply goes back to free Basic.",
    "Questions? Just reply to this email.",
    // Owner 2026-11-04: Share Your Success.
    `Did Contrax help you find work? I'd love to hear about it: ${SHARE_STORY_URL}`,
    "Nathaniel Minetree, Contrax",
  ];
  const exampleHtml = examples.length
    ? `<p style="margin-bottom:4px">${examples.length === 1 ? "The newest" : `${examples.length} of the newest`}:</p>
<ul style="margin-top:0;padding-left:20px">${examples
        .map((b) => {
          const meta = [b.agency, shortDue(b.dueDate) ? `due ${shortDue(b.dueDate)}` : null].filter(Boolean).join(" · ");
          return `<li style="margin-bottom:6px"><a href="${BID_URL(b.id)}" style="color:#1d4ed8;font-weight:bold">${esc(b.title)}</a>${meta ? `<br><span style="color:#475569;font-size:14px">${esc(meta)}</span>` : ""}</li>`;
        })
        .join("")}</ul>`
    : "";
  const html = `<div style="font-family:Arial,Helvetica,sans-serif;font-size:16px;line-height:1.5;color:#0f172a;max-width:560px">
${intro ? `<p>${esc(intro)}</p>\n` : ""}${exampleHtml}
<p>Your 30 days of Contrax Starter end on <b>${esc(day)}</b>.</p>
<p>${keep}</p>
<p><a href="${renew}" style="display:inline-block;background:#f59e0b;color:#ffffff;text-decoration:none;font-weight:bold;padding:12px 20px;border-radius:10px">Keep my bid emails ($14/month)</a></p>
<p>If you do nothing, you won't be charged. Your account simply goes back to free Basic.</p>
<p>Questions? Just reply to this email.</p>
<p>Did Contrax help you find work? <a href="${SHARE_STORY_URL}">I'd love to hear about it.</a></p>
<p>Nathaniel Minetree, Contrax</p>
</div>`;
  return { subject, text: lines.join("\n\n"), html };
}

/**
 * The buyer's confirmation, sent once right after the $5 pass is bought (owner 2026-11-09): the end
 * date in writing and that nothing renews, so no one wonders whether they must cancel. PURE.
 */
export function passConfirmationEmail(endsAt: Date): { subject: string; text: string; html: string } {
  const day = passEndDateLabel(endsAt);
  const subject = `Your Contrax Starter pass: 30 days, ends ${day}. Nothing renews`;
  const lines = [
    "Thanks for buying the Contrax Starter pass.",
    `You paid $5 one time. Your pass runs until ${day}.`,
    `Nothing renews. On ${day} your pass simply ends and your account goes back to free Basic. You will not be charged again, and there is nothing to cancel.`,
    "Five days before the end, we'll email you once. If you want to keep the 6 AM bid emails, you can choose Starter at $14/month then. If you do nothing, nothing happens.",
    "Pick your trade and states at https://www.contrax.company/settings and your bid email arrives every morning at 6 AM.",
    "Questions? Just reply to this email.",
    "Nathaniel Minetree, Contrax",
  ];
  const html = `<div style="font-family:Arial,Helvetica,sans-serif;font-size:16px;line-height:1.5;color:#0f172a;max-width:560px">
<p>Thanks for buying the Contrax Starter pass.</p>
<p>You paid <b>$5 one time</b>. Your pass runs until <b>${esc(day)}</b>.</p>
<p><b>Nothing renews.</b> On ${esc(day)} your pass simply ends and your account goes back to free Basic. You will not be charged again, and there is nothing to cancel.</p>
<p>Five days before the end, we'll email you once. If you want to keep the 6 AM bid emails, you can choose Starter at $14/month then. If you do nothing, nothing happens.</p>
<p><a href="https://www.contrax.company/settings" style="color:#1d4ed8;font-weight:bold">Pick your trade and states</a> and your bid email arrives every morning at 6 AM.</p>
<p>Questions? Just reply to this email.</p>
<p>Nathaniel Minetree, Contrax</p>
</div>`;
  return { subject, text: lines.join("\n\n"), html };
}

/**
 * The owner's alert when someone buys a pass (owner 2026-10-31: "Can I be
 * notified of signups for that plan?"): a phone push and an email. PURE.
 */
export function passBoughtOwnerAlert(buyerEmail: string | null, endsAt: Date): {
  subject: string;
  text: string;
  push: { title: string; body: string; tag: string; url: string };
} {
  const who = buyerEmail?.trim() || "(no email on the checkout)";
  const ends = passEndDateLabel(endsAt);
  return {
    subject: `💰 New $5 Starter pass: ${who}`,
    text: [
      "Someone just bought the $5 Starter 30-day pass.",
      `Buyer: ${who}`,
      `Pass ends: ${ends}. They get one reminder 5 days before, asking whether to continue at $14/month.`,
      "Live view: https://www.contrax.company/admin/live",
    ].join("\n\n"),
    push: {
      title: "💰 New $5 Starter pass",
      body: `${who} just bought 30 days of Starter (ends ${ends}).`,
      tag: `pass-${who}`.slice(0, 64),
      url: "/admin/live",
    },
  };
}
