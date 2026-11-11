/**
 * What a bid page tells a visitor (and a search engine) for free (owner 2026-11-11: "build it").
 * Google search sent 24 visitors in 14 days against 29,513 bid pages: each page carried one
 * sentence about the job and the same sales copy as every other. This adds the facts we hold
 * (who is buying, where, what kind of work, when, how big similar jobs run) and a trail up to the
 * state and trade pages, which outlive any single bid. The notice link, the documents and the
 * point of contact stay for members. PURE.
 */
import { SEO_TRADE_BY_SLUG } from "~/lib/seo-trades";

const SITE = "https://www.contrax.company";

/** The trade page a bid belongs under, or null when no trade fits cleanly. NAICS first, then category. */
export function bidSeoTradeSlug(naics: string | null | undefined, category: string | null | undefined): string | null {
  const code = (naics ?? "").trim();
  if (/^\d{6}$/.test(code)) {
    if (code === "561720") return "janitorial";
    if (code === "561612") return "security-guard";
    if (code === "561730") return "landscaping";
    if (code === "238220") return "hvac";
    if (code === "238210") return "electrical";
    if (code.startsWith("5621")) return "waste-hauling";
    if (code.startsWith("484")) return "trucking";
    if (code.startsWith("5415")) return "it-services";
    if (/^23[678]/.test(code)) return "construction";
    return null;
  }
  const cat = (category ?? "").trim();
  if (cat === "Janitorial") return "janitorial";
  if (cat === "Landscaping") return "landscaping";
  if (cat === "HVAC") return "hvac";
  if (cat === "Plumbing & Electrical") return "electrical";
  if (cat === "Security") return "security-guard";
  if (cat === "IT Services") return "it-services";
  if (/^Construction\b/.test(cat)) return "construction";
  return null;
}

/** "North Carolina" → "north-carolina". */
export const stateSlug = (name: string) => name.trim().toLowerCase().replace(/\s+/g, "-");

export interface Crumb {
  name: string;
  /** Site path; the last crumb (the bid itself) has none. */
  href: string | null;
}

/** Home › {State} contracts › {Trade} › the bid. Levels we cannot place are left out. */
export function bidBreadcrumbs(b: { title: string; state_name: string | null; naics_code: string | null; category: string | null }): Crumb[] {
  const out: Crumb[] = [{ name: "Contrax", href: "/" }];
  if (b.state_name) {
    const st = stateSlug(b.state_name);
    out.push({ name: `${b.state_name} contracts`, href: `/contracts-in/${st}` });
    const slug = bidSeoTradeSlug(b.naics_code, b.category);
    const trade = slug ? SEO_TRADE_BY_SLUG[slug] : undefined;
    if (trade) out.push({ name: trade.label, href: `/contracts-in/${st}/${trade.slug}` });
  }
  out.push({ name: b.title || "Solicitation", href: null });
  return out;
}

/** schema.org BreadcrumbList for the trail (the one structured-data type that honestly fits a bid notice). */
export function breadcrumbJsonLd(crumbs: Crumb[], bidUrl: string): Record<string, unknown> {
  return {
    "@context": "https://schema.org",
    "@type": "BreadcrumbList",
    itemListElement: crumbs.map((c, i) => ({
      "@type": "ListItem",
      position: i + 1,
      name: c.name,
      item: c.href ? `${SITE}${c.href}` : bidUrl,
    })),
  };
}

export interface BidFactsInput {
  buyer: string | null;
  place: string | null;
  state_name: string | null;
  /** NAICS name or category, already in plain words. */
  work_type: string | null;
  naics_code: string | null;
  set_aside: string | null;
  /** "Nov 3, 2026" */
  posted: string | null;
  /** "Nov 18, 2026" */
  due: string | null;
  days_left: string | null;
  /** The source's own stated value, e.g. "$1.4M". */
  stated_value: string | null;
  /** "$39K to $241K" from similar federal contracts, with where it came from. */
  size: { text: string; scope: "state" | "nation"; count: number } | null;
  similar_total: number;
}

/** Label and value pairs for the "Key facts" box. Only facts we hold are listed; nothing is guessed. */
export function bidKeyFacts(f: BidFactsInput): [string, string][] {
  const rows: [string, string][] = [];
  if (f.buyer) rows.push(["Buyer", f.buyer]);
  const place = f.place && f.state_name && !f.place.includes(f.state_name) ? `${f.place} (${f.state_name})` : (f.place ?? f.state_name);
  if (place) rows.push(["Place of work", place]);
  if (f.work_type) rows.push(["Type of work", f.naics_code ? `${f.work_type} (NAICS ${f.naics_code})` : f.work_type]);
  rows.push(["Who can bid", f.set_aside || "Open to small business"]);
  if (f.posted) rows.push(["Posted", f.posted]);
  if (f.due) rows.push(["Bids due", f.days_left ? `${f.due} (${f.days_left})` : f.due]);
  if (f.stated_value) rows.push(["Stated value", f.stated_value]);
  else if (f.size) {
    const from = f.size.scope === "nation" ? `${f.size.count.toLocaleString("en-US")} similar federal contracts nationwide` : `${f.size.count.toLocaleString("en-US")} similar federal contracts in ${f.state_name ?? "the state"}`;
    rows.push(["Typical size of similar jobs", `${f.size.text} (an estimate from ${from}, not this bid's budget)`]);
  }
  if (f.similar_total > 0 && f.state_name) rows.push([`Similar open bids in ${f.state_name}`, f.similar_total.toLocaleString("en-US")]);
  return rows;
}
