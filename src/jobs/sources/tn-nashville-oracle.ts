/**
 * Metro Nashville (Metropolitan Government of Nashville and Davidson County) —
 * `tn_nashville`, the city's open solicitations (owner 2026-11-06: a Nashville
 * paving customer; Contrax had no Metro Nashville source).
 *
 * SOURCE (verified 2026-11-06, no login): nashville.gov's procurement page links
 * "view current bidding opportunities" to Metro's Oracle Fusion Sourcing public
 * Negotiation Abstracts page:
 *   GET https://ibqhjb.fa.ocs.oraclecloud.com/fscmUI/faces/NegotiationAbstracts?prcBuId=300000006739049
 * Oracle ADF first answers with a small loopback page whose script re-requests
 * the same URL with an `_afrLoop` id and window parameters; the reader repeats
 * that one step (same cookies, same parameters the script adds), then reads the
 * "Search Results" table: Negotiation, Title, Type, Status, Posting Date, Open
 * Date, Close Date (US Central). No detail pages or documents are requested.
 *
 * WHAT A ROW BECOMES (data honesty):
 *   - One bid per negotiation: amendments ("GG000106-2,2") share the base
 *     number; only the Active row is kept (Amended/Closed rows are earlier
 *     versions or finished).
 *   - `due_date` = the published Close Date, Nashville local time.
 *   - `source_url` = the public abstracts page (Oracle gives no per-bid public
 *     link without JavaScript); bidders search the negotiation number there.
 * Skipped: not Active (`not_active`), close passed (`closed`), bad or missing
 * date (`bad_date`), no number or title (`missing_fields`), repeats (`duplicate`).
 *
 * IDENTITY: `external_id = nashville-<base negotiation number>`.
 */
import { mapCategory } from "~/lib/trade-classification";
import type { FetchResult } from "../runner";
import { SourceUnreachableError } from "../fetch-failure";
import type { RawBid } from "./sam-gov";

export const TN_NASHVILLE_SOURCE = "tn_nashville";
export const NASHVILLE_ABSTRACTS_URL = "https://ibqhjb.fa.ocs.oraclecloud.com/fscmUI/faces/NegotiationAbstracts?prcBuId=300000006739049";
const UA = "Mozilla/5.0 (compatible; ContraxBot/1.0; +https://www.contrax.company)";

/** The loopback id Oracle ADF's first answer asks the browser to send back. PURE. */
export function adfLoopId(html: string): string | null {
  return /"_afrLoop",\s*"(\d+)"/.exec(html)?.[1] ?? null;
}

/** The second request: the same URL plus the parameters ADF's loopback script adds. PURE. */
export function adfLoopbackUrl(base: string, loop: string): string {
  const p = new URLSearchParams({
    _afrLoop: loop, _afrWindowMode: "0", _afrWindowId: "null", _afrMT: "all", _afrFS: "16",
    _afrMFW: "1280", _afrMFH: "900", _afrMFDW: "1280", _afrMFDH: "900", _afrMFC: "8", _afrMFCI: "0",
    _afrMFM: "0", _afrMFR: "96", _afrMFG: "0", _afrMFS: "0", _afrMFO: "0",
  });
  return `${base}&${p}`;
}

/** "12/4/2026 2:00 PM" Nashville (America/Chicago) time → ISO UTC, DST-aware; null when invalid. PURE. */
export function nashvilleTime(v: string): string | null {
  const m = v.trim().match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})\s+(\d{1,2}):(\d{2})\s*([AP])M$/i);
  if (!m) return null;
  const [mo, d, y, h12, mi] = [+m[1], +m[2], +m[3], +m[4], +m[5]];
  if (mo < 1 || mo > 12 || d < 1 || d > 31 || h12 < 1 || h12 > 12 || mi > 59) return null;
  const target = { year: y, month: mo, day: d, hour: (h12 % 12) + (m[6].toUpperCase() === "P" ? 12 : 0), minute: mi };
  const local = Date.UTC(y, mo - 1, d, target.hour, mi);
  const fmt = new Intl.DateTimeFormat("en-US", { timeZone: "America/Chicago", year: "numeric", month: "numeric", day: "numeric", hour: "numeric", minute: "numeric", hourCycle: "h23" });
  const hits = [5, 6].map((o) => new Date(local + o * 3_600_000)).filter((t) => {
    const parts = Object.fromEntries(fmt.formatToParts(t).map((p) => [p.type, Number(p.value)]));
    return Object.entries(target).every(([k, val]) => parts[k] === val);
  });
  return hits.length === 1 ? hits[0].toISOString() : null;
}

const decode = (s: string) =>
  s.replace(/<[^>]+>/g, "").replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&nbsp;/g, " ").replace(/\s+/g, " ").trim();

const NOTICE: Record<string, string> = { RFQ: "RFQ", RFP: "RFP", RFI: "RFI", ITB: "ITB", IFB: "ITB" };

export interface NashvilleParseResult extends FetchResult {
  rows: RawBid[];
  skipped: Record<string, number>;
  skippedRows: { id: string; reason: string }[];
}

export function parseNashvilleAbstracts(html: string, now: number = Date.now()): NashvilleParseResult {
  if (!/<table[^>]+summary="Search Results"/.test(html)) {
    throw new Error("Search Results table missing (page changed or loopback failed)");
  }
  const table = html.slice(html.search(/<table[^>]+summary="Search Results"/));
  const rows: RawBid[] = [];
  const skipped: Record<string, number> = {};
  const skippedRows: { id: string; reason: string }[] = [];
  const skip = (id: string, reason: string) => {
    skipped[reason] = (skipped[reason] ?? 0) + 1;
    skippedRows.push({ id, reason });
  };
  const seen = new Set<string>();
  for (const tr of table.matchAll(/<tr _afrRK="\d+"[^>]*>([\s\S]*?)<\/tr>/g)) {
    const cells = [...tr[1].matchAll(/<td\b[^>]*>([\s\S]*?)<\/td>/g)].map((c) => decode(c[1]));
    const [number, title, type, status, , , close] = cells;
    const base = String(number ?? "").replace(/,\d+$/, "").trim();
    if (!base || !title) { skip(base || "unknown", "missing_fields"); continue; }
    if (status !== "Active") { skip(base, "not_active"); continue; }
    if (seen.has(base)) { skip(base, "duplicate"); continue; }
    const due = nashvilleTime(close ?? "");
    if (!due) { skip(base, "bad_date"); continue; }
    if (Date.parse(due) <= now) { skip(base, "closed"); continue; }
    seen.add(base);
    rows.push({
      external_id: `nashville-${base}`,
      title,
      agency: "Metro Nashville",
      location: "Nashville, TN",
      description: `Metro Nashville ${type || "solicitation"} ${base}: ${title}. Closes ${close} Nashville time. Posted on Metro's iSupplier (Oracle) bidding page; search the negotiation number there to view and respond.`,
      category: mapCategory("", title, ""),
      due_date: due,
      estimated_value: "",
      source_url: NASHVILLE_ABSTRACTS_URL,
      set_aside: null,
      naics_code: null,
      psc: null,
      solicitation_number: base,
      notice_type: NOTICE[String(type).toUpperCase()] ?? (type || "Solicitation"),
    });
  }
  return { rows, skipped, skippedRows };
}

export const nashvilleDeps = { fetch: (url: string, init: RequestInit) => fetch(url, init) };

export async function fetchTnNashvilleBids(now: number = Date.now()): Promise<FetchResult> {
  try {
    let cookies = "";
    const get = async (url: string) => {
      const r = await nashvilleDeps.fetch(url, {
        headers: { "user-agent": UA, accept: "text/html,application/xhtml+xml", ...(cookies ? { cookie: cookies } : {}) },
        redirect: "follow",
        signal: AbortSignal.timeout(30000),
      });
      const set = (r.headers as Headers & { getSetCookie?: () => string[] }).getSetCookie?.() ?? [];
      if (set.length) cookies = [cookies, ...set.map((c) => c.split(";")[0])].filter(Boolean).join("; ");
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      return r.text();
    };
    const first = await get(NASHVILLE_ABSTRACTS_URL);
    const loop = adfLoopId(first);
    const page = loop ? await get(adfLoopbackUrl(NASHVILLE_ABSTRACTS_URL, loop)) : first;
    return parseNashvilleAbstracts(page, now);
  } catch (e) {
    throw new SourceUnreachableError(TN_NASHVILLE_SOURCE, [e instanceof Error ? e.message : String(e)]);
  }
}
