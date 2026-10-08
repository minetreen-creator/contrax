/** City Purchasing Oracle abstracts, verified 2026-10-08. Public Works and
 * Public Utilities publish additional boards: this feed does not claim those.
 * Details are session-bound dialogs, so source_url opens the official list.
 * Comma suffixes are amendments of the same solicitation; hyphenated reissues
 * remain distinct. Dates are the portal's Close Date, never its opening calendar.
 */
import { execFile } from "node:child_process";
import { readFileSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { mapCategory } from "~/lib/trade-classification";
import { SourceUnreachableError } from "../fetch-failure";
import type { FetchResult } from "../runner";

export const VB_SOURCE = "va_virginia_beach_oracle";
export const VB_ENDPOINT = "https://ejbs.fa.us6.oraclecloud.com/fscmUI/faces/NegotiationAbstracts?prcBuId=300000003501148";
export interface VirginiaBeachPayload {
  capturedAt: string;
  timeZone: string | null;
  rowCount: number;
  startRow: number;
  rows: string[][];
}

export function virginiaBeachDeadline(value: string): string | null {
  const m = /^(\d{1,2})\/(\d{1,2})\/(\d{4}) (\d{1,2}):(\d{2}) (AM|PM)$/.exec(value);
  if (!m) return null;
  const [, month, day, year, hour, minute, meridiem] = m;
  if (+hour < 1 || +hour > 12 || +minute > 59) return null;
  const h = +hour % 12 + (meridiem === "PM" ? 12 : 0);
  const wall = Date.UTC(+year, +month - 1, +day, h, +minute);
  const check = new Date(wall);
  if (check.getUTCMonth() !== +month - 1 || check.getUTCDate() !== +day) return null;
  const fmt = new Intl.DateTimeFormat("en-US", { timeZone: "America/New_York", year: "numeric", month: "numeric", day: "numeric", hour: "numeric", minute: "numeric", hourCycle: "h23" });
  // Check both Eastern offsets; reject ambiguous/nonexistent DST wall times.
  const matches = [4, 5].map(offset => new Date(wall + offset * 3_600_000)).filter(date => {
    const parts = Object.fromEntries(fmt.formatToParts(date).map(p => [p.type, p.value]));
    return +parts.year === +year && +parts.month === +month && +parts.day === +day && +parts.hour === h && +parts.minute === +minute;
  });
  return matches.length === 1 ? matches[0].toISOString() : null;
}

export function parseVirginiaBeach(payload: VirginiaBeachPayload, now = Date.now()): FetchResult {
  const fail = (detail: string): never => { throw new SourceUnreachableError(VB_SOURCE, [detail]); };
  if (!payload || payload.timeZone !== "US Eastern Time" || payload.startRow !== 0 ||
      !Array.isArray(payload.rows) || !Number.isInteger(payload.rowCount) || payload.rowCount !== payload.rows.length ||
      !Number.isFinite(Date.parse(payload.capturedAt)) || Math.abs(now - Date.parse(payload.capturedAt)) > 30 * 60_000)
    fail("Invalid, stale, or incomplete public abstracts payload");
  const result: FetchResult = { rows: [], skipped: {}, skippedRows: [] };
  const seen = new Set<string>();
  for (const cells of payload.rows) {
    if (cells.length !== 6 || cells.some(cell => typeof cell !== "string")) fail("Unexpected abstracts columns");
    const [reference, title, type, status, close] = cells;
    if (!/^COVB-\d{2}-\d+(?:-\d+)?(?:,\d+)?$/.test(reference) || !title.trim()) fail("Missing solicitation identity/title");
    const number = reference.replace(/,\d+$/, "");
    if (seen.has(number)) fail("Duplicate solicitation identity");
    seen.add(number);
    const id = `virginiabeach-${number}`;
    const skip = (reason: string) => {
      result.skipped[reason] = (result.skipped[reason] ?? 0) + 1;
      result.skippedRows.push({ id, reason });
    };
    if (status !== "Active") { skip("not_active"); continue; }
    if (!["Invitation to Bid", "Request for Proposal", "Request for Quotation", "Request for Information"].includes(type)) { skip("unsupported_notice_type"); continue; }
    const due = virginiaBeachDeadline(close);
    if (!due) fail(`Unparseable Eastern closing date for ${reference}`);
    if (Date.parse(due!) <= now) { skip("past_due"); continue; }
    const description = `${type} ${reference}, published by City of Virginia Beach Purchasing. Close date: ${close} (US Eastern Time). Open the official Solicitation Abstracts portal and select Details for the scope and attachments.`;
    result.rows.push({ external_id: id, title, agency: "City of Virginia Beach", location: "Virginia Beach, VA", description,
      category: mapCategory(type, title, description), due_date: due, estimated_value: "Not specified", source_url: VB_ENDPOINT,
      solicitation_number: number, notice_type: null, set_aside: null, naics_code: null, psc: null });
  }
  return result;
}

export async function fetchVirginiaBeachBids(): Promise<FetchResult> {
  const dir = mkdtempSync(join(tmpdir(), "va-vb-"));
  const out = join(dir, "payload.json");
  try {
    await promisify(execFile)("node", [process.env.VA_VIRGINIA_BEACH_FETCH_SCRIPT || join(process.cwd(), ".github/scripts/virginia-beach-bids-fetch.mjs")], {
      timeout: 180_000, maxBuffer: 1_000_000, env: { ...process.env, VA_VIRGINIA_BEACH_OUT: out },
    });
    return parseVirginiaBeach(JSON.parse(readFileSync(out, "utf8")));
  } catch (error) {
    if (error instanceof SourceUnreachableError) throw error;
    throw new SourceUnreachableError(VB_SOURCE, [(error as Error).message]);
  } finally { rmSync(dir, { recursive: true, force: true }); }
}
