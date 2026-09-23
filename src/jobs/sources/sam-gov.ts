/**
 * SAM.gov Procurement Scraper
 *
 * Fetches active federal contract opportunities from SAM.gov's public search API.
 *
 * API discovered via research (2026-07-27):
 * - Endpoint: GET https://sam.gov/api/prod/sgs/v1/search/
 * - Requires browser-like Accept header (text/html, not just application/json)
 * - Query params: page, size, sort, mode, q, is_active
 * - Max 10,000 records accessible (page limit)
 * - Rate limit: add 500ms delay between pages
 *
 * OWNER PRESERVE RULE (PRIORITY 09-21, R2): every ingested row now also carries
 * the PSC, the notice TYPE and SAM's own solicitation number. The first two were
 * previously read to derive `category` and then DISCARDED; the third was used
 * only as an external_id fallback. `mapSamItem` below is the single mapper shared
 * with the trade-filter passes (sam-gov-trades.ts), so both passes preserve the
 * same fields the same way.
 */

import { mapCategory } from "~/lib/trade-classification";
import { failureDetail, FetchFailures, httpFailureDetail } from "../fetch-failure";

export interface RawBid {
  external_id: string;
  title: string;
  agency: string;
  description: string;
  location: string;
  category: string;
  due_date: string | null;
  estimated_value: string;
  source_url: string;
  set_aside?: string | null;
  naics_code?: string | null;
  /**
   * OWNER PRESERVE RULE (09-21, R2): the Product Service Code and the notice
   * TYPE are now carried on the row, from the source's own data (the detail
   * endpoint's `classificationCode`, and the notice `type.value`). NULL means
   * "the source did not supply it" — never guessed.
   */
  psc?: string | null;
  notice_type?: string | null;
  /** SAM's own solicitation number (the cross-source join key for R5). */
  solicitation_number?: string | null;
  /** Which pass produced the row (national/regional, or a trade-filter pass —
   *  see sam-gov-trades.ts). Stored as the row's `source` value. */
  source_label?: string;
  /**
   * NATIONWIDE CORRECTNESS FIX ⑤ (owner-locked scope, PR B1): the canonical
   * SAM.gov NOTICE identity of the search item this row came from
   * (`parentNoticeId || _id` — see `canonicalNoticeId()`).
   *
   * It is the key of the RUN-LEVEL notice-identity guard
   * (src/jobs/notice-identity.ts): every SAM.gov-family pass in one run
   * (sam_gov / sam_gov_regional, cities, the 51 state-keyword doors, the 11
   * trade passes) claims its notice ids, so a notice returned by several
   * queries is stored ONCE. Absent for rows from non-SAM sources (PennBid,
   * oh_dayton, the city open-data portals) — those are never governed by the
   * guard, and absence is never invented into an identity.
   *
   * Deliberately NOT a DB column: it only exists for the duration of a run.
   */
  notice_key?: string | null;
}

/**
 * The canonical SAM.gov notice identity of a v1 search item.
 *
 * `parentNoticeId || _id` is the expression the state-keyword doors have always
 * used to build the notice URL (state-keyword.ts) — SAM's `_id` is the notice
 * VERSION id (it can change when a notice is amended), while `parentNoticeId`
 * points at the stable parent notice. Two different passes that see the same
 * notice therefore compute the SAME identity, which is exactly what the
 * run-level identity guard needs (cross-door identity must be stable; the
 * per-door `<st>-<_id>` external_id was not).
 *
 * Returns null when the item carries no id at all — an unknown identity is
 * never guessed and never suppressed.
 */
export function canonicalNoticeId(item: any): string | null {
  const raw = item?.parentNoticeId || item?._id;
  if (raw === null || raw === undefined) return null;
  const id = String(raw).trim();
  return id === "" ? null : id;
}

const SAM_API = "https://sam.gov/api/prod/sgs/v1/search/";
const PAGE_SIZE = 25;
const MAX_PAGES = 4; // Fetch up to 100 bids per sync
const DELAY_MS = 500;

export const SAM_HEADERS = {
  "User-Agent":
    "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
  Accept:
    "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
};

export function stripHtml(html: string): string {
  return html
    .replace(/<[^>]*>/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\s+/g, " ")
    .trim();
}

export function extractLocation(orgHierarchy: any[], description: string): string {
  // Try to extract state/city from the deepest org name (often includes location)
  const deepest = orgHierarchy?.[orgHierarchy.length - 1];
  if (deepest?.name) {
    const name = deepest.name;
    // Common patterns: "W6QM MICC-FORT BUCHANAN (RC)", "FA2823 AFTC PZIO"
    const stateMatch = name.match(/\(([A-Z]{2})\)/);
    if (stateMatch) return stateMatch[1];
  }

  // Try extracting from description
  const locPatterns = [
    /\b([A-Z][a-z]+,\s*(?:AL|AK|AZ|AR|CA|CO|CT|DE|FL|GA|HI|ID|IL|IN|IA|KS|KY|LA|ME|MD|MA|MI|MN|MS|MO|MT|NE|NV|NH|NJ|NM|NY|NC|ND|OH|OK|OR|PA|RI|SC|SD|TN|TX|UT|VT|VA|WA|WV|WI|WY|DC|PR|GU|VI|AS|MP))\b/,
    /\b(?:in|at|near)\s+([A-Z][a-z]+(?:\s+[A-Z][a-z]+)*,\s*(?:AL|AK|AZ|AR|CA|CO|CT|DE|FL|GA|HI|ID|IL|IN|IA|KS|KY|LA|ME|MD|MA|MI|MN|MS|MO|MT|NE|NV|NH|NJ|NM|NY|NC|ND|OH|OK|OR|PA|RI|SC|SD|TN|TX|UT|VT|VA|WA|WV|WI|WY|DC))\b/i,
  ];

  for (const pattern of locPatterns) {
    const match = description.match(pattern);
    if (match) return match[1];
  }

  return "United States";
}

const DETAIL_API = "https://sam.gov/api/prod/opps/v2/opportunities/";

/**
 * Normalizes a raw SAM.gov set-aside value (code or label) into a display label.
 * Codes observed from SAM.gov: "SBA" (SBA Certified 8(a) Program), "SDVOSBC",
 * "VOSBC", "WOSB", "EDWOSB", "HZC", "NONE". Accepts strings or {code, value}
 * objects (e.g. {code: "8a", value: "SBA Certified 8(a) Program"}).
 */
export function normalizeSetAside(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  let v = String(value).trim();
  if (!v || /^(none|no|not set aside|n\/a|na)$/i.test(v)) return null;
  const lower = v.toLowerCase();
  const map: Record<string, string> = {
    sba: "8(a)",
    "8a": "8(a)",
    "8(a)": "8(a)",
    sdvosbc: "SDVOSB",
    sdvosb: "SDVOSB",
    "service-disabled": "SDVOSB",
    vosbc: "VOSB",
    vosb: "VOSB",
    wosb: "WOSB",
    edwosb: "EDWOSB",
    "wosb/edwosb": "WOSB/EDWOSB",
    hzc: "HUBZone",
    hubzone: "HUBZone",
    hub: "HUBZone",
    mbe: "MBE",
    wbe: "WBE",
    dbe: "DBE",
  };
  if (map[lower]) return map[lower];
  if (lower.includes("8(a)") || (lower.includes("8a") && lower.includes("sba"))) return "8(a)";
  if (lower.includes("service-disabled") || lower.includes("sdvosb")) return "SDVOSB";
  if (lower.includes("economically disadvantaged")) return "EDWOSB";
  if (lower.includes("women-owned") || lower.includes("women owned") || lower.includes("wosb")) return "WOSB";
  if (lower.includes("veteran-owned") || lower.includes("veteran owned") || lower.includes("vosb")) return "VOSB";
  if (lower.includes("hubzone") || lower.includes("hub zone")) return "HUBZone";
  if (lower.includes("minority")) return "Minority-Owned";
  if (lower.includes("disadvantaged")) return "Disadvantaged";
  return v;
}

/**
 * Extracts a set-aside designation from a SAM.gov search-result item.
 * The v1 search response usually does not carry the field, so this checks any
 * structured field that could be present (setAside / typeOfSetAside /
 * setAsideType / data2.solicitation.setAside) and falls back to scanning the
 * opportunity text for "set aside" phrases.
 */
export function extractSetAsideFromItem(item: any, description: string): string | null {
  const candidates = [
    item?.setAside,
    item?.typeOfSetAside,
    item?.setAsideType,
    item?.data2?.solicitation?.setAside,
  ];
  for (const c of candidates) {
    const raw = typeof c === "object" && c !== null ? c?.value ?? c?.code ?? c : c;
    const label = normalizeSetAside(raw);
    if (label) return label;
  }

  const text = `${item?.title || ""} ${description}`.toLowerCase().replace(/\s+/g, " ");
  const idx = text.indexOf("set-aside") >= 0 ? text.indexOf("set-aside") : text.indexOf("set aside");
  if (idx >= 0) {
    const window = text.slice(Math.max(0, idx - 100), idx + 100);
    const pairs: [RegExp, string][] = [
      [/\b8\s?\(\s?a\s?\)|sba certified/, "8(a)"],
      [/\bedwosb\b/, "EDWOSB"],
      [/\bsdvosb\b|service[- ]disabled/, "SDVOSB"],
      [/\bwosb\b|women[- ]owned/, "WOSB"],
      [/\bhubzone\b|hub[- ]?zone/, "HUBZone"],
      [/\bvosb\b|veteran[- ]owned/, "VOSB"],
    ];
    for (const [re, label] of pairs) if (re.test(window)) return label;
  }
  return null;
}

/** The notice-type label from a v1 search item ({code, value}). */
export function extractNoticeType(item: any): string | null {
  const t = item?.type;
  const value = typeof t === "object" && t !== null ? t?.value ?? t?.code : t;
  const v = String(value ?? "").trim();
  return v || null;
}

/** A PSC/classification code is 1 letter + 3 digits (S201, V112, R602, …). */
export function normalizePsc(value: unknown): string | null {
  const v = String(value ?? "").trim().toUpperCase();
  return /^[A-Z][0-9]{3}$/.test(v) ? v : null;
}

/**
 * Fetches the authoritative set-aside designation, primary NAICS code AND the
 * Product Service Code from the SAM.gov opportunity detail endpoint:
 *   - set-aside: data2.solicitation.setAside
 *   - NAICS:     data2.naics = [{ code: ["236220"], type: "primary" }]
 *   - PSC:       data2.classificationCode   (owner 09-21, R2)
 *   - notice type / solicitation number: data2.type / data2.solicitationNumber
 * Best-effort: any failure returns nulls so a detail fetch can never break
 * the sync. The search summary never includes these fields, so this detail
 * call is the only source for them.
 */
export interface OpportunityDetail {
  setAside: string | null;
  naicsCode: string | null;
  psc: string | null;
  noticeType: string | null;
  solicitationNumber: string | null;
}

const EMPTY_DETAIL: OpportunityDetail = {
  setAside: null,
  naicsCode: null,
  psc: null,
  noticeType: null,
  solicitationNumber: null,
};

/**
 * Place-of-performance shape from the SAM.gov v2 detail endpoint
 * (data2.placeOfPerformance): { zip, city: {code, name}, state: {code, name},
 * country, streetAddress }.
 */
export interface PlaceOfPerformance {
  zip?: string | null;
  city?: { name?: string } | null;
  state?: { code?: string; name?: string } | null;
  country?: { code?: string; name?: string } | null;
  streetAddress?: string | null;
}

/**
 * The detail payload PLUS the authoritative place-of-performance — the shape the
 * state-keyword doors need (they already fetched the SAME v2 payload for POP
 * only; FIX ⑤ step A makes that one call also carry the PSC / notice type /
 * solicitation number instead of discarding them).
 */
export interface OpportunityDetailWithLocation extends OpportunityDetail {
  placeOfPerformance: PlaceOfPerformance | null;
}

const EMPTY_DETAIL_FULL: OpportunityDetailWithLocation = {
  ...EMPTY_DETAIL,
  placeOfPerformance: null,
};

/**
 * PURE parse of a v2 opportunity payload (no network) — the single place the
 * detail's set-aside / NAICS / PSC / notice type / solicitation number /
 * place-of-performance are read out, so every caller sees them identically.
 */
export function parseOpportunityDetail(data: any): OpportunityDetailWithLocation {
  const setAside = normalizeSetAside(data?.data2?.solicitation?.setAside);
  // data2.naics is an array of { code: string[], type: "primary" } objects.
  let naicsCode: string | null = null;
  const naicsArr = Array.isArray(data?.data2?.naics) ? data.data2.naics : [];
  const primary = naicsArr.find((n: any) => n?.type === "primary") ?? naicsArr[0];
  const firstCode = Array.isArray(primary?.code) ? primary.code[0] : primary?.code;
  if (firstCode && /^\d{2,6}$/.test(String(firstCode).trim())) {
    naicsCode = String(firstCode).trim();
  } else {
    // Fall back to the solicitation-level field if the naics array is absent.
    const sol = data?.data2?.solicitation?.naicsCode ?? data?.data2?.solicitation?.naicsCodes?.[0];
    if (sol && /^\d{2,6}$/.test(String(sol).trim())) naicsCode = String(sol).trim();
  }
  // Owner PRESERVE rule (R2): the PSC lives ONLY here.
  const psc = normalizePsc(data?.data2?.classificationCode);
  const solNumRaw = data?.data2?.solicitationNumber;
  const solicitationNumber =
    solNumRaw == null || String(solNumRaw).trim() === ""
      ? null
      : String(solNumRaw).trim();
  // The detail's own type field is a CODE ("o"), so it is only a fallback for
  // the summary's human-readable label.
  const detailType = data?.data2?.type;
  const noticeType =
    typeof detailType === "string"
      ? String(detailType).trim() || null
      : typeof detailType === "object" && detailType !== null
        ? String(detailType?.value ?? detailType?.code ?? "").trim() || null
        : null;
  // Place of performance: the v1 search summary never carries it, so it is the
  // one field the state-keyword doors need from this same payload.
  const placeOfPerformance =
    (data?.data2?.placeOfPerformance as PlaceOfPerformance | undefined) ?? null;
  return {
    setAside,
    naicsCode,
    psc,
    noticeType,
    solicitationNumber,
    placeOfPerformance,
  };
}

/**
 * Fetches the v2 detail payload (set-aside, NAICS, PSC, notice type,
 * solicitation number AND place-of-performance) in ONE request. Best-effort:
 * any failure returns the empty shape, so a detail fetch can never break a sync.
 */
export async function fetchOpportunityDetailFull(
  noticeId: string,
): Promise<OpportunityDetailWithLocation> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 10000);
  try {
    const resp = await fetch(`${DETAIL_API}${noticeId}`, {
      headers: SAM_HEADERS,
      signal: controller.signal,
    });
    if (!resp.ok) return { ...EMPTY_DETAIL_FULL };
    return parseOpportunityDetail(await resp.json());
  } catch {
    return { ...EMPTY_DETAIL_FULL };
  } finally {
    clearTimeout(timer);
  }
}

/**
 * The provenance half of the same payload — identical network behavior to
 * `fetchOpportunityDetailFull` (one request, same endpoint/headers/timeout);
 * callers that do not need place-of-performance keep this contract.
 */
export async function fetchOpportunityDetail(
  noticeId: string,
): Promise<OpportunityDetail> {
  const full = await fetchOpportunityDetailFull(noticeId);
  return {
    setAside: full.setAside,
    naicsCode: full.naicsCode,
    psc: full.psc,
    noticeType: full.noticeType,
    solicitationNumber: full.solicitationNumber,
  };
}

export function extractNaicsCode(item: any): string | null {
  const candidates = [item?.naicsCode, item?.naics_code, item?.data2?.solicitation?.naicsCode, item?.data2?.solicitation?.naicsCodes?.[0], item?.naics?.[0]?.code, item?.naics?.code];
  for (const value of candidates) {
    const code = typeof value === "object" && value !== null ? value.code ?? value.value : value;
    if (code && /^\d{2,6}$/.test(String(code).trim())) return String(code).trim();
  }
  return null;
}

export interface MapSamItemOptions {
  /** Value stored as the row's `source` (national pass or trade pass). */
  sourceLabel: string;
  /**
   * Values already known AUTHORITATIVELY from the pass's own structured filter
   * (`naics=<code>` / `psc=<code>`): the source itself returned the notice FOR
   * that code, so no detail call is needed to establish it. The trade passes
   * (sam-gov-trades.ts) supply these; the national pass supplies neither.
   */
  filterNaics?: string | null;
  filterPsc?: string | null;
  /** 120ms politeness delay after a detail fetch (default true). */
  detailDelay?: boolean;
  /** Last-resort external_id suffix when the item carries no id (the national
   *  pass passes `page<n>-<index>`, preserving its pre-existing behavior). */
  fallbackId?: string;
  /** Detail fetcher override (deterministic tests inject saved fixtures). */
  detailFetcher?: (noticeId: string) => Promise<OpportunityDetail>;
}

/**
 * Maps ONE SAM.gov v1 search item into a RawBid — the single mapping used by
 * both the national/regional pass and the per-code trade passes, so provenance
 * (source, notice type, eligibility, location, deadline, PSC, NAICS) is
 * preserved identically everywhere.
 *
 * Best-effort per row: a malformed item throws only inside the caller's
 * try/catch, exactly as before.
 */
export async function mapSamItem(
  item: any,
  opts: MapSamItemOptions,
): Promise<RawBid> {
  const descContent = item.descriptions?.[0]?.content || "";
  const description = stripHtml(descContent).substring(0, 2000);

  const orgs = item.organizationHierarchy || [];
  const deepestOrg = orgs[orgs.length - 1];
  const agency = deepestOrg?.name || "Federal Agency";

  const location = extractLocation(orgs, description);
  const category = mapCategory(item.type?.value || "", item.title, description);

  const dueDate = item.responseDate || item.responseDateActual || null;

  // Try to get value from award info
  let estimatedValue = "Not specified";
  if (item.award?.amount) {
    estimatedValue = `$${Number(item.award.amount).toLocaleString()}`;
  }

  const noticeId = canonicalNoticeId(item) ?? "";
  const sourceUrl = noticeId
    ? `https://sam.gov/opp/${noticeId}/view`
    : "https://sam.gov/search/";

  // Notice type + solicitation number come from the SUMMARY itself (the v1 item
  // carries both — they simply were not stored before, R2).
  let noticeType = extractNoticeType(item);
  let solicitationNumber =
    item.solicitationNumber == null || String(item.solicitationNumber).trim() === ""
      ? null
      : String(item.solicitationNumber).trim();

  // Set-aside + NAICS + PSC: the search summary never includes them, so pull the
  // opportunity detail when any one is missing. A trade pass already knows its
  // own filtered code (authoritative), so that code is never guessed again.
  let setAside = extractSetAsideFromItem(item, description);
  let naicsCode = opts.filterNaics ?? extractNaicsCode(item);
  let psc = opts.filterPsc ?? null;
  if (noticeId && (!setAside || !naicsCode || !psc)) {
    const fetchDetail = opts.detailFetcher ?? fetchOpportunityDetail;
    const detail = await fetchDetail(noticeId);
    if (!setAside) setAside = detail.setAside;
    if (!naicsCode) naicsCode = detail.naicsCode;
    if (!psc) psc = detail.psc;
    if (!noticeType) noticeType = detail.noticeType;
    if (!solicitationNumber) solicitationNumber = detail.solicitationNumber;
    if (opts.detailDelay !== false) await new Promise((r) => setTimeout(r, 120));
  }

  return {
    external_id: `sam-${item._id || item.solicitationNumber || opts.fallbackId || ""}`,
    title: item.title || "Untitled Opportunity",
    agency,
    description,
    location,
    category,
    due_date: dueDate,
    estimated_value: estimatedValue,
    source_url: sourceUrl,
    set_aside: setAside,
    naics_code: naicsCode,
    psc,
    notice_type: noticeType,
    solicitation_number: solicitationNumber,
    source_label: opts.sourceLabel,
    // FIX ⑤: the run-level identity guard's key (null when the item has no id).
    notice_key: noticeId || null,
  };
}

export async function fetchBids(options: { states?: string[] } = {}): Promise<RawBid[]> {
  const states = options.states?.filter((state) => /^[A-Z]{2}$/.test(state)).join(",");
  const sourceLabel = states ? "sam_gov_regional" : "sam_gov";
  const results: RawBid[] = [];
  // DEAD-COLLECTOR CLASSIFICATION (owner 09-23, item ③): a failed page request is
  // recorded, and if NO page yielded items the pass throws (errors > 0,
  // rows_fetched = 0 ⇒ DEAD) instead of returning a silent empty. A 200 with no
  // items records nothing and stays the honest EMPTY it is.
  const failures = new FetchFailures();

  for (let page = 0; page < MAX_PAGES; page++) {
    try {
      const stateFilter = states ? `&placeOfPerformance.state=${states}` : "";
      const url = `${SAM_API}?page=${page}&size=${PAGE_SIZE}&sort=-modifiedDate&mode=opportunities&q=&is_active=true${stateFilter}`;
      console.log(`  SAM.gov: fetching page ${page + 1}/${MAX_PAGES}...`);

      const resp = await fetch(url, { headers: SAM_HEADERS });
      if (!resp.ok) {
        console.error(`  SAM.gov page ${page} returned ${resp.status}`);
        failures.record(httpFailureDetail(resp.status, url));
        // If we get a non-200 on page > 0, we might have hit the end
        if (page > 0) break;
        continue;
      }

      const data = await resp.json();
      // The pass ANSWERED: reachable even when the page holds no items (honest
      // EMPTY), so a zero-row page must never be reported as a dead source.
      if (data && typeof data === "object") failures.markReadable();
      const items = data?._embedded?.results;
      if (!items || items.length === 0) break;

      for (const [index, item] of items.entries()) {
        try {
          results.push(
            await mapSamItem(item, {
              sourceLabel,
              fallbackId: `page${page}-${index}`,
            }),
          );
        } catch (e) {
          console.error(`  SAM.gov: error parsing item:`, (e as Error).message);
        }
      }

      console.log(`  SAM.gov page ${page + 1}: got ${items.length} items (total collected: ${results.length})`);

      // If fewer results than page size, we're at the end
      if (items.length < PAGE_SIZE) break;

      // Rate limit delay
      await new Promise((r) => setTimeout(r, DELAY_MS));
    } catch (e) {
      const detail = failureDetail(e);
      console.error(`  SAM.gov page ${page} error:`, detail);
      failures.record(detail);
      // Continue to next page anyway
    }
  }

  // No page readable at all ⇒ the pass could not read SAM.gov: fail it so the run
  // record carries an error (DEAD) instead of an honest-looking zero.
  failures.assertReached(sourceLabel, results.length);
  return results;
}
