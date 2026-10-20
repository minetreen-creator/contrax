/**
 * CSV WRITER — the ONE RFC-4180 writer both exports use (Agency tier phase 3,
 * owner decision 2026-10-20: "client-ready per-client exports (CSV, reusing the
 * existing RFC-4180 export)").
 *
 * WHY THIS FILE EXISTS. The escaping and line-ending rules shipped with the
 * pipeline export (src/lib/pipeline-export.ts, PR #455 part B). The per-client
 * export needed the exact same rules for DIFFERENT columns, and the honest way to
 * get them is to lift the writer out rather than paste a second copy that can
 * drift: a spreadsheet bug in one exporter would otherwise stay fixed in the
 * other. `pipeline-export.ts` now imports from here and keeps its public API
 * (`csvCell`, `toPipelineCsv`, `pipelineCsvFilename`) unchanged, so this is a
 * refactor of shipped behaviour, not a behaviour change.
 *
 * NO IMPORTS ON PURPOSE — this module is imported by a pure exporter that the
 * /workspace UI's link is built from, so it must never pull in `~/db`.
 *
 * THE RULES (unchanged from the shipped exporter):
 *   * a cell containing a quote, comma, CR or LF is wrapped in double quotes with
 *     inner quotes doubled;
 *   * every line ends CRLF, including the last one, so Excel/Sheets open the file
 *     without prompting;
 *   * NO byte-order mark — the pipeline export never emitted one, and adding one
 *     would change the first column's header text for every existing consumer;
 *   * values are exported VERBATIM: a missing value is the empty cell, never an
 *     invented "unknown"/"n/a" in a cell a spreadsheet would treat as data.
 */

/**
 * One CSV cell. RFC-4180: a value containing a quote, comma, CR or LF is wrapped
 * in double quotes with inner quotes doubled. Values are exported verbatim (no
 * trimming/invention) so the file always matches what the app shows.
 */
export function csvCell(value: unknown): string {
  if (value == null) return "";
  const s = String(value);
  if (s === "") return "";
  if (/[",\r\n]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

/**
 * The complete CSV document: the header row then one line per row, CRLF
 * terminated (RFC 4180). With no rows this is a header-only file — never a
 * fabricated row, and never an empty (headerless) file.
 */
export function csvDocument(
  columns: readonly string[],
  rows: readonly (readonly unknown[])[],
): string {
  const lines = [columns.map(csvCell).join(",")];
  for (const row of rows) lines.push(row.map(csvCell).join(","));
  return lines.join("\r\n") + "\r\n";
}

/**
 * The `YYYY-MM-DD` stamp in a download filename, taken in UTC so the same moment
 * always produces the same name. An unparseable clock gets the literal
 * "undated" rather than "NaN-NaN-NaN" or a silently empty segment.
 */
export function csvDateStamp(now: Date): string {
  return Number.isNaN(now.getTime()) ? "undated" : now.toISOString().slice(0, 10);
}

/**
 * A filename-safe slug for user-authored text (a client's workspace name).
 *
 * Filenames are attacker-adjacent input: a workspace name is user-typed, ends up
 * inside a `Content-Disposition` header, and may hold quotes, CR/LF (header
 * injection), path separators or non-ASCII. Everything outside `[a-z0-9]` becomes
 * a single `-`, accents are folded rather than dropped ("Café LLC" → "cafe-llc"),
 * leading/trailing dashes are trimmed, the result is capped so the whole filename
 * stays comfortably inside filesystem limits, and an empty result falls back to a
 * fixed placeholder — never an empty filename segment.
 */
export function csvFilenameSlug(value: unknown, fallback: string, maxLength = 60): string {
  const raw = typeof value === "string" ? value : "";
  const ascii = raw.normalize("NFKD").replace(/[\u0300-\u036f]/g, "");
  let slug = ascii
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  if (slug.length > maxLength) slug = slug.slice(0, maxLength).replace(/-+$/g, "");
  return slug.length > 0 ? slug : fallback;
}
