/**
 * The one-time pipeline report (owner 2026-11-14, choosing "sell a one-time report for $149 before
 * asking for $499 a month"). A company that will not commit to Contrax Managed from a cold email
 * can buy a single report for one state and one line of work; each buyer is then offered the
 * monthly version. Pure and client-safe: the price, the order shape and the notice the owner gets.
 * The order lives in the Stripe session's metadata, so there is no table to keep in step.
 */
import { STATE_NAMES } from "~/lib/contract-map";
import { SEO_TRADE_BY_SLUG } from "~/lib/seo-trades";

export const REPORT_PRICE = "$149";
export const REPORT_PRICE_CENTS = 14900;
export const REPORT_PRODUCT = "pipeline_report";
/** Promised on the page and the confirmation; the owner prepares each report by hand. */
export const REPORT_DELIVERY = "1 business day";
/**
 * Exactly what the buyer gets (owner 2026-11-14: "buyers need to know what they are getting").
 * Each line is something the report data job (src/jobs/managed-report-data.ts) already returns,
 * so nothing here is promised that cannot be produced. Bids are "up to" because a state and
 * line of work can have fewer than five open.
 */
export const REPORT_INCLUDES = [
  "The 25 largest federal contracts in your line of work ending in your state in the next 6 months: the holder, the agency, the value and the end date",
  "The 10 agencies with the most of that work ending in the next 12 months",
  "The 10 companies holding the most of it: who you would compete against or team with",
  "Up to 5 open bids that fit you right now",
  "The 12-month total: how many contracts end, what they are worth, and which months are busiest",
];
/** The upgrade hook (owner 2026-11-14): the report's price comes off the first managed month. */
export const REPORT_CREDIT_DAYS = 14;
export const REPORT_CREDIT_NOTE = `Move to Contrax Managed within ${REPORT_CREDIT_DAYS} days and the ${REPORT_PRICE} comes off your first month.`;

export interface ReportOrder {
  email: string;
  company: string;
  state: string;
  trade: string;
}

const text = (v: unknown, max: number) => (typeof v === "string" ? v.replace(/\s+/g, " ").trim().slice(0, max) : "");

/** A usable order, or null. The state must be a real two-letter code; the rest is the buyer's words. */
export function cleanOrder(input: unknown): ReportOrder | null {
  if (!input || typeof input !== "object") return null;
  const o = input as Record<string, unknown>;
  const email = text(o.email, 254).toLowerCase();
  const company = text(o.company, 150);
  const state = text(o.state, 2).toUpperCase();
  const trade = text(o.trade, 150);
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return null;
  if (company.length < 2 || trade.length < 2 || !STATE_NAMES[state]) return null;
  return { email, company, state, trade };
}

export function orderMetadata(o: ReportOrder): Record<string, string> {
  return { product: REPORT_PRODUCT, report_company: o.company, report_state: o.state, report_trade: o.trade, report_email: o.email };
}

/** Reads an order back out of a paid session's metadata. */
export function orderFromMetadata(m: Record<string, string> | null | undefined): ReportOrder | null {
  if (m?.product !== REPORT_PRODUCT) return null;
  return cleanOrder({ email: m.report_email, company: m.report_company, state: m.report_state, trade: m.report_trade });
}

/**
 * The data trade behind a buyer's own words (owner 2026-11-14: "map what they sell to the right
 * trade so report generation stays fast"). The report data job takes one of the site's trade slugs;
 * this picks it from free text so a paid order arrives with its run settings filled in. First match
 * wins, most specific first. Null means no trade fits and the owner chooses by hand.
 */
const TRADE_WORDS: readonly [string, RegExp][] = [
  ["cybersecurity", /cyber|infosec|information security|zero trust|penetration test|\bsoc\b/],
  ["it-services", /\bit\b|i\.t\.|information technology|software|cloud|data ?cent|network|help ?desk|managed services|devops|\bai\b|\bweb\b|digital|comput|telecom/],
  ["janitorial", /janitor|custodia|cleaning|housekeep/],
  ["security-guard", /security guard|guard services|armed|unarmed|patrol|physical security/],
  ["waste-hauling", /waste|trash|garbage|refuse|recycl|dumpster|sanitation/],
  ["trucking", /truck|freight|haul|logistic|transport|deliver|courier/],
  ["landscaping", /landscap|lawn|mow|grounds|tree|irrigation|snow/],
  ["hvac", /hvac|heating|air condition|plumb|mechanical|boiler|chiller/],
  ["electrical", /electric|lighting|wiring|generator|low voltage/],
  ["construction", /construct|build|contractor|renovat|paving|asphalt|concrete|roof|demolition|civil|carpentr|painting|remodel/],
];
export function tradeForText(text: string): string | null {
  const t = ` ${text.toLowerCase()} `;
  for (const [slug, re] of TRADE_WORDS) if (re.test(t) && SEO_TRADE_BY_SLUG[slug]) return slug;
  return null;
}

/** One line telling the owner how to pull the report's data, or that no trade matched. */
export function runLine(o: ReportOrder): string {
  const slug = tradeForText(o.trade);
  return slug
    ? `Report data: run "Managed report data" with state ${o.state} and trade ${slug}.`
    : `Report data: "${o.trade}" matches no trade on the site. Reply to the buyer to pin down the line of work before running it.`;
}

/** The Mission Control push for an order. `paid` false means the form was sent but not yet paid. */
export function orderAlert(o: ReportOrder, sessionId: string, paid: boolean): { title: string; body: string; tag: string; url: string } {
  const what = `${o.company}: ${o.trade} in ${STATE_NAMES[o.state]}`;
  return paid
    ? { title: `💵 ${REPORT_PRICE} report paid`, body: `${what}. Due within ${REPORT_DELIVERY}. Send to ${o.email}.`.slice(0, 220), tag: `report-${sessionId}`.slice(0, 64), url: "/admin/live" }
    : { title: "🧾 Report checkout started", body: `${what} (${o.email}). Not paid yet.`.slice(0, 220), tag: `report-start-${sessionId}`.slice(0, 64), url: "/admin/live" };
}

/** The email the owner gets when a report is paid for. */
export function ownerNotice(o: ReportOrder, sessionId: string): { subject: string; text: string } {
  return {
    subject: `PAID: ${REPORT_PRICE} pipeline report, ${o.trade} in ${STATE_NAMES[o.state]}`,
    text: [
      `A one-time pipeline report was paid for (${REPORT_PRICE}).`,
      `Company: ${o.company}`,
      `Send to: ${o.email}`,
      `State: ${STATE_NAMES[o.state]} (${o.state})`,
      `Line of work: ${o.trade}`,
      `Promised within ${REPORT_DELIVERY}.`,
      runLine(o),
      `Offer to put in the report: ${REPORT_CREDIT_NOTE} Link: https://www.contrax.company/teams#done-for-you (the credit applies itself at checkout when they use ${o.email}).`,
      `Stripe session: ${sessionId}`,
    ].join("\n\n"),
  };
}
