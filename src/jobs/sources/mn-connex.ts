/**
 * Minnesota local-agency construction bids — `mn_connex`, MnDOT State Aid's
 * eAdvert, published on ConneX (connex.rtvision.com).
 *
 * WHY: Contrax had no Minnesota feed (owner 2026-10-05: "Minnesota"). The
 * state procurement office sits behind a bot check; eAdvert is where
 * Minnesota counties and cities post their road, bridge, trail and utility
 * bids in one public list.
 *
 * SOURCE (verified live 2026-10-05, no login, no CAPTCHA: 25 contracts out
 * for bid, all Minnesota): the public "Out for Bid Contracts" page
 *   https://connex.rtvision.com/contracts/out-for-bid
 * loads its table from its own call
 *   QUERY https://connex.rtvision.com/api/contract/list-out-for-bid?limit=…
 * (HTTP QUERY method, JSON body). The connector makes that same call.
 *
 * WHAT A ROW BECOMES (data honesty — never manufacture, relabel, or loosen):
 *   - `title` = the contract name; when the name is only the contract number
 *     ("CP 0000-933835"), "<contract type> contract <number>".
 *   - `agency` = the posting agency without ", MN" ("Hennepin County").
 *   - `due_date` = bidOpening (ISO, UTC).
 *   - `source_url` = the contract's public ConneX page, which links the full
 *     ad and plans.
 *   - `location` = "Minnesota"; `naics_code` / `psc` / `set_aside` NULL.
 * Skipped: contracts outside Minnesota (`out_of_state`), bid opening passed
 * (`closed`), no or unreadable bid opening (`bad_date`), no id or name
 * (`missing_fields`), repeated id (`duplicate`).
 *
 * IDENTITY: `external_id = mnconnex-<id>` (ConneX's contract id).
 */
import { mapCategory } from "~/lib/trade-classification";
import type { FetchResult } from "../runner";
import { httpFailureDetail, requestFailureDetail, SourceUnreachableError } from "../fetch-failure";
import type { RawBid } from "./sam-gov";

export const MN_CONNEX_SOURCE = "mn_connex";
export const MN_CONNEX_HOST = "https://connex.rtvision.com";
export const MN_CONNEX_DATA_URL = `${MN_CONNEX_HOST}/api/contract/list-out-for-bid?limit=500`;
export const MN_CONNEX_PAGE_URL = `${MN_CONNEX_HOST}/contracts/out-for-bid`;

const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36";

export interface ConnexContract {
  id: number | string;
  name: string | null;
  agency: string | null;
  state: string | null;
  bidOpening: string | null;
  workTypes: string | null;
  type: string | null;
  number: string | null;
}

export interface MnConnexParseResult {
  rows: RawBid[];
  skipped: Record<string, number>;
  skippedRows: { id: string; reason: string }[];
}

/** "Hennepin County, MN" → "Hennepin County". */
export function connexAgencyName(agency: string | null | undefined): string {
  const name = String(agency ?? "").replace(/\s+/g, " ").trim().replace(/,\s*MN$/i, "");
  return name || "Minnesota local agency";
}

/** The contract name, or "<type> contract <number>" when the name is only the number. */
export function connexTitle(c: Pick<ConnexContract, "name" | "number" | "type">): string {
  const name = String(c.name ?? "").replace(/\s+/g, " ").trim();
  const number = String(c.number ?? "").trim();
  if (name && name !== number) return name;
  const type = String(c.type ?? "").trim();
  return `${type ? `${type} ` : ""}contract ${number || name}`.trim().replace(/^c/, "C");
}

function recordSkip(result: MnConnexParseResult, id: string, reason: string) {
  result.skipped[reason] = (result.skipped[reason] ?? 0) + 1;
  result.skippedRows.push({ id, reason });
}

/** PURE parse — no network, no DB; `now` is injected. */
export function parseConnex(items: ConnexContract[], now: number = Date.now()): MnConnexParseResult {
  const result: MnConnexParseResult = { rows: [], skipped: {}, skippedRows: [] };
  const seen = new Set<string>();
  for (const c of items) {
    const rowId = `mnconnex-${c.id}`;
    if (seen.has(rowId)) {
      recordSkip(result, rowId, "duplicate");
      continue;
    }
    seen.add(rowId);
    if (c.id == null || !String(c.name ?? c.number ?? "").trim()) {
      recordSkip(result, rowId, "missing_fields");
      continue;
    }
    if (String(c.state ?? "").trim().toLowerCase() !== "minnesota") {
      recordSkip(result, rowId, "out_of_state");
      continue;
    }
    const dueMs = Date.parse(String(c.bidOpening ?? ""));
    if (!Number.isFinite(dueMs)) {
      recordSkip(result, rowId, "bad_date");
      continue;
    }
    if (dueMs < now) {
      recordSkip(result, rowId, "closed");
      continue;
    }
    const agency = connexAgencyName(c.agency);
    const title = connexTitle(c);
    const number = String(c.number ?? "").trim() || null;
    const type = String(c.type ?? "").trim();
    const work = String(c.workTypes ?? "").trim();
    const description = [
      `Minnesota local-agency construction contract${number ? ` ${number}` : ""}${type ? ` (${type.toLowerCase()})` : ""} posted by ${agency} on MnDOT State Aid construction eAdvert (ConneX).`,
      work ? `Work types: ${work}.` : "",
      "The full ad and plans are linked from the source page.",
    ]
      .filter(Boolean)
      .join(" ");
    result.rows.push({
      external_id: rowId,
      title,
      agency,
      description,
      location: "Minnesota",
      category: mapCategory("", title, description),
      due_date: new Date(dueMs).toISOString(),
      estimated_value: "Not specified",
      source_url: `${MN_CONNEX_HOST}/contract/out-for-bid/${c.id}`,
      set_aside: null,
      notice_type: type || null,
      solicitation_number: number,
      naics_code: null,
      psc: null,
    });
  }
  return result;
}

function fail(detail: string): never {
  console.error(`  ${MN_CONNEX_SOURCE}: ${detail}`);
  throw new SourceUnreachableError(MN_CONNEX_SOURCE, [detail]);
}

/** Make the page's own out-for-bid call and return ingest rows. */
export async function fetchMnConnexBids(now: number = Date.now()): Promise<FetchResult> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 60000);
  let body: any;
  try {
    const resp = await fetch(MN_CONNEX_DATA_URL, {
      method: "QUERY",
      headers: { "User-Agent": UA, Accept: "application/json", "Content-Type": "application/json", Referer: MN_CONNEX_PAGE_URL },
      body: JSON.stringify({ includeNullGeometry: true, dbe: false, sortColumn: "bidOpening" }),
      signal: controller.signal,
    });
    if (resp.status !== 200) fail(httpFailureDetail(resp.status, MN_CONNEX_DATA_URL));
    body = await resp.json();
  } catch (e) {
    if (e instanceof SourceUnreachableError) throw e;
    fail(requestFailureDetail(e));
  } finally {
    clearTimeout(timer);
  }
  if (!body || !Array.isArray(body.data)) fail("response shape changed: no data array");
  const items = body.data as ConnexContract[];
  const total = Number(body.meta?.totalRows);
  if (Number.isFinite(total) && total > items.length) fail(`only ${items.length} of ${total} contracts returned`);
  const { rows, skipped, skippedRows } = parseConnex(items, now);
  console.log(
    `  ${MN_CONNEX_SOURCE}: ${rows.length} contracts accepted (listed: ${items.length}; skips: ${
      Object.entries(skipped)
        .map(([r, n]) => `${r}=${n}`)
        .join(", ") || "none"
    })`,
  );
  return { rows, skipped, skippedRows };
}
