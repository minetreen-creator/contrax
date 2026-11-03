/**
 * City of Houston — `tx_houston_beacon`, the city's open solicitations on
 * Beacon (owner 2026-11-03: "can we do Houston too?" → "go ahead"). Houston's
 * Strategic Procurement page sends bidders to
 *   https://www.beaconbid.com/solicitations/city-of-houston/open
 *
 * SOURCE (verified 2026-11-03, no login): that public page fills its list from
 * Beacon's own GraphQL call (POST https://www.beaconbid.com/api/gql,
 * `ListSolicitations` with agencyTag + status "open"). robots.txt allows all
 * but `/api/planholder/document` (bid documents), which is never requested. The
 * reader asks only for the fields the public list shows; extra fields answer
 * "Not allowed" and are not requested. Beacon rate-limits quick repeats (429),
 * so the reader makes one call per sync (pages of 100, 3 s apart) and treats a
 * 429 as "try next sync".
 *
 * WHAT A ROW BECOMES (data honesty):
 *   - `title` / `solicitation_number` = the solicitation's title / refnum.
 *   - `due_date` = Beacon's own UTC due instant.
 *   - `source_url` = the solicitation's public Beacon page, where bidders
 *     register and download documents.
 * Skipped: due passed (`closed`), no due date (`bad_date`), no id or title
 * (`missing_fields`), and real estate sales / funding notices (`not_a_bid`).
 *
 * IDENTITY: `external_id = houstonbeacon-<Beacon solicitation id>`.
 */
import { mapCategory } from "~/lib/trade-classification";
import type { FetchResult } from "../runner";
import { SourceUnreachableError } from "../fetch-failure";
import type { RawBid } from "./sam-gov";

export const HOUSTON_BEACON_SOURCE = "tx_houston_beacon";
export const BEACON_GQL = "https://www.beaconbid.com/api/gql";
export const HOUSTON_AGENCY_TAG = "city-of-houston";
const UA = "Mozilla/5.0 (compatible; ContraxBot/1.0; +https://www.contrax.company)";
const PAGE_SIZE = 100;
const MAX_PAGES = 5;

export const LIST_SOLICITATIONS = `query ListSolicitations($agencyTag: String, $status: String, $start: Int, $pageSize: Int) {
  solicitations(agencyTag: $agencyTag, status: $status, start: $start, pageSize: $pageSize) {
    total
    data { id title refnum dueDate type status }
  }
}`;

export interface BeaconSolicitation {
  id: string;
  title: string | null;
  refnum: string | null;
  dueDate: { utcDate?: string | null; specifiedZone?: string | null } | string | null;
  type: string | null;
  status: string | null;
}

const NOT_A_BID = /^(real estate sale|notice of funding availability|request for information)\b/i;
const NOTICE_TYPE: [RegExp, string][] = [
  [/^informal bid/i, "Informal Bid"],
  [/^invitation to bid/i, "ITB"],
  [/^competitive bidding/i, "ITB"],
  [/^best value bid/i, "ITB"],
  [/^competitive sealed proposal/i, "CSP"],
  [/^request for proposals?/i, "RFP"],
  [/rfq|request for qualifications/i, "RFQ"],
];

export function beaconDue(d: BeaconSolicitation["dueDate"]): string | null {
  const raw = typeof d === "string" ? d : d?.utcDate ?? null;
  if (!raw) return null;
  const t = Date.parse(raw);
  return Number.isFinite(t) ? new Date(t).toISOString() : null;
}

export interface HoustonBeaconParseResult {
  rows: RawBid[];
  skipped: Record<string, number>;
  skippedRows: { id: string; reason: string }[];
}

export function parseHoustonBeacon(list: BeaconSolicitation[], now: number = Date.now()): HoustonBeaconParseResult {
  const rows: RawBid[] = [];
  const skipped: Record<string, number> = {};
  const skippedRows: { id: string; reason: string }[] = [];
  const skip = (id: string, reason: string) => {
    skipped[reason] = (skipped[reason] ?? 0) + 1;
    skippedRows.push({ id, reason });
  };
  const seen = new Set<string>();
  for (const s of list) {
    const id = String(s?.id ?? "").trim();
    const title = String(s?.title ?? "").replace(/\s+/g, " ").trim();
    if (!id || !title) { skip(id || "unknown", "missing_fields"); continue; }
    if (seen.has(id)) { skip(id, "duplicate"); continue; }
    seen.add(id);
    const type = String(s.type ?? "").trim();
    if (NOT_A_BID.test(type)) { skip(id, "not_a_bid"); continue; }
    const due = beaconDue(s.dueDate);
    if (!due) { skip(id, "bad_date"); continue; }
    if (Date.parse(due) <= now) { skip(id, "closed"); continue; }
    const refnum = String(s.refnum ?? "").trim() || null;
    rows.push({
      external_id: `houstonbeacon-${id}`,
      title,
      agency: "City of Houston",
      location: "Houston, TX",
      description: `City of Houston ${type || "solicitation"}${refnum ? ` ${refnum}` : ""}: ${title}. Posted on the city's Beacon procurement portal, where bidders register and download the documents.`,
      category: mapCategory("", title, ""),
      due_date: due,
      estimated_value: "",
      source_url: `https://www.beaconbid.com/solicitations/${HOUSTON_AGENCY_TAG}/${encodeURIComponent(id)}`,
      set_aside: null,
      naics_code: null,
      psc: null,
      solicitation_number: refnum,
      notice_type: NOTICE_TYPE.find(([re]) => re.test(type))?.[1] ?? (type || "Solicitation"),
    });
  }
  return { rows, skipped, skippedRows };
}

export const houstonBeaconDeps = {
  fetch: (url: string, init: RequestInit) => fetch(url, init),
  pause: (ms: number) => new Promise((r) => setTimeout(r, ms)),
};

async function page(start: number): Promise<{ total: number; data: BeaconSolicitation[] }> {
  const r = await houstonBeaconDeps.fetch(BEACON_GQL, {
    method: "POST",
    headers: {
      "user-agent": UA,
      "content-type": "application/json",
      accept: "application/json",
      referer: `https://www.beaconbid.com/solicitations/${HOUSTON_AGENCY_TAG}/open`,
    },
    body: JSON.stringify({
      operationName: "ListSolicitations",
      query: LIST_SOLICITATIONS,
      variables: { agencyTag: HOUSTON_AGENCY_TAG, status: "open", start, pageSize: PAGE_SIZE },
    }),
    signal: AbortSignal.timeout(25000),
  });
  if (r.status === 429) throw new Error("Beacon answered 429 (rate limit); next sync tries again");
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  const json = (await r.json()) as any;
  if (json?.errors?.length) throw new Error(`GraphQL error: ${String(json.errors[0]?.message ?? "unknown").slice(0, 120)}`);
  const list = json?.data?.solicitations;
  if (!list || !Array.isArray(list.data) || typeof list.total !== "number") throw new Error("response shape changed");
  return list;
}

export async function fetchTxHoustonBeaconBids(now: number = Date.now()): Promise<FetchResult> {
  try {
    const first = await page(0);
    const all = [...first.data];
    const pages = Math.ceil(first.total / PAGE_SIZE);
    if (pages > MAX_PAGES) throw new Error(`${first.total} open; refusing partial coverage`);
    for (let p = 1; p < pages; p++) {
      await houstonBeaconDeps.pause(3000);
      all.push(...(await page(p * PAGE_SIZE)).data);
    }
    return parseHoustonBeacon(all, now);
  } catch (e) {
    throw new SourceUnreachableError(HOUSTON_BEACON_SOURCE, [e instanceof Error ? e.message : String(e)]);
  }
}
