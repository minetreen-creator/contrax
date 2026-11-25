/**
 * Starter 30-day pass (owner 2026-10-30: "do 2, 3 and 4"). Buyers backed out
 * of a "$5, then $19.00 per month" subscription checkout, so the $5 is now a
 * one-time payment for 30 days of Starter with NO automatic renewal. Five days
 * before the end the buyer gets one email asking whether to continue at
 * $19/month; doing nothing charges nothing and the account returns to free
 * Basic (never locked out).
 *
 * Owner 2026-11-22 ("maybe we should make the $9 recurring", then "1" for "$9 a month, automatic,
 * cancel anytime"): a NEW buyer now starts Starter at $9 a month, charged each month until they
 * cancel. It is one price with no jump (the October checkout that buyers left was "$5, then $19").
 * The checkout, the receipt and every offer line say that it renews, and a reminder goes out three
 * days before each charge. People who bought the one-time pass before this keep it exactly as sold:
 * it ends on its own, and if they choose to continue they pay the same $9 a month.
 *
 * PURE and client-safe: the rules and the copy. Stripe and the database live in
 * stripe.ts and starter-pass.server.ts.
 */

export const STARTER_PASS_DAYS = 30;
/** $5, in cents. */
export const STARTER_PASS_AMOUNT = 900;
/** The reminder goes out this many days before the pass ends (day 25). */
export const STARTER_PASS_REMIND_DAYS = 5;
/**
 * What a pass buyer pays to keep going (owner 2026-11-22: "we need to make the $9 pass not just a
 * one time offer"). A pass sold before 2026-11-22 stays one $9 payment and nothing renews by
 * itself; a holder who chooses to continue pays the same $9 a month a new buyer pays (it was $14
 * for one day, until new buyers moved to $9 a month).
 */
export const STARTER_PASS_CONTINUE_CENTS = 900;
/**
 * 30-day passes were sold until this moment (2026-11-22, 10:19 AM Eastern); every Starter sale after
 * it is $9 a month from the start. Both kinds set starter_pass_bought_at, so this is what tells a
 * pass holder who went on to a subscription (a renewal) from someone who subscribed outright.
 */
export const STARTER_PASS_SOLD_UNTIL = "2026-11-22T15:00:00Z";
/** True when the purchase was a 30-day pass. PURE. */
export function wasStarterPass(boughtAt: string | Date | null | undefined): boolean {
  if (!boughtAt) return false;
  const t = new Date(boughtAt).getTime();
  return Number.isFinite(t) && t < new Date(STARTER_PASS_SOLD_UNTIL).getTime();
}
export const STARTER_PASS_CONTINUE_PRICE = STARTER_PASS_CONTINUE_CENTS / 100;
/** Stripe will not start a subscription's first charge less than 48 hours out; we leave a margin. */
export const PASS_CONTINUE_MIN_LEAD_SECONDS = 49 * 3600;

/**
 * When the first monthly charge should fall for a pass buyer who switches on the monthly plan: the day
 * the pass ends, so no day is paid for twice. null when the pass has ended or ends too soon for
 * Stripe to schedule it, in which case the month starts (and is charged) right away. PURE.
 */
export function passContinueTrialEnd(passEndsAt: Date | string | null | undefined, nowMs: number = Date.now()): number | null {
  if (!passEndsAt) return null;
  const end = Math.floor(new Date(passEndsAt).getTime() / 1000);
  if (!Number.isFinite(end)) return null;
  return end - Math.floor(nowMs / 1000) >= PASS_CONTINUE_MIN_LEAD_SECONDS ? end : null;
}

/** Under Stripe's button when a pass buyer switches on the monthly plan. */
export function passContinueSubmitMessage(firstChargeOn: string | null): string {
  return firstChargeOn
    ? `No charge today. Your pass runs to ${firstChargeOn}; on that day Starter continues at $${STARTER_PASS_CONTINUE_PRICE} a month. Cancel anytime with one click and you are not charged.`
    : `Starter continues at $${STARTER_PASS_CONTINUE_PRICE} a month from today. Cancel anytime with one click.`;
}

/** The offer shown right after a pass is bought and in the buyer's emails. */
export const PASS_CONTINUE_OFFER_HEAD = `Want it to keep going after day 30? Starter is $${STARTER_PASS_CONTINUE_PRICE} a month.`;
export const PASS_CONTINUE_OFFER_BODY = "Switch it on now and nothing is charged today. The first monthly charge is the day your pass ends, and you can cancel before then with one click.";
export const PASS_CONTINUE_BUTTON = `Keep it going for $${STARTER_PASS_CONTINUE_PRICE} a month →`;
/** Stripe session/subscription metadata flag for the $9 a month Starter checkout (owner 2026-11-22). */
export const STARTER_MONTHLY_FLAG = "starter_monthly";
/** The reminder goes out this many days before each monthly charge. */
export const RENEWAL_REMIND_DAYS = 3;
/** Where a subscriber cancels: Settings opens Stripe's own page (Manage subscription). */
export const STARTER_CANCEL_URL = "https://www.contrax.company/settings";
/** Stripe session/user metadata flag for a one-time pass checkout (sold until 2026-11-22). */
export const STARTER_PASS_FLAG = "starter_pass";
/** users.subscription_status once a pass has run out without a subscription. */
export const PASS_ENDED_STATUS = "pass_ended";

const DAY_MS = 24 * 60 * 60 * 1000;

/** What the Stripe page shows as the product line. */
export const STARTER_PASS_PRODUCT_NAME = "Contrax Starter";
export const STARTER_PASS_PRODUCT_DESCRIPTION =
  "New government bids in your trade and states, emailed every morning at 6 AM. $9 a month, charged each month until you cancel. Cancel anytime in Settings.";

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
export const STARTER_PASS_NOTE = "$9 a month. Renews each month until you cancel, and you can cancel anytime in Settings.";
/**
 * The price next to what the alternatives cost (owner 2026-11-17: "anchor the $9 price against ...
 * paying thousands for legacy platforms"). Both figures are the entry prices on /compare, each taken
 * from that company's own page: HigherGov $500 a year, GovTribe $1,900 a year for one seat.
 */
export const STARTER_PASS_ANCHOR = "Other bid tools cost $500 to $1,900 a year. This is $9 a month, and one job found pays for it many times over.";
/** What happens on day 30, in full. */
export const STARTER_DAY30_LINE =
  "Your card is charged $9 today and $9 each month after that. Three days before each charge we email you a reminder, and you can cancel anytime in Settings: your account then goes back to free Basic at the end of the month you paid for.";
/** Under Stripe's pay button on the $5 pass checkout. */
export const STARTER_PASS_SUBMIT_MESSAGE =
  "$9 today, then $9 each month until you cancel. Cancel anytime in Settings and you are not charged again. Pick your trade and states on the next screen; your first bid email arrives the next morning at 6 AM.";

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

/** The next monthly charge for a subscription started at `createdSec`: the same day next month, as Stripe bills it. PURE. */
export function starterNextChargeAt(createdSec: number): Date {
  const d = new Date(createdSec * 1000);
  const day = d.getUTCDate();
  const next = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 1, d.getUTCHours(), d.getUTCMinutes(), d.getUTCSeconds()));
  const lastDay = new Date(Date.UTC(next.getUTCFullYear(), next.getUTCMonth() + 1, 0)).getUTCDate();
  next.setUTCDate(Math.min(day, lastDay));
  return next;
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
  const keep = "Want to keep the 6 AM bid emails coming? Starter is $9 a month, and you can cancel anytime with one click.";

  const lines = [
    ...(intro ? [intro] : []),
    ...(examples.length ? [`${examples.length === 1 ? "The newest" : `${examples.length} of the newest`}:`, ...examples.map((b) => `- ${exampleLine(b)}: ${BID_URL(b.id)}`)] : []),
    `Your 30 days of Contrax Starter end on ${day}.`,
    keep,
    `Keep my bid emails ($9/month): ${renew}`,
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
<p><a href="${renew}" style="display:inline-block;background:#f59e0b;color:#ffffff;text-decoration:none;font-weight:bold;padding:12px 20px;border-radius:10px">Keep my bid emails ($9/month)</a></p>
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
export function passConfirmationEmail(endsAt: Date, opts: { continueUrl?: string } = {}): { subject: string; text: string; html: string } {
  const day = passEndDateLabel(endsAt);
  const subject = `Your Contrax Starter pass: 30 days, ends ${day}. Nothing renews`;
  const lines = [
    "Thanks for buying the Contrax Starter pass.",
    `You paid $9 one time. Your pass runs until ${day}.`,
    `Nothing renews. On ${day} your pass simply ends and your account goes back to free Basic. You will not be charged again, and there is nothing to cancel.`,
    "Five days before the end, we'll email you once. If you want to keep the 6 AM bid emails, you can choose Starter at $9/month then. If you do nothing, nothing happens.",
    ...(opts.continueUrl ? [`${PASS_CONTINUE_OFFER_HEAD} ${PASS_CONTINUE_OFFER_BODY} ${opts.continueUrl}`] : []),
    "Pick your trade and states at https://www.contrax.company/settings and your bid email arrives every morning at 6 AM.",
    "Questions? Just reply to this email.",
    "Nathaniel Minetree, Contrax",
  ];
  const html = `<div style="font-family:Arial,Helvetica,sans-serif;font-size:16px;line-height:1.5;color:#0f172a;max-width:560px">
<p>Thanks for buying the Contrax Starter pass.</p>
<p>You paid <b>$9 one time</b>. Your pass runs until <b>${esc(day)}</b>.</p>
<p><b>Nothing renews.</b> On ${esc(day)} your pass simply ends and your account goes back to free Basic. You will not be charged again, and there is nothing to cancel.</p>
<p>Five days before the end, we'll email you once. If you want to keep the 6 AM bid emails, you can choose Starter at $9/month then. If you do nothing, nothing happens.</p>
${opts.continueUrl ? `<p><b>${esc(PASS_CONTINUE_OFFER_HEAD)}</b> ${esc(PASS_CONTINUE_OFFER_BODY)}<br><a href="${opts.continueUrl}" style="color:#1d4ed8;font-weight:bold">${esc(PASS_CONTINUE_BUTTON)}</a></p>\n` : ""}<p><a href="https://www.contrax.company/settings" style="color:#1d4ed8;font-weight:bold">Pick your trade and states</a> and your bid email arrives every morning at 6 AM.</p>
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
    subject: `💰 New $9 Starter pass: ${who}`,
    text: [
      "Someone just bought the $9 Starter 30-day pass.",
      `Buyer: ${who}`,
      `Pass ends: ${ends}. They get one reminder 5 days before, asking whether to continue at $9/month.`,
      "Live view: https://www.contrax.company/admin/live",
    ].join("\n\n"),
    push: {
      title: "💰 New $9 Starter pass",
      body: `${who} just bought 30 days of Starter (ends ${ends}).`,
      tag: `pass-${who}`.slice(0, 64),
      url: "/admin/live",
    },
  };
}

/** "$9" from 900. PURE. */
function dollars(cents: number): string {
  return cents % 100 === 0 ? `$${cents / 100}` : `$${(cents / 100).toFixed(2)}`;
}

/**
 * The buyer's confirmation for Starter at $9 a month (owner 2026-11-22): what was charged, that it
 * renews, the next charge date, and how to cancel, in writing. PURE.
 */
export function starterMonthlyConfirmationEmail(nextChargeAt: Date): { subject: string; text: string; html: string } {
  const day = passEndDateLabel(nextChargeAt);
  const price = dollars(STARTER_PASS_AMOUNT);
  const subject = `Your Contrax Starter plan: ${price} a month, next charge ${day}`;
  const paid = `You paid ${price} today. Starter renews at ${price} each month until you cancel, and the next charge is on ${day}.`;
  const cancel = `You can cancel anytime in Settings (Manage subscription). If you cancel, you are not charged again and you keep Starter until the end of the month you paid for.`;
  const remind = `We email you a reminder ${RENEWAL_REMIND_DAYS} days before each charge.`;
  const lines = [
    "Thanks for starting Contrax Starter.",
    paid,
    `${cancel} ${STARTER_CANCEL_URL}`,
    remind,
    "Pick your trade and states at https://www.contrax.company/settings and your bid email arrives every morning at 6 AM.",
    "Questions? Just reply to this email.",
    "Nathaniel Minetree, Contrax",
  ];
  const html = `<div style="font-family:Arial,Helvetica,sans-serif;font-size:16px;line-height:1.5;color:#0f172a;max-width:560px">
<p>Thanks for starting Contrax Starter.</p>
<p>You paid <b>${price} today</b>. Starter renews at <b>${price} each month</b> until you cancel, and the next charge is on <b>${esc(day)}</b>.</p>
<p>${cancel} <a href="${STARTER_CANCEL_URL}" style="color:#1d4ed8;font-weight:bold">Open Settings</a></p>
<p>${remind}</p>
<p><a href="https://www.contrax.company/settings" style="color:#1d4ed8;font-weight:bold">Pick your trade and states</a> and your bid email arrives every morning at 6 AM.</p>
<p>Questions? Just reply to this email.</p>
<p>Nathaniel Minetree, Contrax</p>
</div>`;
  return { subject, text: lines.join("\n\n"), html };
}

/** The reminder sent before each monthly charge: the amount, the date and how to cancel. PURE. */
export function renewalReminderEmail(chargeAt: Date, amountCents: number): { subject: string; text: string; html: string } {
  const day = passEndDateLabel(chargeAt);
  const price = dollars(amountCents);
  const subject = `Your Contrax Starter plan renews on ${day} (${price})`;
  const what = `Your Contrax Starter plan renews on ${day}. Your card will be charged ${price} for the next month.`;
  const keep = "To keep your 6 AM bid emails, do nothing.";
  const cancel = "To cancel, open Settings and choose Manage subscription before that date. You are not charged again and you keep Starter until the end of the month you paid for.";
  const lines = [what, keep, `${cancel} ${STARTER_CANCEL_URL}`, "Questions? Just reply to this email.", "Nathaniel Minetree, Contrax"];
  const html = `<div style="font-family:Arial,Helvetica,sans-serif;font-size:16px;line-height:1.5;color:#0f172a;max-width:560px">
<p>Your Contrax Starter plan renews on <b>${esc(day)}</b>. Your card will be charged <b>${price}</b> for the next month.</p>
<p>${keep}</p>
<p>${cancel} <a href="${STARTER_CANCEL_URL}" style="color:#1d4ed8;font-weight:bold">Open Settings</a></p>
<p>Questions? Just reply to this email.</p>
<p>Nathaniel Minetree, Contrax</p>
</div>`;
  return { subject, text: lines.join("\n\n"), html };
}

/** Which stored subscriptions get the reminder now. PURE. */
export function renewalReminderDue(
  row: { periodEnd: Date | string | null; remindedFor: Date | string | null },
  nowMs: number = Date.now(),
): boolean {
  if (!row.periodEnd) return false;
  const end = new Date(row.periodEnd).getTime();
  if (!Number.isFinite(end) || end <= nowMs || end - nowMs > RENEWAL_REMIND_DAYS * DAY_MS) return false;
  return !row.remindedFor || new Date(row.remindedFor).getTime() !== end;
}

/** What Stripe says about a subscription decides whether the reminder is true to send. PURE. */
export function renewalReminderAmount(sub: {
  status?: string | null;
  cancel_at_period_end?: boolean | null;
  cancel_at?: number | null;
  items?: { data?: Array<{ price?: { unit_amount?: number | null; recurring?: { interval?: string | null } | null } | null }> };
}): number | null {
  if (sub.status !== "active" || sub.cancel_at_period_end || sub.cancel_at) return null;
  const price = sub.items?.data?.[0]?.price;
  if (price?.recurring?.interval !== "month") return null;
  return typeof price.unit_amount === "number" && price.unit_amount > 0 ? price.unit_amount : null;
}

/** The owner's alert for a new $9 a month subscriber. PURE. */
export function starterMonthlyOwnerAlert(buyerEmail: string | null, nextChargeAt: Date): {
  subject: string;
  text: string;
  push: { title: string; body: string; tag: string; url: string };
} {
  const who = buyerEmail?.trim() || "(no email on the checkout)";
  const next = passEndDateLabel(nextChargeAt);
  const price = dollars(STARTER_PASS_AMOUNT);
  return {
    subject: `💰 New ${price}/month Starter: ${who}`,
    text: [
      `Someone just started Starter at ${price} a month.`,
      `Buyer: ${who}`,
      `Next charge: ${next}. They get a reminder ${RENEWAL_REMIND_DAYS} days before each charge and can cancel in Settings.`,
      "Live view: https://www.contrax.company/admin/live",
    ].join("\n\n"),
    push: {
      title: `💰 New ${price}/month Starter`,
      body: `${who} just started Starter at ${price} a month (next charge ${next}).`,
      tag: `starter-${who}`.slice(0, 64),
      url: "/admin/live",
    },
  };
}
