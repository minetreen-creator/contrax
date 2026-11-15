/**
 * Reseller partners (owner 2026-11-15: "Yes go", then three tweaks and "make sure these payments
 * can be put on stripe too"). Firms that already serve government contractors give their clients
 * the monthly pipeline report under their own name. They pay a wholesale price per client and
 * keep the difference. PURE and client-safe: prices, the order shape, the preview address, the
 * sample market that fits a firm, and the notices the owner gets.
 */
export const PARTNER_PRODUCT = "contrax_reseller";
/** Wholesale, per client per month. */
export const PARTNER_PRICE_CENTS = 19900;
/** From PARTNER_VOLUME_AT clients, every client is billed at this. */
export const PARTNER_VOLUME_PRICE_CENTS = 14900;
export const PARTNER_VOLUME_AT = 10;
export const PARTNER_PRICE = "$199";
export const PARTNER_VOLUME_PRICE = "$149";
/** What a firm typically charges its client for a deliverable like this. Contrax sells it direct for $499. */
export const PARTNER_RETAIL = "$400 to $500";
export const PARTNER_MAX_CLIENTS = 200;

export const partnerUnitCents = (clients: number) => (clients >= PARTNER_VOLUME_AT ? PARTNER_VOLUME_PRICE_CENTS : PARTNER_PRICE_CENTS);
export const partnerMonthlyCents = (clients: number) => clients * partnerUnitCents(clients);

/** "Acme Proposal Group, LLC" → "acme-proposal-group-llc". The preview page's address for a firm. */
export function partnerSlug(name: string): string {
  return name.toLowerCase().replace(/&/g, " and ").replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 80);
}

/** The sample markets a preview can show, and the words on a firm's site that point to each. */
export const PARTNER_MARKETS = {
  it: { state: "VA", trade: "it-services", says: "IT and professional services" },
  trades: { state: "TX", trade: "hvac", says: "construction and facilities trades" },
  janitorial: { state: "VA", trade: "janitorial", says: "facilities and janitorial services" },
} as const;
export type PartnerMarket = keyof typeof PARTNER_MARKETS;
export const partnerMarket = (k: unknown): PartnerMarket => (typeof k === "string" && k in PARTNER_MARKETS ? (k as PartnerMarket) : "it");

/** Which sample fits a firm, from its name and the words on its own home page. Defaults to IT. */
export function partnerMarketFor(text: string): PartnerMarket {
  const t = text.toLowerCase();
  const count = (re: RegExp) => (t.match(re) ?? []).length;
  const trades = count(/\b(construction|contractors?|hvac|mechanical|electrical|plumbing|roofing|paving|trades?|a\/e|architect|engineering)\b/g);
  const clean = count(/\b(janitorial|custodial|facilit(y|ies) (maintenance|services|management)|landscap\w+|grounds)\b/g);
  const it = count(/\b(it services|information technology|software|cyber\w*|cloud|professional services|technology|saas|data)\b/g);
  if (clean > trades && clean > it) return "janitorial";
  if (trades > it) return "trades";
  return "it";
}

export interface PartnerOrder { email: string; firm: string; clients: number }
const text = (v: unknown, max: number) => (typeof v === "string" ? v.replace(/\s+/g, " ").trim().slice(0, max) : "");

/** A usable order, or null. */
export function cleanPartnerOrder(input: unknown): PartnerOrder | null {
  if (!input || typeof input !== "object") return null;
  const o = input as Record<string, unknown>;
  const email = text(o.email, 254).toLowerCase();
  const firm = text(o.firm, 150);
  const clients = Math.floor(Number(o.clients));
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || firm.length < 2) return null;
  if (!Number.isFinite(clients) || clients < 1 || clients > PARTNER_MAX_CLIENTS) return null;
  return { email, firm, clients };
}

export const partnerMetadata = (o: PartnerOrder): Record<string, string> => ({ product: PARTNER_PRODUCT, partner_firm: o.firm, partner_email: o.email, partner_clients: String(o.clients) });
export function partnerFromMetadata(m: Record<string, string> | null | undefined): PartnerOrder | null {
  if (m?.product !== PARTNER_PRODUCT) return null;
  return cleanPartnerOrder({ email: m.partner_email, firm: m.partner_firm, clients: m.partner_clients });
}

const dollars = (cents: number) => `$${(cents / 100).toLocaleString("en-US")}`;
export type PartnerMoment = "started" | "cancelled" | "payment_failed";

/** The email and Mission Control push the owner gets for each moment in a partner subscription. */
export function partnerNotice(o: PartnerOrder, moment: PartnerMoment, ref: string): { subject: string; text: string; title: string; body: string; tag: string } {
  const each = dollars(partnerUnitCents(o.clients));
  const month = dollars(partnerMonthlyCents(o.clients));
  if (moment === "started") {
    return {
      subject: `NEW PARTNER: ${o.firm}, ${o.clients} client${o.clients === 1 ? "" : "s"}`,
      text: [
        `A reseller subscription started: ${o.clients} client${o.clients === 1 ? "" : "s"} at ${each} each, ${month} a month.`,
        `Firm: ${o.firm}`,
        `Contact: ${o.email}`,
        "Next: reply and ask for each client's state and line of work, then prepare each report under the firm's name.",
        `Stripe: ${ref}`,
      ].join("\n\n"),
      title: `💰 New partner: ${month} a month`,
      body: `${o.firm}: ${o.clients} client${o.clients === 1 ? "" : "s"} at ${each}. Ask ${o.email} for each client's state and trade.`.slice(0, 220),
      tag: `partner-${ref}`.slice(0, 64),
    };
  }
  const label = moment === "cancelled" ? "cancelled" : "payment failed";
  return {
    subject: `Partner subscription ${label}: ${o.firm}`,
    text: [`Partner subscription ${label}.`, `Firm: ${o.firm}`, `Contact: ${o.email}`, `Stripe: ${ref}`].join("\n\n"),
    title: moment === "cancelled" ? "Partner subscription cancelled" : "⚠️ Partner payment failed",
    body: `${o.firm} (${o.email}).`.slice(0, 220),
    tag: `partner-${moment}-${ref}`.slice(0, 64),
  };
}
