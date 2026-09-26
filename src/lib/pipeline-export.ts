/**
 * PIPELINE CSV EXPORT — the minimal-but-REAL export behind the Bid Scout gate
 * (owner decision 2, 2026-09-26).
 *
 * Until now "CSV Pipeline Export" was unbuilt copy that Starter advertised. The
 * ratified map puts export in Bid Scout ($99/mo), so this module is the engine:
 * a real CSV download of the user's OWN saved pipeline rows (the same rows
 * /pipeline and /api/my-pipeline render), with RFC-4180-correct quoting.
 *
 * NOTHING is fabricated: every cell comes from the stored saved_matches ⋈ bids
 * row; a missing value is the empty cell, never an invented "unknown" figure in
 * a cell a spreadsheet would treat as data.
 *
 * Pure + injectable: `toPipelineCsv` is a pure function and `loadPipelineRows`
 * takes a store, so both are unit-tested with no database (no mock.module —
 * see WORKFLOW/PR notes; bun's mock registry is process-global and leaks).
 */
import { sql } from "~/db";

/** One exported pipeline row (column order = PIPELINE_CSV_COLUMNS). */
export interface PipelineExportRow {
  bid_id: number;
  title: string;
  agency: string | null;
  set_aside: string | null;
  category: string | null;
  location: string | null;
  estimated_value: string | null;
  due_date: string | null;
  status: string | null;
  saved_at: string | null;
  source_url: string | null;
}

/** The header row, in the exact order toPipelineCsv writes cells. */
export const PIPELINE_CSV_COLUMNS: readonly string[] = [
  "Bid ID",
  "Title",
  "Agency",
  "Set-aside",
  "Category",
  "Location",
  "Estimated value",
  "Due date",
  "Status",
  "Saved at",
  "Source URL",
];

/**
 * One CSV cell. RFC-4180: a value containing a quote, comma, CR or LF is
 * wrapped in double quotes with inner quotes doubled. Values are exported
 * verbatim (no trimming/invention) so the file always matches what the pipeline
 * page shows.
 */
export function csvCell(value: unknown): string {
  if (value == null) return "";
  const s = String(value);
  if (s === "") return "";
  if (/[",\r\n]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

/** The row as an array of cells, in PIPELINE_CSV_COLUMNS order. */
export function pipelineRowCells(row: PipelineExportRow): string[] {
  return [
    String(row.bid_id),
    row.title,
    row.agency,
    row.set_aside,
    row.category,
    row.location,
    row.estimated_value,
    row.due_date,
    row.status,
    row.saved_at,
    row.source_url,
  ].map(csvCell);
}

/**
 * The complete CSV document: header + one line per saved row, CRLF-terminated
 * (RFC 4180) so Excel/Sheets open it without prompting. An empty pipeline is a
 * header-only file — never a fabricated row.
 */
export function toPipelineCsv(rows: readonly PipelineExportRow[]): string {
  const lines = [PIPELINE_CSV_COLUMNS.map(csvCell).join(",")];
  for (const row of rows) lines.push(pipelineRowCells(row).join(","));
  return lines.join("\r\n") + "\r\n";
}

/** The download filename (date-stamped; the user's own data only). */
export function pipelineCsvFilename(now: Date = new Date()): string {
  const iso = now.toISOString().slice(0, 10);
  return `contrax-pipeline-${iso}.csv`;
}

/** Read seam — the Neon query lives behind this so tests inject rows. */
export interface PipelineExportStore {
  listSavedRows(userId: number): Promise<PipelineExportRow[]>;
}

export const neonPipelineExportStore: PipelineExportStore = {
  async listSavedRows(userId) {
    const rows = (await sql()`
      SELECT sm.bid_id, sm.status, sm.created_at,
             b.title, b.agency, b.estimated_value, b.due_date, b.location,
             b.category, b.source_url, b.set_aside
      FROM saved_matches sm
      JOIN bids b ON b.id = sm.bid_id
      WHERE sm.user_id = ${userId} AND sm.status = 'saved'
      ORDER BY sm.created_at DESC NULLS LAST, b.due_date ASC NULLS LAST
    `) as Array<Record<string, unknown>>;
    return rows.map((r) => ({
      bid_id: Number(r.bid_id),
      title: r.title == null ? "" : String(r.title),
      agency: r.agency == null ? null : String(r.agency),
      set_aside: r.set_aside == null ? null : String(r.set_aside),
      category: r.category == null ? null : String(r.category),
      location: r.location == null ? null : String(r.location),
      estimated_value: r.estimated_value == null ? null : String(r.estimated_value),
      due_date: r.due_date == null ? null : String(r.due_date).slice(0, 10),
      status: r.status == null ? "saved" : String(r.status),
      saved_at: r.created_at == null ? null : String(r.created_at),
      source_url: r.source_url == null ? null : String(r.source_url),
    }));
  },
};

/** The user's pipeline rows, newest save first (order comes from the store). */
export async function loadPipelineRows(
  userId: number,
  store: PipelineExportStore = neonPipelineExportStore,
): Promise<PipelineExportRow[]> {
  return store.listSavedRows(userId);
}
