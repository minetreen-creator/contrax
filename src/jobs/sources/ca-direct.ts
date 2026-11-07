/**
 * California buyers read directly (owner 2026-11-07: "more bids of our own instead of relying mostly on
 * bidnet" → "Yes start California"). Captured 2026-11-07 (fixtures/ca-direct); no logins, forms or
 * documents.
 *
 *  - San Bernardino County ePro and Contra Costa County: Periscope BuySpeed marketplaces, read with the
 *    shared BSO reader (open bids only, every page).
 *  - EBMUD (East Bay Municipal Utility District): its public "Current Construction Bid Opportunities"
 *    table — project, specification number, construction estimate, bid opening date. The table states a
 *    date only, so the deadline is 11:59 PM Pacific (the date-only convention) and the description says
 *    so. Prequalification calls are not bids and are skipped.
 */
import { mapCategory } from "~/lib/trade-classification";
import type { FetchResult } from "../runner";
import { SourceUnreachableError } from "../fetch-failure";
import { fetchBsoBids, type BsoConfig } from "./periscope-bso";
import type { RawBid } from "./sam-gov";

const PT = -8;
export const CA_COUNTY_BSO: readonly BsoConfig[] = [
  { source: "ca_san_bernardino_county", origin: "https://epro.sbcounty.gov", idPrefix: "sbcountyepro", stateName: "California", portalName: "San Bernardino County ePro", standardOffsetHours: PT, buyer: "San Bernardino County", location: "San Bernardino County, CA" },
  { source: "ca_contra_costa_county", origin: "https://purchasing.cccounty.us", idPrefix: "cccountybso", stateName: "California", portalName: "Contra Costa County's BuySpeed marketplace", standardOffsetHours: PT, buyer: "Contra Costa County", location: "Contra Costa County, CA" },
];

export const CA_EBMUD_SOURCE = "ca_ebmud";
export const EBMUD_BIDS_URL = "https://construction-bids.ebmud.com/CurrentorFutureBid.aspx";
const UA = "Mozilla/5.0 (compatible; ContraxBot/1.0; +https://www.contrax.company)";
const MONTHS = ["january", "february", "march", "april", "may", "june", "july", "august", "september", "october", "november", "december"];

/** "December 02, 2026" → 11:59 PM Pacific that day (ISO, DST-aware); null when invalid. PURE. */
export function pacificEndOfDay(v: string): string | null {
  const m = /^([A-Za-z]+)\s+(\d{1,2}),\s*(\d{4})$/.exec(v.replace(/\s+/g, " ").trim());
  if (!m) return null;
  const mo = MONTHS.indexOf(m[1].toLowerCase()) + 1;
  const [d, y] = [+m[2], +m[3]];
  if (mo < 1 || d < 1 || d > 31) return null;
  const fmt = new Intl.DateTimeFormat("en-US", { timeZone: "America/Los_Angeles", year: "numeric", month: "numeric", day: "numeric", hour: "numeric", minute: "numeric", hourCycle: "h23" });
  for (const off of [7, 8]) {
    const t = new Date(Date.UTC(y, mo - 1, d, 23 + off, 59));
    const p = Object.fromEntries(fmt.formatToParts(t).map((x) => [x.type, Number(x.value)]));
    if (p.year === y && p.month === mo && p.day === d && p.hour === 23 && p.minute === 59) return t.toISOString();
  }
  return null;
}

const text = (s: string) => s.replace(/<[^>]+>/g, " ").replace(/&amp;/g, "&").replace(/&nbsp;/g, " ").replace(/\s+/g, " ").trim();

export interface EbmudParseResult extends FetchResult {
  rows: RawBid[];
  skipped: Record<string, number>;
  skippedRows: { id: string; reason: string }[];
}

export function parseEbmudBids(html: string, now: number = Date.now()): EbmudParseResult {
  const at = html.indexOf('id="dgCurrent"');
  if (at < 0) throw new SourceUnreachableError(CA_EBMUD_SOURCE, ["Current bids table missing (page changed)"]);
  const table = html.slice(at, html.indexOf("</table>", at));
  const r: EbmudParseResult = { rows: [], skipped: {}, skippedRows: [] };
  const skip = (id: string, reason: string) => {
    r.skipped[reason] = (r.skipped[reason] ?? 0) + 1;
    r.skippedRows.push({ id, reason });
  };
  const seen = new Set<string>();
  for (const tr of table.matchAll(/<tr>([\s\S]*?)<\/tr>/g)) {
    const cells = [...tr[1].matchAll(/<td\b[^>]*>([\s\S]*?)<\/td>/g)].map((c) => c[1]);
    if (cells.length < 4) continue;
    const href = /href="([^"]+)"/.exec(cells[0])?.[1]?.replace(/&amp;/g, "&");
    const [title, spec, estimate, opening] = cells.map(text);
    const id = spec || href || title;
    if (!title || !spec) { skip(id || "unknown", "missing_fields"); continue; }
    if (/^request for (pre-?)?qualification/i.test(title)) { skip(spec, "not_a_bid"); continue; }
    if (seen.has(spec)) { skip(spec, "duplicate"); continue; }
    seen.add(spec);
    const due = pacificEndOfDay(opening);
    if (!due) { skip(spec, "bad_date"); continue; }
    if (Date.parse(due) <= now) { skip(spec, "closed"); continue; }
    const est = /\$\d/.test(estimate) ? estimate : "";
    r.rows.push({
      external_id: `ebmud-${spec}`,
      title,
      agency: "East Bay Municipal Utility District (EBMUD)",
      location: "Oakland, CA",
      description: `EBMUD construction bid, specification ${spec}: ${title}.${est ? ` Construction estimate ${est}.` : ""} Bid opening ${opening} (the list gives no time; check the specification).`,
      // Every row on this page is a construction bid (the page is "Construction bids").
      category: mapCategory("", title, "construction bid"),
      due_date: due,
      estimated_value: est,
      source_url: href ? new URL(href, EBMUD_BIDS_URL).href : EBMUD_BIDS_URL,
      set_aside: null,
      naics_code: null,
      psc: null,
      solicitation_number: spec,
      notice_type: "ITB",
    });
  }
  return r;
}

export const caDirectDeps = { fetch: (url: string, init: RequestInit) => fetch(url, init) };

export async function fetchCaEbmudBids(now: number = Date.now()): Promise<FetchResult> {
  try {
    const res = await caDirectDeps.fetch(EBMUD_BIDS_URL, { headers: { "user-agent": UA, accept: "text/html" }, signal: AbortSignal.timeout(30000) });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return parseEbmudBids(await res.text(), now);
  } catch (e) {
    if (e instanceof SourceUnreachableError) throw e;
    throw new SourceUnreachableError(CA_EBMUD_SOURCE, [e instanceof Error ? e.message : String(e)]);
  }
}

export const CA_DIRECT_SOURCES: { name: string; fetchFn: () => Promise<FetchResult> }[] = [
  ...CA_COUNTY_BSO.map((c) => ({ name: c.source, fetchFn: () => fetchBsoBids(c) })),
  { name: CA_EBMUD_SOURCE, fetchFn: () => fetchCaEbmudBids() },
];
