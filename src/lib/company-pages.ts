/**
 * Company pages (owner 2026-11-12, "build it"): one public page per SAM.gov registered small
 * business at /company/{name}-{uei}, showing the government bids open right now that fit the
 * trades and state on its registration. A business owner who searches their own company name
 * lands on a page about their company with real bids on it.
 *
 * Rules:
 *  - public SAM.gov registration facts only (src/lib/sam-registrants.ts): name, city, state,
 *    trades, business types and NAICS codes. No phone, email or contact name is stored or shown,
 *    and the page does not link the business's website (that stays on Sub Finder);
 *  - Contrax never contacts these businesses (owner rule: no cold outreach);
 *  - a bid count is Radar's own state count for the trade (one count everywhere);
 *  - a business can ask for its page to be removed (company_page_optouts).
 * PURE.
 */
import { NAICS_NAMES } from "~/lib/naics-names";
import { radarHrefFor, SEO_TRADE_BY_SLUG } from "~/lib/seo-trades";
import { certNames, stateSlugOf } from "~/lib/sub-finder";

/** Bids listed per trade on a company page. */
export const COMPANY_PAGE_BIDS = 8;
/** At most this many of a business's trades get their own section. */
export const COMPANY_PAGE_TRADES = 3;
/**
 * How long one trade + state match list may be reused. The warm job (src/jobs/warm-company-pages.ts)
 * recomputes every list after each bid sync, so a page normally reads a list made minutes after the
 * bids last changed; this is the fallback age after which a page recomputes its own.
 */
export const COMPANY_CACHE_MINUTES = 26 * 60;
/** Trade + state lists the warm job recomputes at once. */
export const COMPANY_WARM_CONCURRENCY = 4;
/**
 * Company pages listed per state in the sitemap. A first step, on purpose: search engines treat a
 * sudden flood of similar pages badly, so the list grows once these are being indexed.
 */
export const COMPANY_SITEMAP_PER_STATE = 1000;
/** Other registered businesses linked from a company page (same city, shared trade). */
export const COMPANY_NEIGHBOURS = 6;

const UEI_RE = /^[A-Z0-9]{12}$/;

/** "Acme Paving, LLC" + "ABCD1234EFGH" → "acme-paving-llc-abcd1234efgh". PURE. */
export function companySlug(name: string, uei: string): string {
  const base = name
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60)
    .replace(/-+$/g, "");
  return `${base || "business"}-${uei.toLowerCase()}`;
}

export const companyPath = (name: string, uei: string) => `/company/${companySlug(name, uei)}`;

/** The UEI at the end of a company slug, or null when the slug is not one of ours. PURE. */
export function ueiFromSlug(slug: string): string | null {
  const tail = slug.trim().slice(-12).toUpperCase();
  if (!UEI_RE.test(tail)) return null;
  // A bare UEI is fine; otherwise the UEI must follow a dash.
  if (slug.length > 12 && slug.charAt(slug.length - 13) !== "-") return null;
  return tail;
}

export interface CompanyBid {
  id: number;
  title: string;
  agency: string | null;
  description: string | null;
  due_date: string | null;
  estimated_value: string | null;
  naics_code: string | null;
  location: string | null;
  set_aside: string | null;
  source: string | null;
}

export interface CompanyTradeSection {
  slug: string;
  label: string;
  /** Radar's count of open bids for this trade in the business's state. */
  count: number;
  bids: CompanyBid[];
  /** Radar's nationwide matches, open to a business in any state (never added to `count`). */
  nationwideCount: number;
  radarHref: string;
  statePath: string;
}

export interface CompanyPageData {
  found: boolean;
  uei: string | null;
  name: string | null;
  city: string | null;
  state: string | null;
  stateName: string | null;
  /** Canonical path for this business (the name in a link can be out of date). */
  path: string | null;
  certs: string[];
  naics: { code: string; name: string | null }[];
  trades: CompanyTradeSection[];
  neighbours: { name: string; path: string }[];
  /** Date of the SAM.gov extract the facts come from (YYYY-MM-DD). */
  extractDate: string | null;
}

export const EMPTY_COMPANY_PAGE: CompanyPageData = {
  found: false, uei: null, name: null, city: null, state: null, stateName: null, path: null,
  certs: [], naics: [], trades: [], neighbours: [], extractDate: null,
};

/** The registered trades we have pages for, in the order stored, capped. PURE. */
export function pageTrades(trades: string[]): { slug: string; label: string; radarTerm: string }[] {
  return trades
    .map((t) => SEO_TRADE_BY_SLUG[t])
    .filter((t): t is NonNullable<typeof t> => !!t)
    .slice(0, COMPANY_PAGE_TRADES)
    .map((t) => ({ slug: t.slug, label: t.label, radarTerm: t.radarTerm }));
}

export function tradeSection(
  t: { slug: string; label: string; radarTerm: string },
  state: string,
  stateName: string,
  m: { count: number; nationwideCount: number; bids: CompanyBid[] },
): CompanyTradeSection {
  return {
    slug: t.slug,
    label: t.label,
    count: m.count,
    bids: m.bids.slice(0, COMPANY_PAGE_BIDS),
    nationwideCount: m.nationwideCount,
    radarHref: radarHrefFor(SEO_TRADE_BY_SLUG[t.slug]!, state),
    statePath: `/contracts-in/${stateSlugOf(stateName)}/${t.slug}`,
  };
}

export const naicsWithNames = (codes: string[]) =>
  [...new Set(codes)].slice(0, 8).map((code) => ({ code, name: NAICS_NAMES[code] ?? null }));

/** Certification names for display; two registry values can share one name, shown once. */
export const certLabels = (certs: string[]) => [...new Set(certNames(certs))];

/** The largest single-trade count: the honest "at least this many" figure for the headline. PURE. */
export const topCount = (d: Pick<CompanyPageData, "trades">) => d.trades.reduce((n, t) => Math.max(n, t.count), 0);
export const nationwideTop = (d: Pick<CompanyPageData, "trades">) => d.trades.reduce((n, t) => Math.max(n, t.nationwideCount), 0);

/** In search results only when the page lists at least one open bid, in the state or nationwide. PURE. */
export function companyIndexable(d: CompanyPageData | null | undefined): boolean {
  return !!d?.found && (topCount(d) > 0 || nationwideTop(d) > 0);
}

/** "Construction" → "construction"; HVAC and IT keep their capitals. */
export const lowerTrade = (label: string) => (/^(HVAC|IT)\b/.test(label) ? label : label.charAt(0).toLowerCase() + label.slice(1));

/** "construction and electrical" from the page's trades. PURE. */
export function tradeList(d: Pick<CompanyPageData, "trades">): string {
  const names = d.trades.map((t) => lowerTrade(t.label));
  if (names.length <= 1) return names[0] ?? "";
  return `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}`;
}

export function companyTitle(d: CompanyPageData): string {
  if (!d.found || !d.name) return "Registered government contractor | Contrax";
  const place = [d.city, d.state].filter(Boolean).join(", ");
  return `${d.name}${place ? ` (${place})` : ""}: government bids open now | Contrax`;
}

export function companyDescription(d: CompanyPageData): string {
  if (!d.found || !d.name) return "Open government bids matched to registered small businesses, by trade and state.";
  const n = topCount(d);
  const top = d.trades.find((t) => t.count === n);
  const lead = n > 0 && top
    ? `${n.toLocaleString("en-US")} open ${lowerTrade(top.label)} bids in ${d.stateName} fit ${d.name}'s SAM.gov registration.`
    : `Open government bids that fit ${d.name}'s SAM.gov registration.`;
  return `${lead} See each job, the buyer and the due date. Matched by trade and state from public registration data.`;
}

/** The sentence under the headline. PURE. */
export function companySubhead(d: CompanyPageData): string {
  const n = topCount(d);
  const top = d.trades.find((t) => t.count === n);
  if (n > 0 && top) {
    return `${n.toLocaleString("en-US")} government ${lowerTrade(top.label)} ${n === 1 ? "bid is" : "bids are"} open in ${d.stateName} right now that ${n === 1 ? "fits" : "fit"} the trades on this business's SAM.gov registration.`;
  }
  const nw = nationwideTop(d);
  if (nw > 0) {
    return `No ${d.stateName} bids in its registered trades are open today. ${nw.toLocaleString("en-US")} nationwide ${nw === 1 ? "one is" : "ones are"} open to a business in any state.`;
  }
  return `No open bids match its registered trades today. New bids post every weekday morning.`;
}

/** Sitemap index: one child sitemap per state. PURE. */
export function companySitemapIndexXml(states: string[], origin = "https://www.contrax.company"): string {
  const items = states
    .map((s) => `  <sitemap>\n    <loc>${origin}/sitemap-companies.xml?state=${s}</loc>\n  </sitemap>`)
    .join("\n");
  return `<?xml version="1.0" encoding="UTF-8"?>\n<sitemapindex xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${items}\n</sitemapindex>\n`;
}

export function companySitemapXml(rows: { name: string; uei: string }[], origin = "https://www.contrax.company"): string {
  const urls = rows
    .map((r) => `  <url>\n    <loc>${origin}${companyPath(r.name, r.uei)}</loc>\n    <changefreq>weekly</changefreq>\n  </url>`)
    .join("\n");
  return `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls}\n</urlset>\n`;
}
