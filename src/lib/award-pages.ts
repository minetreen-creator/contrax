/**
 * Award pages (owner 2026-11-24, "2"): one public page per large federal construction award at
 * /federal-award/{company}-{state}-{id}. A supplier, rental house or staffing firm that searches
 * "who won <job>" lands on the winner, the amount and the agency, with the weekly supplier report
 * ($199 a month, src/lib/supplier-report.ts) as the next step.
 *
 * Rules:
 *  - facts come from the public USAspending.gov record we already store (award_leads), and the
 *    page links that record;
 *  - the page says whether a contact, address and website are on file; it never shows them. Those
 *    come with the report (owner: no freebies);
 *  - only awards of AWARD_PAGE_MIN or more, coded construction, in the states the report samples.
 * PURE.
 */
import { STATE_NAMES } from "~/lib/contract-map";
import { SUPPLIER_SAMPLE_STATES, clip, supplierMoney, tidyCaps } from "~/lib/supplier-report";

export const AWARD_PAGE_MIN = 1_000_000;
export const AWARD_PAGE_PATH = "/federal-award";
/** Newest awards listed in the sitemap. A first step on purpose: a flood of similar pages indexes badly. */
export const AWARD_SITEMAP_LIMIT = 1000;
/** Other recent winners in the same state linked from a page. */
export const AWARD_PAGE_NEIGHBOURS = 6;

export interface AwardPageData {
  id: number;
  path: string;
  company: string;
  /** "Lexington, KY", or "" when the record has no city. */
  basedIn: string;
  recipientState: string | null;
  state: string;
  stateName: string;
  amount: number;
  /** ISO date the award was signed. */
  awardedOn: string;
  agency: string;
  subAgency: string;
  what: string;
  recordUrl: string;
  /** What the weekly report holds for this winner. Booleans only: the details are not sent to the page. */
  onFile: { contact: boolean; address: boolean; website: boolean };
  others: { path: string; company: string; amount: number; awardedOn: string }[];
}

const slugPart = (s: string, max: number) =>
  s.toLowerCase().normalize("NFKD").replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, max).replace(/-+$/g, "");

/** "Semper Tek CMS JV LLC", "NC", 4812 → "/federal-award/semper-tek-cms-jv-llc-nc-4812". PURE. */
export function awardPath(company: string, state: string, id: number): string {
  return `${AWARD_PAGE_PATH}/${[slugPart(company, 60) || "award", state.toLowerCase(), id].join("-")}`;
}

/** The award's row id from a slug: the digits after the last hyphen. null when there are none. PURE. */
export function awardIdFromSlug(slug: string): number | null {
  const m = /(?:^|-)(\d{1,9})$/.exec(String(slug ?? ""));
  if (!m) return null;
  const n = Number(m[1]);
  return Number.isSafeInteger(n) && n > 0 ? n : null;
}

/** True when an award may have a page: large enough, construction, in a state the report samples. PURE. */
export function awardPageEligible(a: { amount: number; naics_code?: string | null; pop_state?: string | null; awarded_on?: unknown }): boolean {
  return (
    Number(a.amount) >= AWARD_PAGE_MIN &&
    String(a.naics_code ?? "").startsWith("23") &&
    SUPPLIER_SAMPLE_STATES.includes(String(a.pop_state ?? "")) &&
    a.awarded_on != null
  );
}

/** "November 16, 2026". PURE. */
export function awardLongDay(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric", timeZone: "UTC" });
}

/** The job in plain words: tidied capitals, one line. PURE. */
export function awardWhat(description: string | null | undefined): string {
  return clip(tidyCaps(String(description ?? "").replace(/\s+/g, " ").trim()), 160);
}

export function awardTitle(d: AwardPageData): string {
  return clip(`${d.company} won a ${supplierMoney(d.amount)} federal construction contract in ${d.stateName}`, 110) + " | Contrax";
}

export function awardDescription(d: AwardPageData): string {
  const from = d.basedIn ? ` of ${d.basedIn}` : "";
  const job = d.what ? ` Job: ${d.what}` : "";
  return clip(`${d.company}${from} won ${supplierMoney(d.amount)} from the ${d.agency || "federal government"} on ${awardLongDay(d.awardedOn)}.${job}`, 300);
}

/** Out-of-state winners need local suppliers and subs: say so only when the record shows it. PURE. */
export function awardOutOfState(d: Pick<AwardPageData, "recipientState" | "state">): boolean {
  return Boolean(d.recipientState) && d.recipientState !== d.state;
}

/** What the report adds for this winner, as a sentence; "" when nothing is on file. PURE. */
export function onFileLine(f: AwardPageData["onFile"]): string {
  const parts = [f.contact && "a named contact", f.address && "the office address", f.website && "the company website"].filter(Boolean) as string[];
  if (!parts.length) return "";
  const list = parts.length === 1 ? parts[0] : `${parts.slice(0, -1).join(", ")} and ${parts[parts.length - 1]}`;
  return `On file for this winner: ${list}.`;
}

export const stateNameOf = (code: string) => STATE_NAMES[code] ?? code;

export function awardSitemapXml(rows: { company: string; state: string; id: number }[], origin = "https://www.contrax.company"): string {
  const urls = rows
    .map((r) => `  <url>\n    <loc>${origin}${awardPath(r.company, r.state, r.id)}</loc>\n    <changefreq>monthly</changefreq>\n  </url>`)
    .join("\n");
  return `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls}\n</urlset>\n`;
}
