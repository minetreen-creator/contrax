/**
 * Florida MyFloridaMarketPlace (MFMP) Vendor Bid System — `fl_mfmp`.
 *
 * WHY: Contrax had no state Florida feed; its Florida rows came only from the
 * federal SAM.gov "fl" keyword pass. Florida state agencies (FDOT, FWC, FDACS,
 * FDC, DEP, DMS, DCF, DOH, …) advertise their bids on the MFMP Vendor Bid
 * System at vendor.myfloridamarketplace.com.
 *
 * SOURCE (verified live 2026-10-01, no auth, no CAPTCHA): the public
 * /search/bids page is an Angular app whose search POSTs JSON to
 * /mfmp/pub/search/bids (its "PUB_BID_SEARCH" endpoint). This connector sends
 * `{ status: ["OPEN"], page, pageSize: 100 }` (100 is the server's page cap;
 * pages are 1-based) and pages until a short page. 163 OPEN advertisements on
 * 2026-10-01.
 *
 * WHAT IS KEPT: advertisement types a business can respond to — Invitation to
 * Bid, Invitation to Negotiate, Request for Proposals, Request for
 * Information, Request for Statement of Qualifications. Agency Decisions
 * (intended-award notices), Grant Opportunities, Informational Notices, Public
 * Meeting Notices and Single Source notices are skipped with a reason code, as
 * are non-OPEN rows and rows whose close date has passed.
 *
 * WHAT A ROW BECOMES (data honesty — never manufacture, relabel, or loosen):
 *   - `title`               = `title`, verbatim.
 *   - `agency`              = `agency` (e.g. "Florida Department of
 *                             Transportation (FDOT)").
 *   - `location`            = "Florida" — the list has no place of
 *                             performance; every MFMP buyer is a Florida state
 *                             entity.
 *   - `due_date`            = `closeDate` (an absolute UTC timestamp).
 *   - `solicitation_number` = `agencyAdNumber`; `notice_type` = `type`.
 *   - `description`         = the advertisement's type, number and publish
 *                             date (not the buyer: trade matching reads it) (the list has no summary; the full
 *                             text and documents are on the linked page).
 *   - `source_url`          = https://vendor.myfloridamarketplace.com/search/bids/detail/<advertisementId>
 *   - `naics_code` / `psc` / `set_aside` stay NULL.
 *
 * IDENTITY: `external_id = mfmp-<advertisementId>`; an edited advertisement
 * keeps its id (its `version` increments), so the upsert refreshes the row.
 */
import { mapCategory } from "~/lib/trade-classification";
import type { FetchResult } from "../runner";
import {
  httpFailureDetail,
  requestFailureDetail,
  SourceUnreachableError,
} from "../fetch-failure";
import type { RawBid } from "./sam-gov";

export const MFMP_ORIGIN = "https://vendor.myfloridamarketplace.com";
export const MFMP_SEARCH_PAGE = `${MFMP_ORIGIN}/search/bids`;
export const MFMP_SEARCH_API = `${MFMP_ORIGIN}/mfmp/pub/search/bids`;
export const MFMP_PAGE_SIZE = 100;
export const MFMP_MAX_PAGES = 30;
const MFMP_PAGE_DELAY_MS = 300;

export const MFMP_HEADERS = {
  "User-Agent":
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
  "Content-Type": "application/json",
  Accept: "application/json, text/plain, */*",
  Referer: MFMP_SEARCH_PAGE,
  Origin: MFMP_ORIGIN,
} as const;

/** Advertisement types a business can respond to. */
export const MFMP_BIDDABLE_TYPES = new Set([
  "invitation to bid",
  "invitation to negotiate",
  "request for proposals",
  "request for information",
  "request for statement of qualifications",
]);

export interface MfmpAd {
  advertisementId?: number | string;
  agencyAdNumber?: string;
  type?: string;
  title?: string;
  openDate?: string;
  closeDate?: string;
  publishDate?: string;
  status?: string;
  agency?: string;
  organization?: { name?: string; shortName?: string };
}

export interface MfmpParseResult {
  rows: RawBid[];
  skipped: Record<string, number>;
  skippedRows: { id: string; reason: string }[];
}

const clean = (v: unknown) => String(v ?? "").replace(/[\u0000-\u001f\u007f]+/g, " ").replace(/\s+/g, " ").trim();

export function mfmpDetailUrl(advertisementId: string | number): string {
  return `${MFMP_ORIGIN}/search/bids/detail/${encodeURIComponent(String(advertisementId))}`;
}

function isoOrNull(value: string | null | undefined): string | null {
  if (!value) return null;
  const t = Date.parse(value);
  return Number.isNaN(t) ? null : new Date(t).toISOString();
}

function recordSkip(result: MfmpParseResult, id: string, reason: string) {
  result.skipped[reason] = (result.skipped[reason] ?? 0) + 1;
  result.skippedRows.push({ id, reason });
}

/** PURE parse — no network, no DB; `now` is injected. */
export function parseMfmpAds(ads: readonly MfmpAd[], now: number = Date.now()): MfmpParseResult {
  const result: MfmpParseResult = { rows: [], skipped: {}, skippedRows: [] };
  const seen = new Set<string>();
  for (const ad of ads) {
    const id = clean(ad.advertisementId);
    if (!id) {
      recordSkip(result, "mfmp-unknown", "missing_id");
      continue;
    }
    const rowId = `mfmp-${id}`;
    if (seen.has(rowId)) continue;
    seen.add(rowId);

    if (clean(ad.status).toUpperCase() !== "OPEN") {
      recordSkip(result, rowId, "not_open");
      continue;
    }
    const type = clean(ad.type);
    if (!MFMP_BIDDABLE_TYPES.has(type.toLowerCase())) {
      recordSkip(result, rowId, "not_biddable_type");
      continue;
    }
    const title = clean(ad.title);
    if (!title) {
      recordSkip(result, rowId, "missing_title");
      continue;
    }
    const due = isoOrNull(ad.closeDate);
    if (due && Date.parse(due) < now) {
      recordSkip(result, rowId, "closed");
      continue;
    }

    const agency = clean(ad.agency) || clean(ad.organization?.name) || "State of Florida (MFMP)";
    const number = clean(ad.agencyAdNumber);
    const published = isoOrNull(ad.publishDate);
    const description = [
      // The buyer is not repeated here (trade matching reads the description and
      // agency names contain trade words, e.g. "Florida Highway Patrol").
      `${type}${number ? ` ${number}` : ""} advertised on the MyFloridaMarketPlace Vendor Bid System${
        published ? ` on ${published.slice(0, 10)}` : ""
      }.`,
      "The full advertisement and documents are on the MFMP notice (see source link).",
    ].join(" ");

    result.rows.push({
      external_id: rowId,
      title,
      agency,
      description,
      location: "Florida",
      category: mapCategory("", title, description),
      due_date: due,
      estimated_value: "Not specified",
      source_url: mfmpDetailUrl(id),
      set_aside: null,
      notice_type: type || null,
      solicitation_number: number || null,
      naics_code: null,
      psc: null,
    });
  }
  return result;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function fetchPage(page: number): Promise<MfmpAd[]> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 30000);
  let resp: Response;
  try {
    resp = await fetch(MFMP_SEARCH_API, {
      method: "POST",
      headers: MFMP_HEADERS,
      body: JSON.stringify({ status: ["OPEN"], page, pageSize: MFMP_PAGE_SIZE }),
      signal: controller.signal,
    });
  } catch (e) {
    const detail = requestFailureDetail(e);
    console.error(`  fl_mfmp: ${detail}`);
    throw new SourceUnreachableError("fl_mfmp", [detail]);
  } finally {
    clearTimeout(timer);
  }
  if (resp.status !== 200) {
    const detail = httpFailureDetail(resp.status, MFMP_SEARCH_API);
    console.error(`  fl_mfmp: ${detail}`);
    throw new SourceUnreachableError("fl_mfmp", [detail]);
  }
  const text = await resp.text();
  let body: unknown;
  try {
    body = JSON.parse(text);
  } catch {
    const detail = `response was not JSON (${text.length} bytes)`;
    console.error(`  fl_mfmp: ${detail}`);
    throw new SourceUnreachableError("fl_mfmp", [detail]);
  }
  if (!Array.isArray(body)) {
    const detail = "response shape changed: expected an array of advertisements";
    console.error(`  fl_mfmp: ${detail}`);
    throw new SourceUnreachableError("fl_mfmp", [detail]);
  }
  return body as MfmpAd[];
}

/** Fetch every OPEN MFMP advertisement and return ingest rows. */
export async function fetchFlMfmpBids(now: number = Date.now()): Promise<FetchResult> {
  const ads: MfmpAd[] = [];
  for (let page = 1; page <= MFMP_MAX_PAGES; page++) {
    const pageAds = await fetchPage(page);
    ads.push(...pageAds);
    if (pageAds.length < MFMP_PAGE_SIZE) break;
    await sleep(MFMP_PAGE_DELAY_MS);
  }
  const { rows, skipped, skippedRows } = parseMfmpAds(ads, now);
  console.log(
    `  fl_mfmp: ${rows.length} open solicitations accepted (read ${ads.length}; skips: ${
      Object.entries(skipped)
        .map(([r, n]) => `${r}=${n}`)
        .join(", ") || "none"
    })`,
  );
  return { rows, skipped, skippedRows };
}
