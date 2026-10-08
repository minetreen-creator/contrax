/**
 * Alaska Department of Transportation & Public Facilities construction bid
 * calendar — `ak_dotpf`.
 *
 * WHY: Alaska's statewide Online Public Notices site sits behind bot protection
 * (a "Please enable JS" wall); Contrax does not get around bot protection, so
 * it is out (owner 2026-10-08). DOT&PF's own Construction Bid Calendar is
 * public and covers the state's highway, airport, building and Marine Highway
 * construction over $100,000 — the large Alaska jobs, which had no state
 * source at all (Alaska showed only federal SAM.gov bids).
 *
 * SOURCE (verified live 2026-10-08, no login, no challenge): the calendar page
 * https://dot.alaska.gov/procurement/awp/bids.html loads its list from
 *   GET https://dot.alaska.gov/procurement/awp/api/bids
 * an OData-shaped JSON `{ value: [ … ] }`, one item per proposal:
 *   { Name: "CDRER01536", Description: "Talkeetna Spur MP 13.5 Emergency Erosion Protection",
 *     LongDescr: "…", StateProjectNumber, FederalProjectNumber, Community: "Talkeetna",
 *     PrimaryRefDistrict: { Description: "Central Region" },
 *     Letting: { LettingDate: "2026-10-09T00:00:00-08:00", LettingTime: "2:00 PM", … },
 *     estRange: "Between $2,500,000 and $5,000,000", OJT: "None" }
 *
 * WHAT A ROW BECOMES (data honesty — never manufacture, relabel, or loosen):
 *   - `title`       = "<Description> — Alaska DOT&PF contract <Name>, <Community>"
 *                     (Description exactly as DOT&PF wrote it).
 *   - `category`    = "Construction": every proposal on this calendar is a
 *                     construction letting (the text classifier would read
 *                     "Airport Relocation" as moving work).
 *   - `agency`      = "Alaska Department of Transportation & Public Facilities".
 *   - `location`    = "<Community>, Alaska", or "Alaska" for "Statewide"/blank.
 *   - `due_date`    = the letting date and time (bids are due then), in Alaska time.
 *   - `estimated_value` = DOT&PF's engineer's estimate range, as printed.
 *   - `source_url`  = the public calendar page (the per-proposal link goes to
 *                     Bid Express, which needs an account).
 *   - `solicitation_number` = the contract number (`Name`);
 *     `notice_type` = "Construction letting".
 *   - `naics_code` / `psc` / `set_aside` stay NULL.
 * Proposals whose letting time has passed are skipped (`closed`).
 *
 * IDENTITY: `external_id = akdotpf-<Name>` — the contract number is DOT&PF's
 * own unique key for the proposal.
 */
import type { FetchResult } from "../runner";
import { httpFailureDetail, requestFailureDetail, SourceUnreachableError } from "../fetch-failure";
import type { RawBid } from "./sam-gov";

export const AKDOTPF_SOURCE = "ak_dotpf";
export const AKDOTPF_PAGE_URL = "https://dot.alaska.gov/procurement/awp/bids.html";
export const AKDOTPF_API_URL = "https://dot.alaska.gov/procurement/awp/api/bids";
const AKDOTPF_AGENCY = "Alaska Department of Transportation & Public Facilities";

const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36";

export interface AkDotpfItem {
  Name?: string | null;
  Description?: string | null;
  LongDescr?: string | null;
  StateProjectNumber?: string | null;
  FederalProjectNumber?: string | null;
  Community?: string | null;
  PrimaryRefDistrict?: { Description?: string | null } | null;
  Letting?: { LettingDate?: string | null; LettingTime?: string | null } | null;
  estRange?: string | null;
  OJT?: string | null;
}

export interface AkDotpfParseResult {
  rows: RawBid[];
  skipped: Record<string, number>;
  skippedRows: { id: string; reason: string }[];
}

function clean(s: unknown): string {
  return typeof s === "string" ? s.replace(/\s+/g, " ").trim() : "";
}

/** Alaska offset (hours): AKDT −8 from the 2nd Sunday of March to the 1st Sunday of November, else AKST −9. */
function alaskaOffset(year: number, month: number, day: number): number {
  const dstStart = Date.UTC(year, 2, 8 + ((7 - new Date(Date.UTC(year, 2, 8)).getUTCDay()) % 7));
  const dstEnd = Date.UTC(year, 10, 1 + ((7 - new Date(Date.UTC(year, 10, 1)).getUTCDay()) % 7));
  const day0 = Date.UTC(year, month - 1, day);
  return day0 >= dstStart && day0 < dstEnd ? -8 : -9;
}

/** ("2026-10-09T00:00:00-08:00", "2:00 PM") → 2026-10-09T22:00:00.000Z (Alaska time). Invalid → null. */
export function akLettingToIso(lettingDate: string, lettingTime: string): string | null {
  const d = clean(lettingDate).match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!d) return null;
  const [year, month, day] = [Number(d[1]), Number(d[2]), Number(d[3])];
  // DOT&PF writes "2:00 PM" (the page's own converter also expects "p.m.").
  const t = clean(lettingTime).match(/^(\d{1,2}):(\d{2})\s*([ap])\.?\s*m\.?$/i);
  let hour = 14; // "Unless otherwise noted, bids are due before 2:00 PM local time."
  let minute = 0;
  if (t) {
    hour = Number(t[1]);
    minute = Number(t[2]);
    if (hour < 1 || hour > 12 || minute > 59) return null;
    if (t[3]!.toLowerCase() === "p" && hour !== 12) hour += 12;
    if (t[3]!.toLowerCase() === "a" && hour === 12) hour = 0;
  } else if (clean(lettingTime)) {
    return null;
  }
  if (month < 1 || month > 12 || day < 1 || day > 31) return null;
  const utc = Date.UTC(year, month - 1, day, hour, minute) - alaskaOffset(year, month, day) * 3_600_000;
  return new Date(utc).toISOString();
}

/** "Talkeetna" → "Talkeetna, Alaska"; "Statewide" / "" → "Alaska". */
export function akLocation(community: string): string {
  const c = clean(community);
  return c && !/^statewide$/i.test(c) ? `${c}, Alaska` : "Alaska";
}

function recordSkip(result: AkDotpfParseResult, id: string, reason: string) {
  result.skipped[reason] = (result.skipped[reason] ?? 0) + 1;
  result.skippedRows.push({ id, reason });
}

/** PURE parse — no network, no DB; `now` is injected. */
export function parseAkDotpf(items: readonly AkDotpfItem[], now: number = Date.now()): AkDotpfParseResult {
  const result: AkDotpfParseResult = { rows: [], skipped: {}, skippedRows: [] };
  const seen = new Set<string>();
  for (const [i, item] of items.entries()) {
    const name = clean(item.Name);
    const rowId = name ? `akdotpf-${name}` : `akdotpf-row-${i}`;
    if (!name) {
      recordSkip(result, rowId, "missing_id");
      continue;
    }
    if (seen.has(rowId)) continue;
    seen.add(rowId);
    const work = clean(item.Description);
    if (!work) {
      recordSkip(result, rowId, "missing_title");
      continue;
    }
    const due = item.Letting ? akLettingToIso(clean(item.Letting.LettingDate), clean(item.Letting.LettingTime)) : null;
    if (!due) {
      recordSkip(result, rowId, "missing_letting");
      continue;
    }
    if (Date.parse(due) <= now) {
      recordSkip(result, rowId, "closed");
      continue;
    }
    const community = clean(item.Community);
    const place = community && !/^statewide$/i.test(community) ? community : "Statewide";
    const region = clean(item.PrimaryRefDistrict?.Description);
    const range = clean(item.estRange);
    const federal = clean(item.FederalProjectNumber);
    const ojt = clean(item.OJT);
    const title = `${work} — Alaska DOT&PF contract ${name}, ${place}`;
    const parts = [
      `Alaska DOT&PF construction letting${region ? ` (${region})` : ""}: contract ${name}, ${place}.`,
      clean(item.LongDescr),
      clean(item.StateProjectNumber) ? `IRIS program number ${clean(item.StateProjectNumber)}.` : "",
      federal ? `Federal project number ${federal}.` : "",
      ojt && !/^none$/i.test(ojt) ? `On-the-job trainees: ${ojt}.` : "",
      range ? `Engineer's estimate range: ${range}.` : "",
      "Bidders must be on DOT&PF's AASHTOWare Project vendor list; plans and bidding are through Bid Express (see the DOT&PF bid calendar).",
    ];
    const description = parts.filter(Boolean).join(" ");
    result.rows.push({
      external_id: rowId,
      title,
      agency: AKDOTPF_AGENCY,
      description,
      location: akLocation(community),
      category: "Construction",
      due_date: due,
      estimated_value: range || "Not specified",
      source_url: AKDOTPF_PAGE_URL,
      set_aside: null,
      notice_type: "Construction letting",
      solicitation_number: name,
      naics_code: null,
      psc: null,
    });
  }
  return result;
}

function fail(detail: string): never {
  console.error(`  ${AKDOTPF_SOURCE}: ${detail}`);
  throw new SourceUnreachableError(AKDOTPF_SOURCE, [detail]);
}

/** Fetch DOT&PF's construction bid calendar and return one bid per open proposal. */
export async function fetchAkDotpfBids(now: number = Date.now()): Promise<FetchResult> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 60000);
  let body: unknown;
  try {
    const resp = await fetch(AKDOTPF_API_URL, {
      headers: { "User-Agent": UA, Accept: "application/json", Referer: AKDOTPF_PAGE_URL },
      signal: controller.signal,
    });
    if (resp.status !== 200) fail(httpFailureDetail(resp.status, AKDOTPF_API_URL));
    const text = await resp.text();
    try {
      body = JSON.parse(text);
    } catch {
      fail(`page shape changed: response is not JSON (${text.length} bytes)`);
    }
  } catch (e) {
    if (e instanceof SourceUnreachableError) throw e;
    fail(requestFailureDetail(e));
  } finally {
    clearTimeout(timer);
  }
  const items = (body as { value?: unknown })?.value;
  if (!Array.isArray(items)) fail("page shape changed: no `value` array in the response");
  const r = parseAkDotpf(items as AkDotpfItem[], now);
  console.log(
    `  ${AKDOTPF_SOURCE}: ${r.rows.length} proposals accepted (read ${items.length}; skips: ${
      Object.entries(r.skipped)
        .map(([k, n]) => `${k}=${n}`)
        .join(", ") || "none"
    })`,
  );
  return { rows: r.rows, skipped: r.skipped, skippedRows: r.skippedRows };
}
