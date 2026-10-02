/**
 * Nebraska State Purchasing Bureau bid opportunities — `ne_das`, the State
 * of Nebraska's public list of current solicitations
 * (das.nebraska.gov/materiel/bid-opportunities.html, Department of
 * Administrative Services, Materiel Division).
 *
 * WHY: Contrax had no state Nebraska feed. The State Purchasing Bureau posts
 * its own and other agencies' (Health and Human Services, Military
 * Department, Public Service Commission, …) RFPs and ITBs there.
 *
 * SOURCE (verified live 2026-10-02, no login, no CAPTCHA): the page's
 * "Current Bid Opportunities" table, header
 *   Posted | Description | Category - NIGP Code | Opening | Type | PCO/Buyer |
 *   Solicitation Number | Agency | Updated
 * (the page's other tables, bids being awarded and awarded bids, are not
 * read). The description links the solicitation's own page,
 * /materiel/purchasing/<number>/<number>.html.
 *
 * WHAT A ROW BECOMES (data honesty — never manufacture, relabel, or loosen):
 *   - `title` = Description; `solicitation_number` = Solicitation Number;
 *     `notice_type` = Type; `agency` = Agency.
 *   - `location` = "Nebraska".
 *   - `due_date` = the Opening DATE ("10/13/26") at 12:00 AM Central (the
 *     list has no time; Nebraska spans Central and Mountain, and the earlier
 *     reading never shows a bid as open later than it really is).
 *   - `description` is constructed from the type, number, NIGP category and
 *     posted date (the buyer's name is not ingested).
 *   - `source_url` = the solicitation's own page.
 *   - `naics_code` / `psc` / `set_aside` stay NULL.
 * Rows whose Opening is not a date ("Continuous" or, as printed, "Continous"
 * qualification lists) are
 * skipped (`open_ended`); rows whose opening date has passed are skipped
 * (`closed`).
 *
 * IDENTITY: `external_id = nedas-<solicitation number>` (spaces → "-").
 */
import { mapCategory } from "~/lib/trade-classification";
import type { FetchResult } from "../runner";
import { httpFailureDetail, requestFailureDetail, SourceUnreachableError } from "../fetch-failure";
import type { RawBid } from "./sam-gov";

export const NE_DAS_SOURCE = "ne_das";
export const NE_DAS_URL = "https://das.nebraska.gov/materiel/bid-opportunities.html";

const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36";

export interface NeOpportunity {
  posted: string;
  title: string;
  category: string;
  opening: string;
  type: string;
  number: string;
  agency: string;
  link: string | null;
}

export interface NeParseResult {
  rows: RawBid[];
  opportunities: NeOpportunity[];
  skipped: Record<string, number>;
  skippedRows: { id: string; reason: string }[];
}

function decode(s: string): string {
  return s
    .replace(/<br\s*\/?>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&#(\d+);/g, (_m, n: string) => String.fromCharCode(Number(n)))
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/\s+/g, " ")
    .trim();
}

/** US Central offset (hours) for a calendar date: CDT 2nd Sun Mar – 1st Sun Nov. */
function centralOffset(year: number, month: number, day: number): number {
  const dstStart = Date.UTC(year, 2, 8 + ((7 - new Date(Date.UTC(year, 2, 8)).getUTCDay()) % 7));
  const dstEnd = Date.UTC(year, 10, 1 + ((7 - new Date(Date.UTC(year, 10, 1)).getUTCDay()) % 7));
  const day0 = Date.UTC(year, month - 1, day);
  return day0 >= dstStart && day0 < dstEnd ? -5 : -6;
}

/** "10/13/26" (or "10/13/2026") → 12:00 AM Central that day. Anything else → null. */
export function neDateToIso(text: string): string | null {
  const m = text.trim().match(/^(\d{1,2})\/(\d{1,2})\/(\d{2}|\d{4})$/);
  if (!m) return null;
  const year = m[3]!.length === 2 ? 2000 + Number(m[3]) : Number(m[3]);
  const [month, day] = [Number(m[1]), Number(m[2])];
  if (month < 1 || month > 12 || day < 1 || day > 31) return null;
  return new Date(Date.UTC(year, month - 1, day) - centralOffset(year, month, day) * 3_600_000).toISOString();
}

/** The "Current Bid Opportunities" table (found by its header), or null. */
export function readNeOpportunities(html: string): NeOpportunity[] | null {
  const table = [...html.matchAll(/<table[\s\S]*?<\/table>/gi)]
    .map((m) => m[0])
    .find((t) => /<th[^>]*>\s*Posted\s*<\/th>[\s\S]*?<th[^>]*>\s*Opening\s*<\/th>/i.test(t));
  if (!table) return null;
  const out: NeOpportunity[] = [];
  for (const tr of table.matchAll(/<tr[^>]*>([\s\S]*?)<\/tr>/gi)) {
    const cells = [...tr[1]!.matchAll(/<td[^>]*>([\s\S]*?)<\/td>/gi)].map((c) => c[1]!);
    if (cells.length < 8) continue;
    const href = cells[1]!.match(/href="([^"]+)"/i)?.[1];
    let link: string | null = null;
    try {
      link = href ? new URL(href.replace(/&amp;/g, "&"), NE_DAS_URL).toString() : null;
    } catch {
      link = null;
    }
    out.push({
      posted: decode(cells[0]!),
      title: decode(cells[1]!),
      category: decode(cells[2]!),
      opening: decode(cells[3]!),
      type: decode(cells[4]!),
      number: decode(cells[6]!),
      agency: decode(cells[7]!),
      link,
    });
  }
  return out;
}

function recordSkip(result: NeParseResult, id: string, reason: string) {
  result.skipped[reason] = (result.skipped[reason] ?? 0) + 1;
  result.skippedRows.push({ id, reason });
}

/** PURE parse — no network, no DB; `now` is injected. */
export function parseNePage(html: string, now: number = Date.now()): NeParseResult {
  const result: NeParseResult = { rows: [], opportunities: readNeOpportunities(html) ?? [], skipped: {}, skippedRows: [] };
  for (const o of result.opportunities) {
    const rowId = `nedas-${o.number.replace(/[^0-9A-Za-z-]+/g, "-")}`;
    if (!o.title || !o.number) {
      recordSkip(result, rowId, "missing_fields");
      continue;
    }
    const due = neDateToIso(o.opening);
    if (!due) {
      recordSkip(result, rowId, /contin/i.test(o.opening) ? "open_ended" : "bad_date");
      continue;
    }
    if (Date.parse(due) < now) {
      recordSkip(result, rowId, "closed");
      continue;
    }
    const description = [
      `State of Nebraska ${o.type || "solicitation"} ${o.number}${o.posted ? `, posted ${o.posted}` : ""}, opening ${o.opening}.`,
      o.category ? `Category: ${o.category}.` : "",
      "The solicitation documents are on the State Purchasing Bureau's page (see source link).",
    ]
      .filter(Boolean)
      .join(" ");
    result.rows.push({
      external_id: rowId,
      title: o.title,
      agency: o.agency || "State Purchasing Bureau",
      description,
      location: "Nebraska",
      category: mapCategory("", o.title, description),
      due_date: due,
      estimated_value: "Not specified",
      source_url: o.link ?? NE_DAS_URL,
      set_aside: null,
      notice_type: o.type || "Solicitation",
      solicitation_number: o.number,
      naics_code: null,
      psc: null,
    });
  }
  return result;
}

function fail(detail: string): never {
  console.error(`  ${NE_DAS_SOURCE}: ${detail}`);
  throw new SourceUnreachableError(NE_DAS_SOURCE, [detail]);
}

/** Fetch Nebraska's current bid opportunities and return ingest rows. */
export async function fetchNeDasBids(now: number = Date.now()): Promise<FetchResult> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 60000);
  let html: string;
  try {
    const resp = await fetch(NE_DAS_URL, { headers: { "User-Agent": UA, Accept: "text/html" }, signal: controller.signal });
    if (resp.status !== 200) fail(httpFailureDetail(resp.status, NE_DAS_URL));
    html = await resp.text();
  } catch (e) {
    if (e instanceof SourceUnreachableError) throw e;
    fail(requestFailureDetail(e));
  } finally {
    clearTimeout(timer);
  }
  if (!readNeOpportunities(html)) fail(`page shape changed: no Current Bid Opportunities table (${html.length} bytes)`);
  const { rows, opportunities, skipped, skippedRows } = parseNePage(html, now);
  console.log(
    `  ${NE_DAS_SOURCE}: ${rows.length} open bids accepted (listed: ${opportunities.length}; skips: ${
      Object.entries(skipped)
        .map(([r, n]) => `${r}=${n}`)
        .join(", ") || "none"
    })`,
  );
  return { rows, skipped, skippedRows };
}
