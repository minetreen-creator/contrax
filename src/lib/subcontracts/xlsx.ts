/**
 * Contrax — SUBCONTRACTING preview: a MINIMAL XLSX reader (no dependency).
 *
 * WHY HAND-ROLLED. The one file this reads is an official SBA annual report — the SBA
 * Directory of Federal Government Prime Contractors with Subcontracting Plans, FY24
 * (18,940 rows × 18 columns, 2,163,470 B), which the operator loads BY HAND from the
 * saved evidence file (its `/sites/default/files/*` path is robots-disallowed, so it is
 * never crawled — BUILD-PLAN §6.1 S2). An XLSX is a ZIP of XML parts; the cells this
 * report uses are plain (`t="s"` shared-string indices and numeric literals in `<v>`)
 * with no formulas, no styling semantics and no inline strings. Adding a spreadsheet
 * library to the production dependency tree for one hand-run annual import is the wrong
 * trade: it is a large surface to keep patched for a job that runs once a year, while
 * this reader is ~120 lines of `node:zlib` + regex over a file we already have on disk
 * and whose shape is pinned by a committed slice fixture
 * (`fixtures/fy24-directory-slice.xlsx`, 33 real rows) plus tests.
 *
 * WHAT IT DOES NOT DO (deliberately): no formula evaluation (a `<f>` is ignored; the
 * cached `<v>` is what Excel/SBA last wrote), no styles, no date detection (a date is a
 * serial NUMBER here — `excelSerialToIsoDate` converts it where the caller knows the
 * column is a date), no `.xls`, no encryption, no zip64. Each of those would be a silent
 * misinterpretation risk; a part it cannot read throws.
 *
 * FAIL-CLOSED. A missing entry, an unsupported compression method, a sheet with no
 * `<row>`, or a cell whose reference cannot be parsed all THROW. A loader that quietly
 * imported 0 companies because the zip changed shape is exactly the fabrication this
 * feature must never make.
 */
import { inflateRawSync } from "node:zlib";

export class XlsxReadError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "XlsxReadError";
  }
}

// ── ZIP (read-only, stored + deflate) ────────────────────────────────────────

interface ZipEntry {
  name: string;
  compression: number;
  compressedSize: number;
  localHeaderOffset: number;
}

const EOCD_SIGNATURE = 0x06054b50;
const CENTRAL_SIGNATURE = 0x02014b50;
const LOCAL_SIGNATURE = 0x04034b50;
/** The EOCD is the last 22 bytes plus a comment of up to 65,535 bytes. */
const MAX_COMMENT = 0xffff;

function readZipEntries(buffer: Buffer): Map<string, ZipEntry> {
  let eocd = -1;
  const searchFrom = Math.max(0, buffer.length - MAX_COMMENT - 22);
  for (let i = buffer.length - 22; i >= searchFrom; i -= 1) {
    if (buffer.readUInt32LE(i) === EOCD_SIGNATURE) {
      eocd = i;
      break;
    }
  }
  if (eocd < 0) throw new XlsxReadError("not a ZIP archive (no end-of-central-directory record)");
  const entryCount = buffer.readUInt16LE(eocd + 10);
  let offset = buffer.readUInt32LE(eocd + 16);
  const entries = new Map<string, ZipEntry>();
  for (let i = 0; i < entryCount; i += 1) {
    if (offset + 46 > buffer.length || buffer.readUInt32LE(offset) !== CENTRAL_SIGNATURE) {
      throw new XlsxReadError(`corrupt central directory at entry ${i}`);
    }
    const compression = buffer.readUInt16LE(offset + 10);
    const compressedSize = buffer.readUInt32LE(offset + 20);
    const nameLength = buffer.readUInt16LE(offset + 28);
    const extraLength = buffer.readUInt16LE(offset + 30);
    const commentLength = buffer.readUInt16LE(offset + 32);
    const localHeaderOffset = buffer.readUInt32LE(offset + 42);
    const name = buffer.subarray(offset + 46, offset + 46 + nameLength).toString("utf8");
    entries.set(name, { name, compression, compressedSize, localHeaderOffset });
    offset += 46 + nameLength + extraLength + commentLength;
  }
  return entries;
}

function readZipEntry(buffer: Buffer, entry: ZipEntry): Buffer {
  const local = entry.localHeaderOffset;
  if (buffer.readUInt32LE(local) !== LOCAL_SIGNATURE) {
    throw new XlsxReadError(`corrupt local header for ${entry.name}`);
  }
  const nameLength = buffer.readUInt16LE(local + 26);
  const extraLength = buffer.readUInt16LE(local + 28);
  const start = local + 30 + nameLength + extraLength;
  const raw = buffer.subarray(start, start + entry.compressedSize);
  if (entry.compression === 0) return Buffer.from(raw);
  if (entry.compression === 8) return inflateRawSync(raw);
  throw new XlsxReadError(
    `${entry.name} uses zip compression method ${entry.compression} (only 0 = stored and 8 = deflate are supported)`,
  );
}

// ── XML (the two parts this reader needs) ────────────────────────────────────

const ENTITIES: Record<string, string> = {
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  apos: "'",
};

/** Decodes the XML entities Excel actually emits (incl. numeric character refs). */
export function decodeXmlText(text: string): string {
  return text.replace(/&(#x?[0-9a-fA-F]+|[a-zA-Z]+);/g, (match, body: string) => {
    if (body.startsWith("#x") || body.startsWith("#X")) {
      const code = Number.parseInt(body.slice(2), 16);
      return Number.isFinite(code) ? String.fromCodePoint(code) : match;
    }
    if (body.startsWith("#")) {
      const code = Number.parseInt(body.slice(1), 10);
      return Number.isFinite(code) ? String.fromCodePoint(code) : match;
    }
    return ENTITIES[body] ?? match;
  });
}

/**
 * `xl/sharedStrings.xml` → the string table, in index order. A shared string is either a
 * plain `<t>` or a run-split `<r><t>…</t></r>` sequence; both are joined, which is what
 * Excel's own readers do.
 */
export function parseSharedStrings(xml: string): string[] {
  const strings: string[] = [];
  for (const si of xml.matchAll(/<si\b[^>]*>([\s\S]*?)<\/si>/g)) {
    const body = si[1]!;
    let text = "";
    for (const t of body.matchAll(/<t\b[^>]*>([\s\S]*?)<\/t>/g)) text += t[1]!;
    strings.push(decodeXmlText(text));
  }
  return strings;
}

export interface XlsxCellValue {
  /** The column letter, e.g. `K`. */
  column: string;
  /** The raw value: shared string text, numeric literal, boolean (`0`/`1`) or error text. */
  value: string;
  /** The cell's `t` attribute, verbatim (`s`, `str`, `inlineStr`, `b`, `e`, or "" = number). */
  type: string;
}

export interface XlsxRow {
  /** 1-based row number as published in the sheet (`<row r="N">`). */
  rowNumber: number;
  /** Every cell in the row, in sheet order. */
  cells: XlsxCellValue[];
  /** Column letter → value. */
  byColumn: Record<string, string>;
}

export interface XlsxSheet {
  sheetPath: string;
  /** Row 1, column letter → header text. */
  header: Record<string, string>;
  /** The data rows, in sheet order (row 1 excluded, fully blank rows dropped). */
  rows: XlsxRow[];
}

const COLUMN_REF = /^([A-Z]+)(\d+)$/;

function parseSheetXml(xml: string, shared: readonly string[], sheetPath: string): XlsxSheet {
  const rows: XlsxRow[] = [];
  for (const rowMatch of xml.matchAll(/<row\b([^>]*)>([\s\S]*?)<\/row>/g)) {
    const attrs = rowMatch[1]!;
    const body = rowMatch[2]!;
    const rowNumber = Number.parseInt(/\br="(\d+)"/.exec(attrs)?.[1] ?? "", 10);
    if (!Number.isFinite(rowNumber)) {
      throw new XlsxReadError(`${sheetPath}: a <row> has no row number (r="…")`);
    }
    const cells: XlsxCellValue[] = [];
    const byColumn: Record<string, string> = {};
    for (const cellMatch of body.matchAll(/<c\b([^>]*?)(\/>|>([\s\S]*?)<\/c>)/g)) {
      const cellAttrs = cellMatch[1]!;
      const cellBody = cellMatch[3] ?? "";
      const reference = /\br="([A-Z]+\d+)"/.exec(cellAttrs)?.[1];
      if (reference === undefined) {
        throw new XlsxReadError(`${sheetPath}: row ${rowNumber} has a cell without a reference`);
      }
      const parsed = COLUMN_REF.exec(reference);
      if (!parsed) throw new XlsxReadError(`${sheetPath}: unreadable cell reference ${reference}`);
      const column = parsed[1]!;
      const type = /\bt="([^"]*)"/.exec(cellAttrs)?.[1] ?? "";
      let value = "";
      if (type === "inlineStr") {
        let text = "";
        for (const t of cellBody.matchAll(/<t\b[^>]*>([\s\S]*?)<\/t>/g)) text += t[1]!;
        value = decodeXmlText(text);
      } else {
        const v = /<v>([\s\S]*?)<\/v>/.exec(cellBody)?.[1] ?? "";
        if (type === "s") {
          const index = Number.parseInt(v, 10);
          if (!Number.isFinite(index) || shared[index] === undefined) {
            throw new XlsxReadError(
              `${sheetPath}: ${reference} points at shared string ${JSON.stringify(v)} which the workbook does not contain`,
            );
          }
          value = shared[index]!;
        } else {
          value = decodeXmlText(v);
        }
      }
      cells.push({ column, value, type });
      byColumn[column] = value;
    }
    rows.push({ rowNumber, cells, byColumn });
  }
  if (rows.length === 0) {
    throw new XlsxReadError(`${sheetPath}: no <row> found — the sheet is empty or the shape changed`);
  }
  return { sheetPath, header: rows[0]!.byColumn, rows: rows.slice(1) };
}

// ── Public surface ───────────────────────────────────────────────────────────

/**
 * Reads the first worksheet of an XLSX buffer. `sheetPath` defaults to `xl/worksheets/sheet1.xml`,
 * which is where a single-sheet workbook written by any of the usual tools puts its data.
 */
export function readXlsxSheet(bytes: Uint8Array, sheetPath = "xl/worksheets/sheet1.xml"): XlsxSheet {
  const buffer = Buffer.isBuffer(bytes) ? bytes : Buffer.from(bytes);
  const entries = readZipEntries(buffer);
  const sheetEntry = entries.get(sheetPath);
  if (!sheetEntry) {
    throw new XlsxReadError(
      `the workbook has no ${sheetPath} (parts: ${[...entries.keys()].join(", ")})`,
    );
  }
  const stringsEntry = entries.get("xl/sharedStrings.xml");
  const shared = stringsEntry ? parseSharedStrings(readZipEntry(buffer, stringsEntry).toString("utf8")) : [];
  const sheetXml = readZipEntry(buffer, sheetEntry).toString("utf8");
  return parseSheetXml(sheetXml, shared, sheetPath);
}

/**
 * Excel serial day number → ISO date. The 1900 date system's epoch is 1899-12-30 (Excel's
 * own off-by-one leap-year bug is baked into that constant), and the serial is a whole
 * number of days for every date this report publishes.
 */
export function excelSerialToIsoDate(serial: string | number): string | null {
  const value = typeof serial === "number" ? serial : Number.parseFloat(serial);
  if (!Number.isFinite(value)) return null;
  const days = Math.floor(value);
  const ms = Date.UTC(1899, 11, 30) + days * 86_400_000;
  const date = new Date(ms);
  if (Number.isNaN(date.getTime())) return null;
  return date.toISOString().slice(0, 10);
}
