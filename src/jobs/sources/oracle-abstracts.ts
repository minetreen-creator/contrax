/**
 * Public Oracle Fusion Sourcing "Negotiation/Solicitation Abstracts" lists, one reader for every
 * government that posts its bids there (owner 2026-11-06: "we need an oracle scraper to find more
 * of her trade" — a Nashville paving customer; Chattanooga posts on the same Oracle system).
 *
 * SOURCE (verified 2026-11-06, no login): each buyer's public abstracts page, e.g.
 *   https://ibqhjb.fa.ocs.oraclecloud.com/fscmUI/faces/NegotiationAbstracts?prcBuId=300000006739049
 * A plain request returns only the 21 newest rows of every status (Active, Amended, Closed…), so an
 * older bid that is still open can fall off that list. The collector
 * (.github/scripts/oracle-abstracts-fetch.mjs) therefore opens the page in headless Chrome, sets
 * the page's own Status filter to "Active", presses Search, and hands back the table it shows.
 * No sign-in, no forms beyond that public filter, no detail pages or documents.
 *
 * WHAT A ROW BECOMES (data honesty):
 *   - Columns: number, title, type, status, posting date, open date, close date.
 *   - One bid per solicitation: "201011,2" is amendment 2 of 201011; the newest is kept.
 *   - `due_date` = the published Close Date in the page's stated time zone.
 *   - `source_url` = the public abstracts page (Oracle gives no public per-bid link).
 * Refused outright (the source fails loudly instead of half-reading): a page whose time zone,
 * filter or columns are not what this reader knows, a non-Active row, or 21+ Active rows (the page
 * may have cut the list short).
 * Skipped: close passed (`closed`), bad date (`bad_date`), no number or title (`missing_fields`),
 * repeats (`duplicate`).
 */
import { execFile } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { mapCategory } from "~/lib/trade-classification";
import type { FetchResult } from "../runner";
import { SourceUnreachableError } from "../fetch-failure";
import type { RawBid } from "./sam-gov";

export interface OracleTenant {
  source: string;
  endpoint: string;
  agency: string;
  location: string;
  idPrefix: string;
  /** IANA zone the page's dates are in. */
  zone: "America/Chicago" | "America/New_York";
  /** The label the page prints next to "Time Zone". */
  zoneLabel: "US Central Time" | "US Eastern Time";
  /** How the description names the posting place. */
  portal: string;
}

export const NASHVILLE_ORACLE: OracleTenant = {
  source: "tn_nashville",
  endpoint: "https://ibqhjb.fa.ocs.oraclecloud.com/fscmUI/faces/NegotiationAbstracts?prcBuId=300000006739049",
  agency: "Metro Nashville",
  location: "Nashville, TN",
  idPrefix: "nashville",
  zone: "America/Chicago",
  zoneLabel: "US Central Time",
  portal: "Metro's iSupplier (Oracle) bidding page",
};

export const CHATTANOOGA_ORACLE: OracleTenant = {
  source: "tn_chattanooga",
  endpoint: "https://fa-eqto-saasfaprod1.fa.ocs.oraclecloud.com/fscmUI/faces/NegotiationAbstracts?prcBuId=300000003584083",
  agency: "City of Chattanooga",
  location: "Chattanooga, TN",
  idPrefix: "chattanooga",
  zone: "America/New_York",
  zoneLabel: "US Eastern Time",
  portal: "the City's Oracle Supplier Portal solicitation list",
};

/** The public page shows at most this many rows per search. */
export const ORACLE_PAGE_ROWS = 21;

export interface OracleAbstractsPayload {
  capturedAt: string;
  endpoint: string;
  filter: string;
  timeZone: string | null;
  rows: string[][];
}

/** "12/4/2026 2:00 PM" or "12/3/26 2:00 PM" local wall time in `zone` → ISO UTC, DST-aware; null when invalid. PURE. */
export function oracleLocalTime(v: string, zone: OracleTenant["zone"]): string | null {
  const m = v.trim().match(/^(\d{1,2})\/(\d{1,2})\/(\d{2}|\d{4})\s+(\d{1,2}):(\d{2})\s*([AP])M$/i);
  if (!m) return null;
  const y = m[3].length === 2 ? 2000 + +m[3] : +m[3];
  const [mo, d, h12, mi] = [+m[1], +m[2], +m[4], +m[5]];
  if (mo < 1 || mo > 12 || d < 1 || d > 31 || h12 < 1 || h12 > 12 || mi > 59) return null;
  const target = { year: y, month: mo, day: d, hour: (h12 % 12) + (m[6].toUpperCase() === "P" ? 12 : 0), minute: mi };
  const wall = Date.UTC(y, mo - 1, d, target.hour, mi);
  const fmt = new Intl.DateTimeFormat("en-US", { timeZone: zone, year: "numeric", month: "numeric", day: "numeric", hour: "numeric", minute: "numeric", hourCycle: "h23" });
  const offsets = zone === "America/Chicago" ? [5, 6] : [4, 5];
  const hits = offsets.map((o) => new Date(wall + o * 3_600_000)).filter((t) => {
    const parts = Object.fromEntries(fmt.formatToParts(t).map((p) => [p.type, Number(p.value)]));
    return Object.entries(target).every(([k, val]) => parts[k] === val);
  });
  return hits.length === 1 ? hits[0].toISOString() : null;
}

/** The page's solicitation type → Contrax notice type. PURE. */
export function oracleNoticeType(type: string): string {
  const t = type.trim();
  if (/^(RFP|request for proposals?)$/i.test(t)) return "RFP";
  if (/^(RFQ|request for quot(e|ation)s?)$/i.test(t)) return "RFQ";
  if (/^(RFI|request for information)$/i.test(t)) return "RFI";
  if (/^(ITB|IFB|invitation (for|to) bids?|construction bid)$/i.test(t)) return "ITB";
  return t || "Solicitation";
}

const SHORT_ZONE = { "America/Chicago": "Central", "America/New_York": "Eastern" } as const;

export interface OracleParseResult extends FetchResult {
  rows: RawBid[];
  skipped: Record<string, number>;
  skippedRows: { id: string; reason: string }[];
}

export function parseOracleAbstracts(tenant: OracleTenant, payload: OracleAbstractsPayload, now: number = Date.now()): OracleParseResult {
  const fail = (detail: string): never => { throw new SourceUnreachableError(tenant.source, [detail]); };
  if (!payload || payload.endpoint !== tenant.endpoint) fail("Payload is not for this buyer's abstracts page");
  if (payload.filter !== "Active") fail("Active filter was not applied");
  if (payload.timeZone !== tenant.zoneLabel) fail(`Unexpected page time zone: ${payload.timeZone}`);
  if (!Number.isFinite(Date.parse(payload.capturedAt)) || Math.abs(now - Date.parse(payload.capturedAt)) > 30 * 60_000) fail("Stale or undated capture");
  if (!Array.isArray(payload.rows)) fail("No rows array");
  if (payload.rows.length >= ORACLE_PAGE_ROWS) fail(`${payload.rows.length} Active rows: the page may have cut the list short`);

  const rows: RawBid[] = [];
  const skipped: Record<string, number> = {};
  const skippedRows: { id: string; reason: string }[] = [];
  const skip = (id: string, reason: string) => {
    skipped[reason] = (skipped[reason] ?? 0) + 1;
    skippedRows.push({ id, reason });
  };
  const seen = new Set<string>();
  for (const cells of payload.rows) {
    if (!Array.isArray(cells) || cells.length < 7 || cells.some((c) => typeof c !== "string")) fail("Unexpected abstracts columns");
    const [number, title, type, status, , , close] = cells.map((c) => c.replace(/\s+/g, " ").trim());
    if (status !== "Active") fail(`Non-Active row after the Active filter: ${status}`);
    const base = number.replace(/,\d+$/, "");
    if (!base || !title) { skip(base || "unknown", "missing_fields"); continue; }
    if (seen.has(base)) { skip(base, "duplicate"); continue; }
    const due = oracleLocalTime(close, tenant.zone);
    if (!due) { skip(base, "bad_date"); continue; }
    if (Date.parse(due) <= now) { skip(base, "closed"); continue; }
    seen.add(base);
    rows.push({
      external_id: `${tenant.idPrefix}-${base}`,
      title,
      agency: tenant.agency,
      location: tenant.location,
      description: `${tenant.agency} ${type || "solicitation"} ${base}: ${title}. Closes ${close} ${SHORT_ZONE[tenant.zone]} time. Posted on ${tenant.portal}; search the number there to view and respond.`,
      category: mapCategory(type, title, ""),
      due_date: due,
      estimated_value: "",
      source_url: tenant.endpoint,
      set_aside: null,
      naics_code: null,
      psc: null,
      solicitation_number: base,
      notice_type: oracleNoticeType(type),
    });
  }
  return { rows, skipped, skippedRows };
}

/** Runs the headless collector for one page; swapped out in tests. */
export const oracleDeps = {
  collect: async (endpoint: string): Promise<OracleAbstractsPayload> => {
    const dir = mkdtempSync(join(tmpdir(), "oracle-abstracts-"));
    const out = join(dir, "payload.json");
    try {
      await promisify(execFile)("node", [process.env.ORACLE_ABSTRACTS_FETCH_SCRIPT || join(process.cwd(), ".github/scripts/oracle-abstracts-fetch.mjs")], {
        timeout: 180_000, maxBuffer: 1_000_000, env: { ...process.env, ORACLE_ENDPOINT: endpoint, ORACLE_OUT: out },
      });
      return JSON.parse(readFileSync(out, "utf8")) as OracleAbstractsPayload;
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  },
};

export async function fetchOracleTenant(tenant: OracleTenant, now: number = Date.now()): Promise<FetchResult> {
  try {
    return parseOracleAbstracts(tenant, await oracleDeps.collect(tenant.endpoint), now);
  } catch (e) {
    if (e instanceof SourceUnreachableError) throw e;
    throw new SourceUnreachableError(tenant.source, [e instanceof Error ? e.message : String(e)]);
  }
}

export const fetchTnNashvilleBids = (now?: number) => fetchOracleTenant(NASHVILLE_ORACLE, now);
export const fetchTnChattanoogaBids = (now?: number) => fetchOracleTenant(CHATTANOOGA_ORACLE, now);
