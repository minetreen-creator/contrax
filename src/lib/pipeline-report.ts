/**
 * The one-time pipeline report (owner 2026-11-14, choosing "sell a one-time report for $149 before
 * asking for $499 a month"). A company that will not commit to Contrax Managed from a cold email
 * can buy a single report for one state and one line of work; each buyer is then offered the
 * monthly version. Pure and client-safe: the price, the order shape and the notice the owner gets.
 * The order lives in the Stripe session's metadata, so there is no table to keep in step.
 */
import { STATE_NAMES } from "~/lib/contract-map";

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
      `Offer in the report: ${REPORT_CREDIT_NOTE}`,
      `Stripe session: ${sessionId}`,
    ].join("\n\n"),
  };
}
