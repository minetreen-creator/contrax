/**
 * Contrax Managed as a Stripe subscription (owner 2026-11-14: "no, make it a stripe payment";
 * it was sold by invoice until then). Pure and client-safe: the price in cents, the order shape,
 * the snapshot credit rule and the notices the owner gets. The page states the price as
 * MANAGED_PRICE in src/routes/teams.tsx; a test keeps the two in step.
 */
import { REPORT_CREDIT_DAYS, REPORT_PRICE, REPORT_PRICE_CENTS, REPORT_PRODUCT, tradeForText } from "~/lib/pipeline-report";

export const MANAGED_PRICE_CENTS = 49900;
export const MANAGED_PRODUCT = "contrax_managed";
/** Promised on the page; the owner prepares each report by hand. */
export const MANAGED_FIRST_REPORT = "2 business days";

export interface ManagedOrder {
  email: string;
  company: string;
  states: string;
  trade: string;
}

const text = (v: unknown, max: number) => (typeof v === "string" ? v.replace(/\s+/g, " ").trim().slice(0, max) : "");

/** A usable order, or null. States are the buyer's own words ("Virginia, Maryland and DC"). */
export function cleanManagedOrder(input: unknown): ManagedOrder | null {
  if (!input || typeof input !== "object") return null;
  const o = input as Record<string, unknown>;
  const email = text(o.email, 254).toLowerCase();
  const company = text(o.company, 150);
  const states = text(o.states, 200);
  const trade = text(o.trade, 150);
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return null;
  if (company.length < 2 || trade.length < 2 || states.length < 2) return null;
  return { email, company, states, trade };
}

export function managedMetadata(o: ManagedOrder): Record<string, string> {
  return { product: MANAGED_PRODUCT, managed_company: o.company, managed_states: o.states, managed_trade: o.trade, managed_email: o.email };
}

export function managedFromMetadata(m: Record<string, string> | null | undefined): ManagedOrder | null {
  if (m?.product !== MANAGED_PRODUCT) return null;
  return cleanManagedOrder({ email: m.managed_email, company: m.managed_company, states: m.managed_states, trade: m.managed_trade });
}

/**
 * The snapshot credit: a buyer who paid for the one-time report in the last REPORT_CREDIT_DAYS
 * days gets its price off the first managed month. `sessions` are that email's Stripe sessions.
 */
export function snapshotCreditApplies(
  sessions: readonly { created: number; payment_status?: string | null; amount_total?: number | null; metadata?: Record<string, string> | null }[],
  nowMs: number,
): boolean {
  const since = nowMs / 1000 - REPORT_CREDIT_DAYS * 86400;
  return sessions.some((s) => s.metadata?.product === REPORT_PRODUCT && s.payment_status === "paid" && s.amount_total === REPORT_PRICE_CENTS && s.created >= since);
}

export type ManagedMoment = "started" | "cancelled" | "payment_failed";

/** The email and Mission Control push the owner gets for each moment in a subscription's life. */
export function managedNotice(o: ManagedOrder, moment: ManagedMoment, ref: string, credited = false): { subject: string; text: string; title: string; body: string; tag: string } {
  const what = `${o.company}: ${o.trade} in ${o.states}`;
  const slug = tradeForText(o.trade);
  if (moment === "started") {
    return {
      subject: `NEW CLIENT: Contrax Managed, ${o.company}`,
      text: [
        "A Contrax Managed subscription started ($499 a month).",
        `Company: ${o.company}`,
        `Send reports to: ${o.email}`,
        `States: ${o.states}`,
        `Line of work: ${o.trade}`,
        credited ? `The ${REPORT_PRICE} snapshot credit was applied to the first month.` : "No snapshot credit was applied.",
        `First report promised within ${MANAGED_FIRST_REPORT}.`,
        slug ? `Report data trade: ${slug} (run it once per state).` : `"${o.trade}" matches no trade on the site; confirm the line of work with the client first.`,
        "Also owed: a Professional login for their team.",
        `Stripe: ${ref}`,
      ].join("\n\n"),
      title: "💰 Contrax Managed started: $499 a month",
      body: `${what}. First report due within ${MANAGED_FIRST_REPORT}. Send to ${o.email}.`.slice(0, 220),
      tag: `managed-${ref}`.slice(0, 64),
    };
  }
  const label = moment === "cancelled" ? "cancelled" : "payment failed";
  return {
    subject: `Contrax Managed ${label}: ${o.company}`,
    text: [`Contrax Managed ${label}.`, `Company: ${o.company}`, `Contact: ${o.email}`, `Stripe: ${ref}`].join("\n\n"),
    title: moment === "cancelled" ? "Contrax Managed cancelled" : "⚠️ Contrax Managed payment failed",
    body: `${what} (${o.email}).`.slice(0, 220),
    tag: `managed-${moment}-${ref}`.slice(0, 64),
  };
}
