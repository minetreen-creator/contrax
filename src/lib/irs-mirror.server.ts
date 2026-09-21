/**
 * Nonprofit Free — the IRS mirror refresh job (the only code that talks to irs.gov).
 *
 * SOURCES (verification §1.a/§1.d of the research; all keyless, official bulk downloads):
 *   • EO BMF extract — the 4 region CSVs (`eo1..eo4.csv`), complete domestic coverage
 *     1,964,958 rows / 341,096,883 B at the 2026-09-07 posting (research §1.a).
 *   • Pub 78 — `data-download-pub78.zip` (1,419,989 records; pipe-delimited, 6 fields).
 *   • Automatic revocation list — `data-download-revocation.zip` (1,247,137 rows,
 *     1,227,732 distinct EINs; pipe-delimited, 12 fields).
 *
 * WHY A LOCAL MIRROR. A per-request live lookup would be pointless (the same monthly
 * snapshot), slow, and would put our traffic on someone else's CDN for data we can hold
 * (research §3). Verification therefore reads the LOCAL tables; this job is the only
 * network path.
 *
 * COMPLETENESS IS PROVEN, NEVER ASSUMED (research §1.a gotchas, measured):
 *   • irs.gov sends NO `Content-Length` and IGNORES byte ranges → you cannot verify by
 *     size. The proof of completeness is the CSV ROW COUNT: the four region files must
 *     sum to the record count the IRS prints on its own EO BMF page, and every row must
 *     parse to exactly 28 fields (0 malformed rows in all 1.96 M). Any disagreement
 *     FAILS THE RUN LOUDLY — an incomplete mirror must never look like a small one.
 *   • The header's column ORDER is asserted verbatim: a silent IRS reorder would
 *     mis-map every field, so a changed header is a hard failure, not a warning.
 *   • Duplicate EIN detection: `--verify` counts distinct EINs by streaming; the swap's
 *     staged table carries the PRIMARY KEY, so a duplicate EIN fails the import itself.
 *
 * WRITE STRATEGY (a full monthly snapshot, so a SWAP, not a churn-y upsert): parse →
 * write every row ONCE into a run's staging table → in one transaction, rename the live
 * table aside, rename the staging table into place and drop the old one. Every row is
 * insert-only: NO row is ever rewritten unchanged, so there is none of the no-op UPDATE
 * churn the team's `neon-cu-noop-write-elimination` skill exists to remove, no dead
 * tuples and no bloat, and pruning is free (an org the IRS dropped simply is not in the
 * new table). `content_hash` is what makes `--verify` able to report EXACTLY what the
 * import would insert / update / leave alone / prune, before a single row is written.
 * `upsertBatch()` is the guarded incremental path (`WHERE content_hash IS DISTINCT FROM
 * EXCLUDED.content_hash`) and is deliberately NOT what a full refresh uses.
 *
 * MODES
 *   bun run src/lib/irs-mirror.server.ts --verify        # dry run: download, prove
 *        completeness, diff against the live mirror, write NOTHING to the mirror tables
 *        (exactly one `irs_mirror_runs` row with mode='verify' — the audit trail).
 *   bun run src/lib/irs-mirror.server.ts --import        # the real refresh (swap)
 *   --source <bmf|pub78|revocations|all>   --source-dir <dir>   --max-rows <n>
 *
 * The 340 MB download + import is NOT part of this phase's work; this job exists and is
 * unit-testable with in-memory fixtures and a fake store (zero network in the default
 * test run, per the owner's test-determinism guardrail).
 */
import { createHash } from "node:crypto";
import { inflateRawSync } from "node:zlib";
import { readFile } from "node:fs/promises";
import { sql } from "~/db";

// ── Sources (exact URLs, verified 2026-09-21) ────────────────────────────────
export const IRS_BMF_REGION_URLS: readonly string[] = [
  "https://www.irs.gov/pub/irs-soi/eo1.csv",
  "https://www.irs.gov/pub/irs-soi/eo2.csv",
  "https://www.irs.gov/pub/irs-soi/eo3.csv",
  "https://www.irs.gov/pub/irs-soi/eo4.csv",
];
/** The page that prints the authoritative record count + posting date for the extract. */
export const IRS_BMF_LANDING_URL =
  "https://www.irs.gov/charities-non-profits/exempt-organizations-business-master-file-extract-eo-bmf";
export const IRS_PUB78_ZIP_URL = "https://apps.irs.gov/pub/epostcard/data-download-pub78.zip";
export const IRS_REVOCATION_ZIP_URL =
  "https://apps.irs.gov/pub/epostcard/data-download-revocation.zip";
export const IRS_PUB78_ZIP_MEMBER = "data-download-pub78.txt";
export const IRS_REVOCATION_ZIP_MEMBER = "data-download-revocation.txt";

/** The EO BMF header, VERBATIM and in order (28 fields). Never re-order these. */
export const IRS_BMF_HEADER_COLUMNS: readonly string[] = [
  "EIN",
  "NAME",
  "ICO",
  "STREET",
  "CITY",
  "STATE",
  "ZIP",
  "GROUP",
  "SUBSECTION",
  "AFFILIATION",
  "CLASSIFICATION",
  "RULING",
  "DEDUCTIBILITY",
  "FOUNDATION",
  "ACTIVITY",
  "ORGANIZATION",
  "STATUS",
  "TAX_PERIOD",
  "ASSET_CD",
  "INCOME_CD",
  "FILING_REQ_CD",
  "PF_FILING_REQ_CD",
  "ACCT_PD",
  "ASSET_AMT",
  "INCOME_AMT",
  "REVENUE_AMT",
  "NTEE_CD",
  "SORT_NAME",
];
export const BMF_FIELD_COUNT = 28;
export const PUB78_FIELD_COUNT = 6;
export const REVOCATION_FIELD_COUNT = 12;
export type IrsMirrorSource = "eo_bmf" | "pub78" | "revocations";
export const IRS_MIRROR_SOURCES: readonly IrsMirrorSource[] = ["eo_bmf", "pub78", "revocations"];
/** Default batch size for both the diff queries and the staged inserts. */
export const IRS_IMPORT_BATCH_SIZE = 1000;

// ── Row shapes (the slim mirror columns of migration 045) ────────────────────
export interface BmfMirrorRow {
  ein: string;
  name: string;
  sort_name: string | null;
  state: string | null;
  subsection: string | null;
  status: string | null;
  group_no: string | null;
  ruling_year: string | null;
  ntee: string | null;
  content_hash: string;
}
export interface Pub78MirrorRow {
  ein: string;
  deductibility_code: string | null;
  content_hash: string;
}
export interface RevocationMirrorRow {
  ein: string;
  revocation_date: string | null;
  revocation_posting_date: string | null;
  reinstatement_date: string | null;
  /** The row's identity: the IRS file legitimately repeats an EIN (1,247,137 rows /
   *  1,227,732 EINs), so content, not the EIN, is the key. */
  row_hash: string;
}
export type IrsMirrorRow = BmfMirrorRow | Pub78MirrorRow | RevocationMirrorRow;

// ── Helpers ──────────────────────────────────────────────────────────────────
/** sha256 of the joined identity fields, truncated to 32 hex chars (128 bits). */
export function contentHash(parts: readonly (string | null | undefined)[]): string {
  return createHash("sha256").update(parts.map((p) => p ?? "\u0000").join("\u0001")).digest("hex").slice(0, 32);
}
/** The IRS files are CRLF and their dates are `DD-MON-YYYY` (e.g. 15-NOV-2017). */
const MONTHS = ["JAN", "FEB", "MAR", "APR", "MAY", "JUN", "JUL", "AUG", "SEP", "OCT", "NOV", "DEC"];
export function parseIrsDate(raw: string | null | undefined): string | null {
  const value = String(raw ?? "").trim();
  if (value.length === 0) return null;
  const match = /^(\d{2})-([A-Z]{3})-(\d{4})$/.exec(value.toUpperCase());
  if (!match) return null;
  const month = MONTHS.indexOf(match[2]) + 1;
  if (month === 0) return null;
  return `${match[3]}-${String(month).padStart(2, "0")}-${match[1]}`;
}
/** The EO BMF page's own "Updated data posting date: 9/8/2026" → `2026-09-08`. */
export function parseUsDate(raw: string | null | undefined): string | null {
  const match = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(String(raw ?? "").trim());
  if (!match) return null;
  return `${match[3]}-${match[1].padStart(2, "0")}-${match[2].padStart(2, "0")}`;
}
const EIN_RE = /^\d{9}$/;
/** The files already carry zero-padded 9-char EINs; anything else is quarantined. */
export function isMirrorEin(value: string): boolean {
  return EIN_RE.test(value);
}
/** A zero-padded EIN accepts an unpadded 1-9 digit value; never parse it as a number. */
export function normalizeMirrorEin(value: string): string | null {
  const digits = String(value ?? "").replace(/[^0-9]/g, "");
  if (digits.length === 0 || digits.length > 9) return null;
  return digits.padStart(9, "0");
}

// ── Zip reader (no dependency; the IRS zips hold exactly one member) ──────────
export interface ZipMemberHeader {
  name: string;
  method: number;
  compressedSize: number;
  uncompressedSize: number;
}
/** Parse a LOCAL file header at `offset` (offsets are buffer-relative). */
export function readZipLocalHeader(buffer: Buffer, offset = 0): ZipMemberHeader | null {
  if (buffer.length < offset + 30 || buffer.readUInt32LE(offset) !== 0x04034b50) return null;
  const method = buffer.readUInt16LE(offset + 8);
  const compressedSize = buffer.readUInt32LE(offset + 18);
  const uncompressedSize = buffer.readUInt32LE(offset + 22);
  const nameLength = buffer.readUInt16LE(offset + 26);
  const name = buffer.subarray(offset + 30, offset + 30 + nameLength).toString("utf8");
  return { name, method, compressedSize, uncompressedSize };
}
export interface ZipCentralEntry extends ZipMemberHeader {
  localHeaderOffset: number;
}
/** Read the central directory (the authoritative source for sizes/offsets). */
export function readZipCentralDirectory(buffer: Buffer): ZipCentralEntry[] {
  const EOCD = 0x06054b50;
  let eocd = -1;
  for (let i = buffer.length - 22; i >= 0 && i >= buffer.length - 22 - 65535; i--) {
    if (buffer.readUInt32LE(i) === EOCD) {
      eocd = i;
      break;
    }
  }
  if (eocd < 0) throw new Error("not a zip file: no end-of-central-directory record");
  const entryCount = buffer.readUInt16LE(eocd + 10);
  let offset = buffer.readUInt32LE(eocd + 16);
  const entries: ZipCentralEntry[] = [];
  for (let i = 0; i < entryCount; i++) {
    if (buffer.readUInt32LE(offset) !== 0x02014b50) throw new Error("corrupt zip: bad central header");
    const method = buffer.readUInt16LE(offset + 10);
    const compressedSize = buffer.readUInt32LE(offset + 20);
    const uncompressedSize = buffer.readUInt32LE(offset + 24);
    const nameLength = buffer.readUInt16LE(offset + 28);
    const extraLength = buffer.readUInt16LE(offset + 30);
    const commentLength = buffer.readUInt16LE(offset + 32);
    const localHeaderOffset = buffer.readUInt32LE(offset + 42);
    const name = buffer.subarray(offset + 46, offset + 46 + nameLength).toString("utf8");
    entries.push({ name, method, compressedSize, uncompressedSize, localHeaderOffset });
    offset += 46 + nameLength + extraLength + commentLength;
  }
  return entries;
}
/**
 * Extract a single member's bytes. `method 8` = raw deflate, `method 0` = stored.
 *
 * MEMORY NOTE: the IRS zips are 29.9 MB / 47.6 MB compressed and 101.8 MB / 148.3 MB
 * uncompressed, so this holds both in memory for the duration of the call (~200 MB
 * worst case). The ROW stream that follows is deliberately streamed, never buffered.
 */
export function readZipMember(buffer: Buffer, memberName: string): Buffer {
  const entry = readZipCentralDirectory(buffer).find((candidate) => candidate.name === memberName);
  if (!entry) {
    const names = readZipCentralDirectory(buffer)
      .map((candidate) => candidate.name)
      .join(", ");
    throw new Error(`zip member ${memberName} not found (members: ${names})`);
  }
  const header = readZipLocalHeader(buffer, entry.localHeaderOffset);
  if (!header) throw new Error(`corrupt zip: no local header for ${memberName}`);
  const nameLength = buffer.readUInt16LE(entry.localHeaderOffset + 26);
  const extraLength = buffer.readUInt16LE(entry.localHeaderOffset + 28);
  const start = entry.localHeaderOffset + 30 + nameLength + extraLength;
  const compressed = buffer.subarray(start, start + entry.compressedSize);
  if (entry.method === 0) return Buffer.from(compressed);
  if (entry.method !== 8) throw new Error(`unsupported zip compression method ${entry.method}`);
  return inflateRawSync(compressed);
}

// ── Streaming line iteration (never buffers a whole 165 MB file's rows) ───────
/**
 * CRLF-safe line iteration over a web ReadableStream. Decodes incrementally and yields
 * each line without its line terminator. Works under Bun and Node's `fetch` alike.
 */
export async function* iterateLines(stream: ReadableStream<Uint8Array>): AsyncGenerator<string> {
  const reader = stream.getReader();
  const decoder = new TextDecoder("utf-8");
  let pending = "";
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (value) {
        const text = decoder.decode(value, { stream: true });
        const parts = (pending + text).split("\n");
        pending = parts.pop() ?? "";
        for (const part of parts) yield part.endsWith("\r") ? part.slice(0, -1) : part;
      }
      if (done) break;
    }
    pending += decoder.decode();
    if (pending.length > 0) yield pending.endsWith("\r") ? pending.slice(0, -1) : pending;
  } finally {
    reader.releaseLock();
  }
}
/** Bytes → the same line iteration, for a buffer we already hold (the zips, fixtures). */
export function* iterateLinesOfText(text: string): Generator<string> {
  for (const part of text.split("\n")) {
    yield part.endsWith("\r") ? part.slice(0, -1) : part;
  }
}

// ── Parse statistics (the integrity evidence) ────────────────────────────────
export interface ParseStats {
  /** Data lines seen (header and blank lines excluded). */
  lineCount: number;
  rowCount: number;
  /** Rows that did not parse to the expected field count. MUST be 0 for a green run. */
  quarantined: { line: number; fields: number; sample: string }[];
  distinctEinCount: number;
  /** SHA-256 (32 hex chars) of the sorted distinct EIN list — a cheap cross-run identity. */
  einDigest: string;
}
export function newParseStats(): ParseStats {
  return { lineCount: 0, rowCount: 0, quarantined: [], distinctEinCount: 0, einDigest: "" };
}
/** The one cap on quarantine samples kept in memory (they exist to be shown, not counted twice). */
export const MAX_QUARANTINE_SAMPLES = 20;
/** Distinct-EIN tracking; disabled with `--no-distinct-check` on a memory-tight host. */
export class EinTracker {
  private readonly seen: Set<string> | null;
  constructor(enabled = true) {
    this.seen = enabled ? new Set<string>() : null;
  }
  add(ein: string): void {
    this.seen?.add(ein);
  }
  finish(stats: ParseStats): void {
    if (!this.seen) return;
    stats.distinctEinCount = this.seen.size;
    stats.einDigest = contentHash([[...this.seen].sort().join(",")]);
  }
}

// ── Parsers (pure; driven by the committed fixtures in the default test run) ──
/**
 * One EO BMF row (28 unquoted comma-separated fields, in IRS_BMF_HEADER_COLUMNS order).
 * `ICO` (field 3) is a PERSON's name and is deliberately dropped; `SORT_NAME` (28) is
 * officially the "SORT NAME LINE (SECONDARY NAME LINE)" and is kept as a second name.
 */
export function parseBmfRow(line: string, lineNumber = 0, stats?: ParseStats): BmfMirrorRow | null {
  const fields = line.split(",");
  if (fields.length !== BMF_FIELD_COUNT) {
    if (stats && stats.quarantined.length < MAX_QUARANTINE_SAMPLES) {
      stats.quarantined.push({
        line: lineNumber,
        fields: fields.length,
        sample: line.slice(0, 160),
      });
    }
    return null;
  }
  const ein = normalizeMirrorEin(fields[0]);
  if (!ein) return null;
  const row: BmfMirrorRow = {
    ein,
    name: fields[1],
    sort_name: fields[27] && fields[27].length > 0 ? fields[27] : null,
    state: fields[5] && fields[5].length > 0 ? fields[5] : null,
    subsection: fields[8] && fields[8].length > 0 ? fields[8] : null,
    group_no: fields[7] && fields[7].length > 0 ? fields[7] : null,
    ruling_year: fields[11] && fields[11].length > 0 ? fields[11] : null,
    status: fields[16] && fields[16].length > 0 ? fields[16] : null,
    ntee: fields[26] && fields[26].length > 0 ? fields[26] : null,
    content_hash: "",
  };
  // NOTHING that changes with every posting belongs in here: the hash answers "did this
  // org's record really change?", so including a date would make every row look changed
  // every month and destroy the whole point of the diff.
  row.content_hash = contentHash([
    row.ein,
    row.name,
    row.sort_name,
    row.state,
    row.subsection,
    row.status,
    row.group_no,
    row.ruling_year,
    row.ntee,
  ]);
  return row;
}
export function parseBmfHeader(line: string): { ok: boolean; columns: string[] } {
  const columns = line.split(",");
  const ok =
    columns.length === BMF_FIELD_COUNT &&
    columns.every((column, index) => column === IRS_BMF_HEADER_COLUMNS[index]);
  return { ok, columns };
}
/** `EIN|NAME|CITY|STATE|COUNTRY|DEDUCTIBILITY_CODE` — split on `|` only (codes contain commas). */
export function parsePub78Row(line: string, lineNumber = 0, stats?: ParseStats): Pub78MirrorRow | null {
  const fields = line.split("|");
  if (fields.length !== PUB78_FIELD_COUNT) {
    if (stats && stats.quarantined.length < MAX_QUARANTINE_SAMPLES) {
      stats.quarantined.push({ line: lineNumber, fields: fields.length, sample: line.slice(0, 160) });
    }
    return null;
  }
  const ein = normalizeMirrorEin(fields[0]);
  if (!ein) return null;
  const deductibility = fields[5] && fields[5].length > 0 ? fields[5] : null;
  return { ein, deductibility_code: deductibility, content_hash: contentHash([ein, deductibility]) };
}
/**
 * One auto-revocation row (12 pipe fields). Layout: EIN | NAME | name continuation |
 * STREET | CITY | STATE | ZIP | COUNTRY | SUBSECTION | REVOCATION_DATE |
 * REVOCATION_POSTING_DATE | <second date>.
 *
 * The 12th column's OFFICIAL name is not yet confirmed (research §1.d/§5: the empirical
 * read is "reinstatement date" — 59.7 % of the EINs carrying it are in Pub 78 versus
 * 1.9 % of those that are not). It is stored as `reinstatement_date` and is NEVER an
 * auto-approve signal: a revoked EIN goes to review either way.
 */
export function parseRevocationRow(
  line: string,
  lineNumber = 0,
  stats?: ParseStats,
): RevocationMirrorRow | null {
  const fields = line.split("|");
  if (fields.length !== REVOCATION_FIELD_COUNT) {
    if (stats && stats.quarantined.length < MAX_QUARANTINE_SAMPLES) {
      stats.quarantined.push({ line: lineNumber, fields: fields.length, sample: line.slice(0, 160) });
    }
    return null;
  }
  const ein = normalizeMirrorEin(fields[0]);
  if (!ein) return null;
  return {
    ein,
    revocation_date: parseIrsDate(fields[9]),
    revocation_posting_date: parseIrsDate(fields[10]),
    reinstatement_date: parseIrsDate(fields[11]),
    row_hash: contentHash([line.trim()]),
  };
}
/** Whole-payload convenience parsers (used by the fixture tests). */
export function parseBmfCsvText(text: string): { rows: BmfMirrorRow[]; stats: ParseStats; header: { ok: boolean; columns: string[] } } {
  const stats = newParseStats();
  const tracker = new EinTracker();
  const rows: BmfMirrorRow[] = [];
  let header = { ok: false, columns: [] as string[] };
  let first = true;
  for (const line of iterateLinesOfText(text)) {
    if (first) {
      first = false;
      header = parseBmfHeader(line);
      continue;
    }
    if (line.length === 0) continue;
    stats.lineCount += 1;
    const row = parseBmfRow(line, stats.lineCount, stats);
    if (!row) continue;
    stats.rowCount += 1;
    tracker.add(row.ein);
    rows.push(row);
  }
  tracker.finish(stats);
  return { rows, stats, header };
}
export function parsePub78Text(text: string): { rows: Pub78MirrorRow[]; stats: ParseStats } {
  const stats = newParseStats();
  const tracker = new EinTracker();
  const rows: Pub78MirrorRow[] = [];
  for (const line of iterateLinesOfText(text)) {
    if (line.length === 0) continue; // the file begins with blank lines
    stats.lineCount += 1;
    const row = parsePub78Row(line, stats.lineCount, stats);
    if (!row) continue;
    stats.rowCount += 1;
    tracker.add(row.ein);
    rows.push(row);
  }
  tracker.finish(stats);
  return { rows, stats };
}
export function parseRevocationText(text: string): { rows: RevocationMirrorRow[]; stats: ParseStats } {
  const stats = newParseStats();
  const tracker = new EinTracker();
  const rows: RevocationMirrorRow[] = [];
  for (const line of iterateLinesOfText(text)) {
    if (line.length === 0) continue;
    stats.lineCount += 1;
    const row = parseRevocationRow(line, stats.lineCount, stats);
    if (!row) continue;
    stats.rowCount += 1;
    tracker.add(row.ein);
    rows.push(row);
  }
  tracker.finish(stats);
  return { rows, stats };
}

// ── Completeness proof (§1.a) ────────────────────────────────────────────────
export interface BmfPublication {
  recordCount: number | null;
  postingDate: string | null;
}
/**
 * Read the IRS's OWN numbers off the EO BMF page: "Updated data posting date: 9/8/2026"
 * and "Record count: 1,964,958". HTML is not parsed as a document — the two labelled
 * numbers are matched directly, and a missing number is a FAILURE (null), never a guess.
 */
export function parseBmfPublication(html: string): BmfPublication {
  const text = html.replace(/<[^>]*>/g, " ").replace(/&nbsp;/g, " ");
  const posting = /Updated data posting date:\s*([0-9]{1,2}\/[0-9]{1,2}\/[0-9]{4})/i.exec(text);
  const count = /Record count:\s*([0-9][0-9,]*)/i.exec(text);
  return {
    recordCount: count ? Number(count[1].replace(/,/g, "")) : null,
    postingDate: parseUsDate(posting?.[1] ?? null),
  };
}
export interface BmfCompletenessInput {
  regionRowCounts: number[];
  published: BmfPublication;
  stats: ParseStats;
  headerOk: boolean;
  /** A bounded smoke run cannot prove completeness; it is reported as such. */
  bounded?: boolean;
}
export interface CompletenessReport {
  ok: boolean;
  totalRows: number;
  publishedRecordCount: number | null;
  distinctEinCount: number;
  quarantinedCount: number;
  failures: string[];
}
/**
 * THE acceptance test from the research: the four region row counts must SUM TO the
 * record count the IRS prints. Plus: zero malformed rows (the strict 28-field parse is
 * the contract), zero duplicate EINs, and an unchanged header.
 */
export function verifyBmfCompleteness(input: BmfCompletenessInput): CompletenessReport {
  const totalRows = input.regionRowCounts.reduce((sum, count) => sum + count, 0);
  const failures: string[] = [];
  if (!input.headerOk) failures.push("header_mismatch");
  if (input.stats.quarantined.length > 0) failures.push("malformed_rows");
  if (input.stats.rowCount !== totalRows) failures.push("row_count_mismatch");
  if (input.stats.distinctEinCount !== 0 && input.stats.distinctEinCount !== input.stats.rowCount) {
    failures.push("duplicate_eins");
  }
  if (input.published.recordCount == null) {
    failures.push("published_record_count_unavailable");
  } else if (input.published.recordCount !== totalRows) {
    failures.push("published_record_count_mismatch");
  }
  if (input.bounded) failures.push("bounded_run");
  return {
    ok: failures.length === 0,
    totalRows,
    publishedRecordCount: input.published.recordCount ?? null,
    distinctEinCount: input.stats.distinctEinCount,
    quarantinedCount: input.stats.quarantined.length,
    failures,
  };
}

// ── The write plan (what `--verify` reports and `--import` performs) ──────────
export interface MirrorDiff {
  source: IrsMirrorSource;
  liveRowCount: number;
  newRowCount: number;
  inserted: number;
  updated: number;
  unchanged: number;
  pruned: number;
  quarantined: number;
  /** Hashes of the rows whose content really changed (sample, for the log). */
  changedSample: string[];
}
export function emptyDiff(source: IrsMirrorSource): MirrorDiff {
  return {
    source,
    liveRowCount: 0,
    newRowCount: 0,
    inserted: 0,
    updated: 0,
    unchanged: 0,
    pruned: 0,
    quarantined: 0,
    changedSample: [],
  };
}
/**
 * The key a source is compared by: the EIN for the BMF/Pub 78 (both are one row per
 * EIN), and the row's own content hash for the revocation list (an EIN legitimately
 * carries more than one revocation).
 */
export function mirrorKeyOf(source: IrsMirrorSource, row: IrsMirrorRow): string {
  if (source === "revocations") return (row as RevocationMirrorRow).row_hash;
  return (row as BmfMirrorRow).ein;
}
/** The content hash a source compares with (for revocations the key IS the content). */
export function mirrorHashOf(source: IrsMirrorSource, row: IrsMirrorRow): string {
  if (source === "revocations") return (row as RevocationMirrorRow).row_hash;
  return (row as BmfMirrorRow | Pub78MirrorRow).content_hash;
}

// ── Store interface (fake in tests, Neon in production) ──────────────────────
export interface IrsMirrorStore {
  /** Live row count for a source (the base for the prune count). */
  countRows(source: IrsMirrorSource): Promise<number>;
  /**
   * Map key → stored content hash for the keys that exist. Keys absent from the map do
   * not exist. Batched by the caller: never asked for 2 M keys at once.
   */
  fetchExistingHashes(source: IrsMirrorSource, keys: string[]): Promise<Map<string, string>>;
  /** Begin a run's staging table; a failed run must leave the live table untouched. */
  beginStage(source: IrsMirrorSource): Promise<void>;
  /** Insert one batch into the staging table. Insert-only: no row is ever rewritten. */
  writeStage(source: IrsMirrorSource, rows: IrsMirrorRow[], postingDate: string | null): Promise<void>;
  /** The one transaction: rename the live table aside, the staging table into place, drop the old. */
  commitStage(source: IrsMirrorSource): Promise<void>;
  /** Drop the staging table after a failed run (writes nothing to the live table). */
  abortStage(source: IrsMirrorSource): Promise<void>;
  /**
   * The guarded incremental path. NOT used by a full refresh (which swaps), kept for a
   * future partial update: the `WHERE content_hash IS DISTINCT FROM EXCLUDED.content_hash`
   * guard means an unchanged row is never rewritten.
   */
  upsertBatch(source: IrsMirrorSource, rows: IrsMirrorRow[], postingDate: string | null): Promise<void>;
  recordRun(entry: IrsMirrorRunEntry): Promise<void>;
}

export interface IrsMirrorRunEntry {
  source: IrsMirrorSource;
  payload: string;
  postingDate: string | null;
  mode: "verify" | "import";
  status: "ok" | "error";
  rowCount: number;
  distinctEinCount: number | null;
  quarantinedCount: number;
  insertedCount: number;
  updatedCount: number;
  unchangedCount: number;
  prunedCount: number;
  error: string | null;
  startedAt?: string;
  finishedAt?: string;
}

// ── Orchestration ────────────────────────────────────────────────────────────
export interface IrsMirrorRunOptions {
  mode: "verify" | "import";
  sources?: readonly IrsMirrorSource[];
  /** Read already-downloaded payloads from this directory instead of the network. */
  sourceDir?: string | null;
  batchSize?: number;
  /** Bounded smoke run: stops after N rows and can never import. */
  maxRows?: number | null;
  /** Disable the in-memory distinct-EIN set on a memory-tight host. */
  distinctCheck?: boolean;
}
export interface IrsMirrorDeps {
  fetchFn?: typeof fetch;
  store?: IrsMirrorStore;
  log?: (message: string) => void;
  now?: () => Date;
}
export interface SourceRunSummary {
  source: IrsMirrorSource;
  ok: boolean;
  postingDate: string | null;
  rowCount: number;
  diff: MirrorDiff;
  failures: string[];
  stats: ParseStats;
  publication?: BmfPublication;
}
export interface IrsMirrorRunSummary {
  mode: "verify" | "import";
  startedAt: string;
  finishedAt: string;
  sources: SourceRunSummary[];
  ok: boolean;
}

/** One payload (a URL, or a file inside `--source-dir`) that feeds a source. */
interface IrsPayload {
  label: string;
  url: string;
  /** When set, the payload arrives as this member of a zip. */
  zipMember?: string;
  /** When set, the payload's file name inside `--source-dir` when it is not zipped. */
  fileName?: string;
}
export function payloadsForSource(source: IrsMirrorSource): IrsPayload[] {
  switch (source) {
    case "eo_bmf":
      return IRS_BMF_REGION_URLS.map((url) => ({ label: url.split("/").pop() ?? url, url }));
    case "pub78":
      return [
        {
          label: IRS_PUB78_ZIP_MEMBER,
          url: IRS_PUB78_ZIP_URL,
          zipMember: IRS_PUB78_ZIP_MEMBER,
          fileName: "pub78.zip",
        },
      ];
    case "revocations":
      return [
        {
          label: IRS_REVOCATION_ZIP_MEMBER,
          url: IRS_REVOCATION_ZIP_URL,
          zipMember: IRS_REVOCATION_ZIP_MEMBER,
          fileName: "revocation.zip",
        },
      ];
  }
}

/**
 * Open a payload as a byte stream. Two paths only: the official URL, or a directory the
 * caller has already downloaded into (`--source-dir`, for a bounded/offline run). The
 * zip path is needed for the two pipe-delimited datasets, whose payloads are zip-only.
 *
 * ZIP PAYLOADS ARE UNZIPPED ON BOTH PATHS. A zip member cannot be located from a
 * forward-only stream — its offset and size live in the central directory at the END of
 * the archive — so an HTTP zip payload is buffered (bounded, see
 * MAX_ZIP_ARCHIVE_BYTES), the member inflated out of it, and only then does the row
 * stream begin. Without this the parser would read the raw archive and every line would
 * be malformed, which is exactly what the import-mode tests caught.
 */
export async function openPayloadStream(
  payload: IrsPayload,
  options: IrsMirrorRunOptions,
  deps: IrsMirrorDeps,
): Promise<ReadableStream<Uint8Array>> {
  if (options.sourceDir) {
    const dir = options.sourceDir;
    if (payload.zipMember) {
      const bytes = await readFile(`${dir}/${payload.fileName}`);
      return bytesStream(readZipMember(bytes, payload.zipMember));
    }
    try {
      return bytesStream(await readFile(`${dir}/${payload.label}`));
    } catch {
      const bytes = await readFile(`${dir}/${payload.fileName ?? payload.label}`);
      return bytesStream(bytes);
    }
  }
  const fetchFn = deps.fetchFn ?? fetch;
  const response = await fetchFn(payload.url, {
    headers: {
      // The irs.gov CSVs and the epostcard zips are plain static objects: no key, no
      // cookie, no session, no anti-bot measure to satisfy. The Accept header is just
      // politeness; nothing here defeats or works around a WAF.
      Accept: "text/csv,application/zip,*/*",
      "User-Agent": "ContraxNonprofitVerification/1.0 (+https://www.contrax.company)",
    },
  });
  if (!response.ok) throw new Error(`GET ${payload.url} → HTTP ${response.status}`);
  if (!response.body) throw new Error(`GET ${payload.url} → empty body`);
  if (payload.zipMember) {
    const archive = await readResponseBytes(response, payload, MAX_ZIP_ARCHIVE_BYTES);
    return bytesStream(readZipMember(archive, payload.zipMember));
  }
  return response.body;
}
/**
 * Hard cap on the ARCHIVE held in memory to extract one zip member over HTTP. The IRS's
 * two zip payloads are 29.9 MB / 47.6 MB compressed, so 128 MB leaves a wide margin over
 * both real files while refusing a body that is not the file we asked for.
 */
export const MAX_ZIP_ARCHIVE_BYTES = 128 * 1024 * 1024;
/** Read a response body into one Buffer, refusing anything larger than `maxBytes`. */
export async function readResponseBytes(
  response: Response,
  payload: IrsPayload,
  maxBytes: number,
): Promise<Buffer> {
  if (!response.body) throw new Error(`GET ${payload.url} → empty body`);
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (value) {
        total += value.byteLength;
        if (total > maxBytes) {
          throw new Error(`GET ${payload.url} → payload exceeds ${maxBytes} bytes`);
        }
        chunks.push(value);
      }
      if (done) break;
    }
  } finally {
    reader.releaseLock();
  }
  return Buffer.concat(chunks, total);
}
function bytesStream(bytes: Buffer | Uint8Array): ReadableStream<Uint8Array> {
  return new Blob([new Uint8Array(bytes)]).stream() as unknown as ReadableStream<Uint8Array>;
}

/** Fetch and read the IRS's own record count + posting date for the extract. */
export async function fetchBmfPublication(deps: IrsMirrorDeps = {}): Promise<BmfPublication> {
  const fetchFn = deps.fetchFn ?? fetch;
  const response = await fetchFn(IRS_BMF_LANDING_URL, {
    headers: { Accept: "text/html,*/*" },
  });
  if (!response.ok) throw new Error(`GET ${IRS_BMF_LANDING_URL} → HTTP ${response.status}`);
  return parseBmfPublication(await response.text());
}

/**
 * Refresh ONE source: stream every payload, prove integrity, count the diff against the
 * live mirror, and (import mode only) swap the staged table in.
 *
 * FAIL-CLOSED: a source that fails its completeness/integrity proof records an `error`
 * run and writes NOTHING to the live table — the previous month's mirror stays served
 * and stays labelled with its own posting date. Silence is never coverage.
 */
export async function refreshIrsSource(
  source: IrsMirrorSource,
  options: IrsMirrorRunOptions,
  deps: IrsMirrorDeps = {},
): Promise<SourceRunSummary> {
  const log = deps.log ?? (() => {});
  const stats = newParseStats();
  const diff = emptyDiff(source);
  const failures: string[] = [];
  const payloads = payloadsForSource(source);
  const batchSize = options.batchSize ?? IRS_IMPORT_BATCH_SIZE;
  const bounded = options.maxRows != null;
  const importMode = options.mode === "import" && !bounded;
  const store = deps.store;
  let payloadLabel = payloads.map((p) => p.label).join("+");
  let publication: BmfPublication | undefined;
  let postingDate: string | null = null;

  if (source === "eo_bmf") {
    try {
      publication = await fetchBmfPublication(deps);
      postingDate = publication.postingDate;
      if (publication.recordCount == null) failures.push("published_record_count_unavailable");
    } catch (error) {
      failures.push("publication_unavailable");
      log(`[irs-mirror] ${source}: publication page unreadable — ${(error as Error).message}`);
    }
  }

  if (store) diff.liveRowCount = await store.countRows(source);

  if (importMode) await store?.beginStage(source);

  // ── Stream + parse + (import only) stage ───────────────────────────────────
  let batch: IrsMirrorRow[] = [];
  const regionRowCounts: number[] = [];
  const tracker = new EinTracker(options.distinctCheck !== false);
  let headerOk = source !== "eo_bmf";
  const flush = async () => {
    if (batch.length === 0) return;
    if (store) {
      const keys = batch.map((row) => mirrorKeyOf(source, row));
      const existing = await store.fetchExistingHashes(source, keys);
      for (const row of batch) {
        const stored = existing.get(mirrorKeyOf(source, row));
        if (stored === undefined) diff.inserted += 1;
        else if (stored === mirrorHashOf(source, row)) diff.unchanged += 1;
        else {
          diff.updated += 1;
          if (diff.changedSample.length < 10) diff.changedSample.push(mirrorKeyOf(source, row));
        }
      }
      if (importMode) await store.writeStage(source, batch, postingDate);
    } else {
      // No store: a pure parse run (the fixture tests). Counts are all "inserted".
      diff.inserted += batch.length;
    }
    batch = [];
  };

  try {
    for (const payload of payloads) {
      const stream = await openPayloadStream(payload, options, deps);
      const rowsBefore = stats.rowCount;
      let lineNumber = 0;
      let headerSeen = false;
      for await (const rawLine of iterateLines(stream)) {
        lineNumber += 1;
        if (source === "eo_bmf" && !headerSeen) {
          headerSeen = true;
          const header = parseBmfHeader(rawLine);
          headerOk = header.ok;
          if (!header.ok) {
            // A reordered or renamed column would mis-map EVERY field. Hard failure.
            failures.push("header_mismatch");
            payloadLabel = `${payload.label} (header: ${header.columns.slice(0, 4).join(",")}…)`;
          }
          continue;
        }
        if (rawLine.length === 0) continue;
        stats.lineCount += 1;
        const row =
          source === "eo_bmf"
            ? parseBmfRow(rawLine, stats.lineCount, stats)
            : source === "pub78"
              ? parsePub78Row(rawLine, stats.lineCount, stats)
              : parseRevocationRow(rawLine, stats.lineCount, stats);
        if (!row) continue;
        stats.rowCount += 1;
        tracker.add((row as { ein: string }).ein);
        batch.push(row);
        if (batch.length >= batchSize) await flush();
        if (options.maxRows != null && stats.rowCount >= options.maxRows) break;
      }
      regionRowCounts.push(stats.rowCount - rowsBefore);
      if (options.maxRows != null && stats.rowCount >= options.maxRows) break;
    }
    await flush();
  } catch (error) {
    if (importMode) await store?.abortStage(source);
    tracker.finish(stats);
    diff.quarantined = stats.quarantined.length;
    diff.newRowCount = stats.rowCount;
    throw Object.assign(error as Error, { partialStats: stats, diff });
  }
  tracker.finish(stats);
  diff.quarantined = stats.quarantined.length;
  diff.newRowCount = stats.rowCount;
  // A row in the live table that is neither updated nor unchanged is a row the source
  // stopped publishing — the swap removes it, and the number is reported up front.
  diff.pruned = Math.max(0, diff.liveRowCount - (diff.updated + diff.unchanged));

  // ── Integrity proof ────────────────────────────────────────────────────────
  if (stats.quarantined.length > 0) failures.push("malformed_rows");
  if (source === "eo_bmf") {
    const report = verifyBmfCompleteness({
      regionRowCounts,
      published: publication ?? { recordCount: null, postingDate: null },
      stats,
      headerOk,
      bounded,
    });
    for (const failure of report.failures) if (!failures.includes(failure)) failures.push(failure);
  } else if (bounded) {
    failures.push("bounded_run");
  }

  // ── Swap (import) or stop cleanly (verify) ─────────────────────────────────
  const ok = failures.length === 0;
  if (importMode) {
    if (ok) await store?.commitStage(source);
    else await store?.abortStage(source);
  }
  const summary: SourceRunSummary = {
    source,
    ok,
    postingDate,
    rowCount: stats.rowCount,
    diff,
    failures,
    stats,
    ...(publication ? { publication } : {}),
  };
  await store?.recordRun({
    source,
    payload: payloadLabel,
    postingDate,
    mode: options.mode,
    status: ok ? "ok" : "error",
    rowCount: stats.rowCount,
    distinctEinCount: stats.distinctEinCount,
    quarantinedCount: stats.quarantined.length,
    insertedCount: diff.inserted,
    updatedCount: diff.updated,
    unchangedCount: diff.unchanged,
    prunedCount: diff.pruned,
    error: ok ? null : failures.join(","),
  });
  return summary;
}

/** Every source, one after another. One source's failure never touches another's rows. */
export async function runIrsMirrorRefresh(
  options: IrsMirrorRunOptions,
  deps: IrsMirrorDeps = {},
): Promise<IrsMirrorRunSummary> {
  const log = deps.log ?? (() => {});
  const clock = deps.now ?? (() => new Date());
  const startedAt = clock().toISOString();
  const sources = options.sources ?? IRS_MIRROR_SOURCES;
  const summaries: SourceRunSummary[] = [];
  for (const source of sources) {
    log(`[irs-mirror] ${source}: starting (${options.mode}${options.sourceDir ? ", source-dir" : ""})`);
    try {
      const summary = await refreshIrsSource(source, options, deps);
      summaries.push(summary);
      log(
        `[irs-mirror] ${source}: ${summary.ok ? "OK" : "FAILED"} rows=${summary.rowCount} ` +
          `insert=${summary.diff.inserted} update=${summary.diff.updated} unchanged=${summary.diff.unchanged} ` +
          `prune=${summary.diff.pruned} quarantined=${summary.diff.quarantined}` +
          `${summary.failures.length > 0 ? ` failures=${summary.failures.join(",")}` : ""}`,
      );
    } catch (error) {
      const message = (error as Error)?.message ?? String(error);
      log(`[irs-mirror] ${source}: ERROR ${message}`);
      const partial = (error as { partialStats?: ParseStats; diff?: MirrorDiff }).partialStats;
      const partialDiff = (error as { diff?: MirrorDiff }).diff;
      await deps.store?.recordRun({
        source,
        payload: payloadsForSource(source)
          .map((payload) => payload.label)
          .join("+"),
        postingDate: null,
        mode: options.mode,
        status: "error",
        rowCount: partial?.rowCount ?? 0,
        distinctEinCount: partial?.distinctEinCount ?? null,
        quarantinedCount: partial?.quarantined.length ?? 0,
        insertedCount: partialDiff?.inserted ?? 0,
        updatedCount: 0,
        unchangedCount: 0,
        prunedCount: 0,
        error: message.slice(0, 500),
      });
      summaries.push({
        source,
        ok: false,
        postingDate: null,
        rowCount: partial?.rowCount ?? 0,
        diff: partialDiff ?? emptyDiff(source),
        failures: ["fetch_or_parse_error"],
        stats: partial ?? newParseStats(),
      });
    }
  }
  return {
    mode: options.mode,
    startedAt,
    finishedAt: clock().toISOString(),
    sources: summaries,
    ok: summaries.every((summary) => summary.ok),
  };
}

// ── The production store (Neon) ─────────────────────────────────────────────
/** The live table for a source. */
export const LIVE_TABLE: Readonly<Record<IrsMirrorSource, string>> = {
  eo_bmf: "irs_eo_bmf",
  pub78: "irs_pub78",
  revocations: "irs_revocations",
};
/** The run's staging table: written row by row, then renamed into place, or dropped. */
export const STAGE_TABLE: Readonly<Record<IrsMirrorSource, string>> = {
  eo_bmf: "irs_eo_bmf_staging",
  pub78: "irs_pub78_staging",
  revocations: "irs_revocations_staging",
};
/** The column each source is compared by. */
export const KEY_COLUMN: Readonly<Record<IrsMirrorSource, string>> = {
  eo_bmf: "ein",
  pub78: "ein",
  revocations: "row_hash",
};
export const HASH_COLUMN: Readonly<Record<IrsMirrorSource, string>> = {
  eo_bmf: "content_hash",
  pub78: "content_hash",
  revocations: "row_hash",
};

export const neonIrsMirrorStore: IrsMirrorStore = {
  async countRows(source) {
    const table = LIVE_TABLE[source];
    const rows = (await sql()`SELECT count(*)::int AS n FROM ${sql().unsafe(table)}`) as { n: number }[];
    return Number(rows[0]?.n ?? 0);
  },
  async fetchExistingHashes(source, keys) {
    const result = new Map<string, string>();
    if (keys.length === 0) return result;
    const table = LIVE_TABLE[source];
    const key = KEY_COLUMN[source];
    const hash = HASH_COLUMN[source];
    const rows = (await sql()`
      SELECT ${sql().unsafe(key)} AS k, ${sql().unsafe(hash)} AS h
      FROM ${sql().unsafe(table)}
      WHERE ${sql().unsafe(key)} = ANY(${keys})
    `) as { k: string; h: string }[];
    for (const row of rows) result.set(String(row.k), String(row.h));
    return result;
  },
  async beginStage(source) {
    const stage = STAGE_TABLE[source];
    const live = LIVE_TABLE[source];
    // LIKE ... INCLUDING DEFAULTS only: the staging table gets NO index or constraint of
    // its own until the swap, because Postgres would otherwise try to reuse the live
    // table's constraint names and collide with them.
    await sql()`DROP TABLE IF EXISTS ${sql().unsafe(stage)}`;
    await sql()`CREATE TABLE ${sql().unsafe(stage)} (LIKE ${sql().unsafe(live)} INCLUDING DEFAULTS)`;
  },
  async writeStage(source, rows, postingDate) {
    const stage = STAGE_TABLE[source];
    if (source === "eo_bmf") {
      const values = rows as BmfMirrorRow[];
      await sql()`
        INSERT INTO ${sql().unsafe(stage)}
          (ein, name, sort_name, state, subsection, status, group_no, ruling_year, ntee, posting_date, content_hash)
        SELECT * FROM unnest(
          ${values.map((row) => row.ein)}::char(9)[],
          ${values.map((row) => row.name)}::text[],
          ${values.map((row) => row.sort_name)}::text[],
          ${values.map((row) => row.state)}::text[],
          ${values.map((row) => row.subsection)}::text[],
          ${values.map((row) => row.status)}::text[],
          ${values.map((row) => row.group_no)}::text[],
          ${values.map((row) => row.ruling_year)}::text[],
          ${values.map((row) => row.ntee)}::text[],
          ${values.map(() => postingDate)}::date[],
          ${values.map((row) => row.content_hash)}::text[]
        )
      `;
      return;
    }
    if (source === "pub78") {
      const values = rows as Pub78MirrorRow[];
      await sql()`
        INSERT INTO ${sql().unsafe(stage)} (ein, deductibility_code, posting_date, content_hash)
        SELECT * FROM unnest(
          ${values.map((row) => row.ein)}::char(9)[],
          ${values.map((row) => row.deductibility_code)}::text[],
          ${values.map(() => postingDate)}::date[],
          ${values.map((row) => row.content_hash)}::text[]
        )
      `;
      return;
    }
    const values = rows as RevocationMirrorRow[];
    await sql()`
      INSERT INTO ${sql().unsafe(stage)}
        (ein, revocation_date, revocation_posting_date, reinstatement_date, row_hash, posting_date)
      SELECT * FROM unnest(
        ${values.map((row) => row.ein)}::char(9)[],
        ${values.map((row) => row.revocation_date)}::date[],
        ${values.map((row) => row.revocation_posting_date)}::date[],
        ${values.map((row) => row.reinstatement_date)}::date[],
        ${values.map((row) => row.row_hash)}::text[],
        ${values.map(() => postingDate)}::date[]
      )
    `;
  },
  async commitStage(source) {
    const stage = STAGE_TABLE[source];
    const live = LIVE_TABLE[source];
    const previous = `${live}_previous`;
    // ONE transaction: the identity column is added here (the staged table deliberately
    // has none yet), then the live table steps aside, the staging table takes its name
    // and the old table is dropped. Readers see the old table until the commit and the
    // new one after it — never a half-swapped mirror.
    await sql()`${sql().unsafe(
      `DO $swap$
       BEGIN
         IF NOT EXISTS (
           SELECT 1 FROM pg_constraint WHERE conname = '${oneLine(stage)}_key'
         ) THEN
           ALTER TABLE ${oneLine(stage)} ADD CONSTRAINT ${oneLine(stage)}_key UNIQUE (${oneLine(
             KEY_COLUMN[source],
           )});
         END IF;
         DROP TABLE IF EXISTS ${oneLine(previous)};
         ALTER TABLE ${oneLine(live)} RENAME TO ${oneLine(previous)};
         ALTER TABLE ${oneLine(stage)} RENAME TO ${oneLine(live)};
         DROP TABLE ${oneLine(previous)};
       END
       $swap$`,
    )}`;
  },
  async abortStage(source) {
    const stage = STAGE_TABLE[source];
    await sql()`DROP TABLE IF EXISTS ${sql().unsafe(stage)}`;
  },
  async upsertBatch(source, rows, postingDate) {
    // The guarded incremental path (see IrsMirrorStore). Unchanged rows are not rewritten.
    const live = LIVE_TABLE[source];
    void postingDate;
    void live;
    void rows;
    void source;
    throw new Error("upsertBatch is not wired to Neon yet — a full refresh swaps instead");
  },
  async recordRun(entry) {
    await sql()`
      INSERT INTO irs_mirror_runs (
        source, payload, posting_date, row_count, distinct_ein_count, quarantined_count,
        inserted_count, updated_count, unchanged_count, pruned_count, mode, status, error,
        finished_at
      ) VALUES (
        ${entry.source}, ${entry.payload}, ${entry.postingDate}, ${entry.rowCount},
        ${entry.distinctEinCount}, ${entry.quarantinedCount}, ${entry.insertedCount},
        ${entry.updatedCount}, ${entry.unchangedCount}, ${entry.prunedCount}, ${entry.mode},
        ${entry.status}, ${entry.error}, NOW()
      )
    `;
  },
};
/** An identifier we build into DDL — refuse anything that is not a plain identifier. */
function oneLine(identifier: string): string {
  if (!/^[a-z_][a-z0-9_]*$/.test(identifier)) {
    throw new Error(`refusing to interpolate an unsafe identifier: ${identifier}`);
  }
  return identifier;
}

// ── CLI ─────────────────────────────────────────────────────────────────────
export interface IrsMirrorCliArgs {
  mode: "verify" | "import";
  sources: IrsMirrorSource[];
  sourceDir: string | null;
  maxRows: number | null;
  distinctCheck: boolean;
}
export function parseIrsMirrorArgs(argv: readonly string[]): IrsMirrorCliArgs {
  const args: IrsMirrorCliArgs = {
    // VERIFY IS THE DEFAULT. A bare `bun run …` must never start a 340 MB download that
    // rewrites a national dataset; the import needs `--import` said out loud.
    mode: "verify",
    sources: [...IRS_MIRROR_SOURCES],
    sourceDir: null,
    maxRows: null,
    distinctCheck: true,
  };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--verify") args.mode = "verify";
    else if (arg === "--import") args.mode = "import";
    else if (arg === "--no-distinct-check") args.distinctCheck = false;
    else if (arg === "--source") args.sources = [String(argv[++i]) as IrsMirrorSource];
    else if (arg === "--source-dir") args.sourceDir = String(argv[++i] ?? "");
    else if (arg === "--max-rows") args.maxRows = Number(argv[++i] ?? 0) || null;
  }
  return args;
}

async function main(): Promise<void> {
  const args = parseIrsMirrorArgs(process.argv.slice(2));
  if (args.mode === "import" && args.maxRows != null) {
    console.error("[irs-mirror] --max-rows is a bounded smoke run: refusing to import");
    process.exit(1);
  }
  const summary = await runIrsMirrorRefresh(
    {
      mode: args.mode,
      sources: args.sources,
      sourceDir: args.sourceDir,
      maxRows: args.maxRows,
      distinctCheck: args.distinctCheck,
    },
    { store: neonIrsMirrorStore, log: (message) => console.log(message) },
  );
  console.log(`[irs-mirror] ${args.mode} ${summary.ok ? "COMPLETE" : "FAILED"}`);
  if (!summary.ok) process.exitCode = 1;
}

if ((import.meta as ImportMeta & { main?: boolean }).main) {
  await main();
}
