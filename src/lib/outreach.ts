/**
 * Daily bid outreach (owner 2026-10-23: "I need something that brings in leads
 * and traffic"). Each weekday morning a job finds fresh open bids, looks up
 * local businesses in that trade (prospect-finder), and queues one "Open bid
 * near you" email per business. Nothing is sent until the owner approves the
 * day's list on /admin/outreach. Four days after a first email, a single
 * follow-up with the Bid Scout founder offer is queued the same way.
 *
 * Rules the engine keeps (CAN-SPAM and plain courtesy):
 *  - every email carries the sender's postal address and a one-click
 *    unsubscribe link (List-Unsubscribe header too);
 *  - an address gets at most one first email and one follow-up, ever;
 *  - unsubscribed or "stop" addresses are suppressed for good;
 *  - only addresses a business publishes on its own website are used
 *    (prospect-finder never guesses one).
 *
 * PURE and client-safe: templates, trade list, timing. DB, Resend and token
 * signing live in outreach.server.ts.
 */

export interface OutreachTrade {
  /** Word matched in bid titles/descriptions. */
  match: string;
  /** Google Places search word ("janitorial company near …"). */
  places: string;
  /** Word used in the email ("other open janitorial bids"). */
  label: string;
}

export const OUTREACH_TRADES: readonly OutreachTrade[] = [
  { match: "janitorial", places: "janitorial", label: "janitorial" },
  { match: "custodial", places: "commercial cleaning", label: "cleaning" },
  { match: "landscap", places: "landscaping", label: "landscaping" },
  { match: "grounds maintenance", places: "landscaping", label: "grounds maintenance" },
  { match: "mowing", places: "lawn care", label: "mowing" },
  { match: "hvac", places: "HVAC contractor", label: "HVAC" },
  { match: "painting", places: "commercial painting", label: "painting" },
  { match: "roof", places: "roofing contractor", label: "roofing" },
  { match: "pest control", places: "pest control", label: "pest control" },
  { match: "plumbing", places: "plumbing contractor", label: "plumbing" },
  { match: "snow removal", places: "snow removal", label: "snow removal" },
  { match: "moving services", places: "moving company", label: "moving" },
];

/** Drafts the daily job may queue (first emails), across all trades. */
export const DAILY_FIRST_EMAILS = 30;
/** Businesses emailed per bid. */
export const BUSINESSES_PER_BID = 2;
/** A bid must be due at least this far out to be worth a cold email... */
export const MIN_DAYS_TO_DUE = 10;
/** ...and no further out than this (standing lists and multi-year
 * prequalifications are not "an open bid near you"). */
export const MAX_DAYS_TO_DUE = 120;
const FREE_MAIL = /^(gmail|googlemail|yahoo|ymail|outlook|hotmail|live|msn|aol|icloud|me|mac|comcast|verizon|att|sbcglobal|bellsouth|cox|charter|earthlink|protonmail|proton)\.(com|net|me)$/;

/**
 * True when an address plausibly belongs to the business: on its own website's
 * domain (or a subdomain of it), or a personal mailbox provider small
 * businesses commonly use. Rejects addresses scraped from a site that belong
 * to someone else (a font vendor, a web designer…).
 */
export function emailFitsSite(email: string, siteHost: string | null): boolean {
  const domain = email.trim().toLowerCase().split("@")[1] ?? "";
  if (!domain) return false;
  if (FREE_MAIL.test(domain)) return true;
  const host = (siteHost ?? "").toLowerCase().replace(/^www\./, "");
  return !!host && (domain === host || domain.endsWith(`.${host}`) || host.endsWith(`.${domain}`));
}

const STATE_WORDS = /^(alabama|alaska|arizona|arkansas|california|colorado|connecticut|delaware|district of columbia|florida|georgia|hawaii|idaho|illinois|indiana|iowa|kansas|kentucky|louisiana|maine|maryland|massachusetts|michigan|minnesota|mississippi|missouri|montana|nebraska|nevada|new hampshire|new jersey|new mexico|new york|north carolina|north dakota|ohio|oklahoma|oregon|pennsylvania|rhode island|south carolina|south dakota|tennessee|texas|utah|vermont|virginia|washington|west virginia|wisconsin|wyoming|[a-z]{2})$/;

/**
 * True when a Places search location names somewhere specific (a city,
 * county or agency), not just a state or a statewide purchasing group, so
 * the businesses found are actually near the work.
 */
export function placeIsLocal(place: string): boolean {
  const p = place.trim().toLowerCase().replace(/[.,]+$/g, "");
  if (!p || /purchasing group|bidnet/.test(p)) return false;
  if (STATE_WORDS.test(p)) return false;
  return true;
}

/** Follow-up is queued this many days after the first email... */
export const FOLLOWUP_AFTER_DAYS = 4;
/** ...and only while the bid is still at least this far from due. */
export const FOLLOWUP_MIN_DAYS_TO_DUE = 2;
/** Most emails one "send" click may send. */
export const MAX_SEND_PER_BATCH = 50;

export type OutreachKind = "first" | "followup";

export interface OutreachEmailInput {
  kind: OutreachKind;
  business: string;
  bidId: number;
  bidTitle: string;
  buyer: string | null;
  /** YYYY-MM-DD */
  due: string;
  tradeLabel: string;
  postalAddress: string;
  unsubscribeUrl: string;
  /** Row id, carried on links for attribution. */
  contactId: number;
}

const SITE = "https://www.contrax.company";

export function formatDue(due: string): string {
  const d = new Date(`${due}T12:00:00Z`);
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" });
}

function link(path: string, kind: OutreachKind, contactId: number): string {
  const sep = path.includes("?") ? "&" : "?";
  return `${SITE}${path}${sep}utm_source=email&utm_medium=outreach&utm_campaign=bid_outreach_${kind}&oc=${contactId}`;
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

/** Subject, plain text and HTML for one outreach email. */
export function outreachEmail(i: OutreachEmailInput): { subject: string; text: string; html: string } {
  const due = formatDue(i.due);
  const bidUrl = link(`/bid/${i.bidId}`, i.kind, i.contactId);
  const footer = [
    "",
    "Nathaniel Minetree",
    "Owner and CEO, Contrax LLC",
    "contrax.company",
    "",
    `Contrax LLC, ${i.postalAddress}`,
    `You're receiving this because ${i.business} lists this address on its website. Unsubscribe: ${i.unsubscribeUrl}`,
  ];

  let subject: string;
  let body: string[];
  if (i.kind === "first") {
    subject = `Open bid near you: ${i.bidTitle}`.slice(0, 140);
    body = [
      "Hi,",
      "",
      `I came across an open bid that looks like a fit for ${i.business}:`,
      "",
      i.bidTitle,
      ...(i.buyer ? [`Buyer: ${i.buyer}`] : []),
      `Due: ${due}`,
      `Details: ${bidUrl}`,
      "",
      `Contrax finds bids like this every morning (federal, state and local) matched to your trade and area, with a link to the official posting. If you'd like the other open ${i.tradeLabel} bids near you, just reply "yes" and I'll send them, no charge. Or get them every morning with Contrax Starter, $5 for your first month, then $19/month, cancel anytime: ${link("/pricing", i.kind, i.contactId)}`,
      "",
      "Either way, I hope this one is useful.",
    ];
  } else {
    subject = `Re: Open bid near you: ${i.bidTitle}`.slice(0, 140);
    body = [
      "Hi,",
      "",
      `Quick follow-up on the ${i.bidTitle} bid. It's due ${due}, so there's still time if you want to go for it: ${bidUrl}`,
      "",
      `If finding these isn't something you have time for, that's what Bid Scout is for. Every Friday I send you 5 government bids handpicked for ${i.business}, each with the requirements in plain English, the deadline, the main risks, and what to do next. You just decide which ones to chase.`,
      "",
      `It's normally $99/month, with the first month $49 for our first founding customers: ${link("/bid-scout?source=outreach", i.kind, i.contactId)}`,
      "",
      `Or search on your own with Starter, $5 for the first month: ${link("/pricing", i.kind, i.contactId)}`,
      "",
      "Either way, good luck on the bid.",
    ];
  }
  const text = [...body, ...footer].join("\n");
  const html = `<div style="font-family:Arial,Helvetica,sans-serif;font-size:15px;line-height:1.55;color:#1e293b">${text
    .split("\n")
    .map((l) => (l ? escapeHtml(l).replace(/(https:\/\/[^\s]+)/g, '<a href="$1">$1</a>') : "&nbsp;"))
    .map((l, idx, all) => (idx >= all.length - 2 ? `<div style="font-size:12px;color:#64748b">${l}</div>` : `<div>${l}</div>`))
    .join("")}</div>`;
  return { subject, text, html };
}

/** True when a first email sent at `sentAt` is due a follow-up at `now`. */
export function followupDue(sentAt: Date, now: Date): boolean {
  return now.getTime() - sentAt.getTime() >= FOLLOWUP_AFTER_DAYS * 86_400_000;
}

/** Whole days from `now` until a YYYY-MM-DD due date (UTC). */
export function daysUntil(due: string, now: Date): number {
  return Math.floor((Date.parse(`${due}T00:00:00Z`) - Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate())) / 86_400_000);
}

/** A mailing address is required before anything can be sent (CAN-SPAM). */
export function validPostalAddress(a: string | null | undefined): boolean {
  const s = (a ?? "").trim();
  return s.length >= 10 && /\d/.test(s) && /[A-Za-z]/.test(s);
}

/**
 * Addresses Contrax emailed by hand from Gmail on 2026-10-22/23 (first email
 * and follow-up both sent). The engine never emails them again.
 */
export const CONTACTED_BY_HAND: readonly string[] = [
  "rglaze@dependablepestcontrol.com",
  "info@lambexterminating.com",
  "genewestpainting@gmail.com",
  "micah@micahrich.com",
  "estimating@gerloffpainting.com",
  "info@frenchpaintingcompany.com",
  "info@evergreencontractors.com",
  "kyle@douglasroofs.com",
  "john@dealsheatingandcooling.com",
  "bud9218@aol.com",
  "electrical@huttonpowerandlight.com",
  "info@coastalhc.com",
  "ezlawncare14@gmail.com",
  "reesolutions22@gmail.com",
  "contact@blisslawnandlandscape.com",
  "info@thecleaningcompanyva.com",
  "blue.ridge@comcast.net",
  "galvanhousekeeper@gmail.com",
  "jamesljordanjr@aol.com",
];
