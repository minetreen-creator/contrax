/**
 * BID TABULATIONS — the ALDOT (Alabama DOT) tabulation reader.
 *
 * SOURCE. ALDOT publishes one "Tabulation of Bids" per letting as a single PDF
 * (`https://alletting.dot.state.al.us/.../BidTabs/bidtab_pdf/ljan3026.pdf`), reached
 * from an annual page (`…/Bid_Tabs/Bidtab_2026.html`), which is reached from the tab
 * index (`…/Bid_Tabs/Bidtabs.html`, one page per year, 1996 → today). The host is
 * ALREADY ingested by Contrax (`src/jobs/sources/al-aldot.ts` reads its letting
 * list for OPEN bids); this reader touches a different surface on the same host and
 * NEVER writes the open-bid tables.
 *
 * ONE PDF = MANY CONTRACTS. A letting PDF carries one block of pages per contract
 * (per "call order"). Every page repeats the contract's header, so the document is
 * segmented by that header — never by page order, which is NOT document order in
 * these files (the tabulation pages arrive highest-numbered first).
 *
 * WHAT WE TAKE, AND FROM WHERE (this is the whole honesty argument):
 *   - Each contract's own "Vendor Ranking" page prints, as the publisher's own
 *     statement: `Rank  <contractor id>  <VENDOR NAME>  $<AMOUNT>`. That table is the
 *     per-bidder Contract Total we store — the publisher's ranking, the publisher's
 *     amount, the publisher's name. Nothing here is aligned, inferred or computed.
 *   - If a contract has no ranking page, we fall back to the contract's own bidder
 *     header row (`Line No / Item ID (1) NAME (2) NAME …`) plus its `Contract Totals`
 *     row, aligned on the publisher's own column x-positions, and ONLY when the count
 *     of cells matches exactly. Otherwise the bidder names are kept and every amount
 *     stays NULL — parse-or-NULL, never a guess.
 *   - Non-clean numbers are stored NULL. Nothing is "cleaned" (no stripping of a
 *     stray character, no re-rounding, no currency conversion). The publisher's own
 *     typos are stored as printed (see the "as published" rule).
 *
 * SCANNED DOCUMENTS (owner rule ③). If the extracted text is below a documented
 * threshold, the document is a scanned image: we emit ONE row for the PDF with
 * `scanned = true`, ZERO bidder rows and an `extraction_note`, and the surface says
 * the prices are not machine-readable. OCR is never applied by default.
 */
import { extractPdfLines, type PdfTextLine } from "./pdf-text";

/** The `bids.source` label this reader writes against (same host, same label). */
export const ALDOT_TABS_SOURCE = "al_aldot";
export const ALDOT_TABS_AGENCY = "Alabama Department of Transportation";
/** The tabulation index: one link per year, 1996 → today. */
export const ALDOT_TABS_INDEX_URL =
  "https://alletting.dot.state.al.us/DW_Pages/Bid_Tabs/Bidtabs.html";
/** What a tabulation of this source is, as published. */
export const ALDOT_TABULATION_TYPE = "Construction letting";

/**
 * SCANNED THRESHOLD (documented, and the only place it lives). A machine-readable
 * ALDOT letting PDF yields thousands of text items (the Jan-2026 fixture: 9,461
 * baselines over 305 pages). A scanned image yields a handful of junk glyphs. The
 * floor is deliberately far below any real document and far above a scanned one.
 */
export const ALDOT_SCANNED_MIN_LINES = 40;
export const ALDOT_SCANNED_MIN_CHARS = 400;

export interface AldotTabBidder {
  /** Verbatim, exactly as the publisher prints it. */
  bidder_name: string;
  /** Canonical decimal string (e.g. "2137726.63"), or null when not cleanly read. */
  bid_amount: string | null;
}

export interface AldotTabRow {
  /** The printed Contract ID, e.g. "20260130067" (letting date + call order). */
  source_project_id: string;
  /** Same value: ALDOT's own contract reference within its numbering space. */
  reference_number: string;
  /** The printed Project(s), verbatim (may be several, comma-separated). */
  project_number: string | null;
  county: string | null;
  /** The contract description as printed (whitespace collapsed). */
  title: string | null;
  /** The letting date printed in the document ("2026-01-30"). */
  bid_opened_on: string | null;
  tabulation_type: string;
  bidders: AldotTabBidder[];
  /** Owner rule ③: the source document could not be machine-read. */
  scanned: boolean;
  /** Why extraction produced this result. */
  extraction_note: string | null;
}

export interface AldotPdfParseResult {
  rows: AldotTabRow[];
  scanned: boolean;
  note: string;
  baselines: number;
  chars: number;
}

export interface AldotPdfContext {
  /** The publisher's URL for THIS PDF — every emitted row cites it. */
  sourceUrl: string;
  /** The letting date as printed on the annual index page ("January 30, 2026"). */
  lettingDate: string | null;
  /** The PDF file stem ("ljan3026") — the publisher's own id for the document. */
  fileStem: string;
}

/** "January 30, 2026" → "2026-01-30"; anything else → null (never guessed). */
export function aldotMonthDateToIso(text: string | null | undefined): string | null {
  if (!text) return null;
  const m = String(text)
    .trim()
    .match(/^([A-Za-z]+)\s+(\d{1,2}),\s*(\d{4})$/);
  if (!m) return null;
  const month = [
    "january", "february", "march", "april", "may", "june",
    "july", "august", "september", "october", "november", "december",
  ].indexOf(m[1]!.toLowerCase());
  if (month < 0) return null;
  const day = Number(m[2]);
  const year = Number(m[3]);
  if (day < 1 || day > 31) return null;
  return `${year}-${String(month + 1).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

/** "1/30/2026" → "2026-01-30"; anything else → null. */
export function aldotSlashDateToIso(text: string | null | undefined): string | null {
  if (!text) return null;
  const m = String(text)
    .trim()
    .match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (!m) return null;
  const [month, day, year] = [Number(m[1]), Number(m[2]), Number(m[3])];
  if (month < 1 || month > 12 || day < 1 || day > 31) return null;
  return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

/** A printed money cell → a canonical decimal string, or null. Never cleaned. */
export function parsePublishedAmount(raw: string | null | undefined): string | null {
  if (raw == null) return null;
  const text = String(raw).trim();
  const m = text.match(/^\$?(\d{1,3}(?:,\d{3})*|\d+)\.(\d{2})$/);
  if (!m) return null;
  const whole = m[1]!.replace(/,/g, "");
  if (!/^\d+$/.test(whole)) return null;
  return `${whole}.${m[2]!}`;
}

/** The year pages linked from the tab index: `Bidtab_YYYY.html`. */
export function parseAldotTabIndex(html: string): { year: number; url: string }[] {
  const out: { year: number; url: string }[] = [];
  const seen = new Set<number>();
  for (const m of html.matchAll(/href="([^"]*Bidtab_(\d{4})\.html)"/gi)) {
    const year = Number(m[2]);
    if (seen.has(year)) continue;
    seen.add(year);
    // The index mixes absolute and relative hrefs, and one year carries a doubled
    // slash ("…/Bid_Tabs//Bidtab_1997.html"); normalise the path only.
    const raw = m[1]!.replace(/([^:])\/{2,}/g, "$1/");
    out.push({ year, url: new URL(raw, ALDOT_TABS_INDEX_URL).toString() });
  }
  return out.sort((a, b) => a.year - b.year);
}

/** One row of a year page: a letting date and the PDF that was released for it. */
export interface AldotLettingPdf {
  /** The letting date as printed ("January 30, 2026"). */
  lettingDate: string;
  /** The letting date as ISO, or null when the printed text is not a date. */
  lettingIso: string | null;
  pdfUrl: string;
  fileStem: string;
}

/**
 * The per-year page. Each released letting is
 *   <tr><td><font>January 30, 2026</font></td><td><a href="…/ljan3026.pdf">PDF</a></td></tr>
 * Letting dates with no PDF (not yet released) carry no link and are SKIPPED — not
 * reported as an error, and never invented.
 */
export function parseAldotTabYearPage(html: string): AldotLettingPdf[] {
  const out: AldotLettingPdf[] = [];
  for (const row of html.matchAll(/<tr\b[^>]*>([\s\S]*?)<\/tr>/gi)) {
    const segment = row[1]!;
    const link = segment.match(/href="([^"]+\.pdf)"/i);
    if (!link) continue;
    const pdfUrl = new URL(link[1]!.replace(/([^:])\/{2,}/g, "$1/"), ALDOT_TABS_INDEX_URL).toString();
    const stem = (pdfUrl.split("/").pop() ?? "").replace(/\.pdf$/i, "");
    if (!stem) continue;
    const label = segment
      .replace(/<[^>]+>/g, " ")
      .replace(/&nbsp;?/gi, " ")
      .replace(/\s+/g, " ")
      .trim();
    const date = label.match(/([A-Za-z]+ \d{1,2}, \d{4})/);
    if (!date) continue;
    out.push({
      lettingDate: date[1]!,
      lettingIso: aldotMonthDateToIso(date[1]!),
      pdfUrl,
      fileStem: stem,
    });
  }
  return out;
}

interface PageBlock {
  contractId: string | null;
  callOrder: string | null;
  county: string | null;
  lettingIso: string | null;
  projects: string | null;
  description: string[];
  inDescription: boolean;
  kind: "tabulation" | "ranking" | "other";
  lines: PdfTextLine[];
}

const HEADER_RE = /^Call Order:\s*(\S+)\s+Contract ID:\s*(\S+)\s+Count(?:y|ies):\s*(.*)$/;
const LETTING_RE = /^Letting Date:\s*([A-Za-z]+ \d{1,2}, \d{4})/;
/** A page-header / table label that ends the printed contract description. */
const DESCRIPTION_STOP_RE =
  /^(Alabama Department of Transportation|Letting Date:|Area\s*\/\s*District:|Area \/ District:|Line No \/ Item ID|Rank Vendor Name Amount|Item Description|Alt Set \/ Alt Member|Page:|Unit Price|Quantity and Units)/;

/** Split the extracted baselines into per-page blocks and read each page header. */
function pageBlocks(lines: PdfTextLine[]): PageBlock[] {
  const blocks: PageBlock[] = [];
  let current: PageBlock | null = null;
  for (const line of lines) {
    const text = line.text;
    if (/^DATE:/.test(text)) {
      current = {
        contractId: null,
        callOrder: null,
        county: null,
        lettingIso: null,
        projects: null,
        description: [],
        inDescription: false,
        kind: "other",
        lines: [],
      };
      blocks.push(current);
      continue;
    }
    if (!current) continue;
    current.lines.push(line);
    if (/^Tabulation of Bids Page:/.test(text)) {
      current.kind = "tabulation";
      current.inDescription = false;
      continue;
    }
    if (/^Vendor Ranking Page:/.test(text)) {
      current.kind = "ranking";
      current.inDescription = false;
      continue;
    }
    const header = text.match(HEADER_RE);
    if (header) {
      current.callOrder = header[1]!;
      current.contractId = header[2]!;
      current.county = header[3]!.trim() || null;
      current.inDescription = false;
      continue;
    }
    const letting = text.match(LETTING_RE);
    if (letting) {
      current.lettingIso = current.lettingIso ?? aldotMonthDateToIso(letting[1]!);
      current.inDescription = false;
      continue;
    }
    const desc = text.match(/^Contract Description:\s*(.*)$/);
    if (desc) {
      const rest = desc[1]!.trim();
      const projects = rest.match(/^Project\(s\):\s*(.*)$/);
      if (projects) {
        current.projects = projects[1]!.trim() || null;
      } else if (rest) {
        current.description.push(rest);
      }
      current.inDescription = true;
      continue;
    }
    // The printed description wraps across several lines; collect it verbatim
    // (whitespace collapsed) until the next label, and never past the cap.
    if (current.inDescription) {
      if (DESCRIPTION_STOP_RE.test(text)) {
        current.inDescription = false;
        continue;
      }
      if (current.description.length < 6) current.description.push(text);
      continue;
    }
  }
  return blocks;
}

const RANK_START_RE = /^(\d{1,3})\s+(\d{3,7})\s+(.*)$/;
const RANK_TAIL_RE = /^(.*?)\s+\$?((?:\d{1,3}(?:,\d{3})*|\d+)\.\d{2})$/;
const BIDDER_CELL_RE = /^\((\d{1,3})\)\s*(.*)$/;

/**
 * The publisher's own ranked bidder list from a contract's ranking page. A vendor
 * name longer than its column WRAPS onto the following line(s), so a row is the rank
 * line plus every continuation up to the next rank line — the stored name is the
 * concatenation of the publisher's own fragments and the amount is the trailing
 * money cell. A row whose trailing cell is not a clean amount keeps its name and
 * stores NULL.
 */
function rankingBidders(block: PageBlock): AldotTabBidder[] {
  const out: AldotTabBidder[] = [];
  const rows: string[] = [];
  let started = false;
  for (const line of block.lines) {
    if (/^Rank Vendor Name Amount\s*$/.test(line.text)) {
      started = true;
      continue;
    }
    if (!started) continue;
    if (RANK_START_RE.test(line.text)) rows.push(line.text);
    else if (rows.length > 0 && !RANK_TAIL_RE.test(rows[rows.length - 1]!)) {
      // A wrapped vendor name; once a row already ends in an amount, anything that
      // follows it is page furniture and must NOT be glued onto the name.
      rows[rows.length - 1] += ` ${line.text}`;
    }
  }
  for (const row of rows) {
    const start = row.match(/^\d{1,3}\s+\d{3,7}\s+([\s\S]*)$/);
    if (!start) continue;
    const cellText = start[1]!.trim();
    const tail = cellText.match(RANK_TAIL_RE);
    if (tail) {
      out.push({ bidder_name: tail[1]!.trim(), bid_amount: parsePublishedAmount(tail[2]!) });
    } else {
      out.push({ bidder_name: cellText, bid_amount: null });
    }
  }
  return out;
}

/**
 * FALLBACK: a contract with no ranking page. The bidder header row names the
 * columns `(1) NAME (2) NAME …`, the names wrap onto following lines, and the
 * `Contract Totals` row prints one amount per column. We keep the publisher's
 * column geometry: each amount is attached to the bidder column whose x is closest.
 * Any structural doubt (cell count mismatch, no columns) leaves amounts NULL.
 */
function columnAlignedBidders(block: PageBlock): AldotTabBidder[] {
  const headerIndex = block.lines.findIndex((l) => /^Line No \/ Item ID/.test(l.text));
  const totalsLine = block.lines.find((l) => /^Contract Totals/.test(l.text));
  if (headerIndex < 0 || !totalsLine) return [];
  const headerLine = block.lines[headerIndex]!;
  // The bidder header may wrap: collect cells from this line and the 1–2 next lines
  // that still sit above the "Item Description" label.
  const wrapLines: PdfTextLine[] = [];
  for (let i = headerIndex + 1; i < block.lines.length; i++) {
    const t = block.lines[i]!.text;
    if (/^(Item Description|Alt Set \/ Alt Member)/.test(t)) break;
    if (t.length < 2) break;
    wrapLines.push(block.lines[i]!);
  }
  const columns: { order: number; x: number; name: string }[] = [];
  for (const line of [headerLine, ...wrapLines]) {
    for (const item of line.items) {
      const m = item.text.match(BIDDER_CELL_RE);
      if (!m) continue;
      columns.push({ order: Number(m[1]), x: item.x, name: m[2]!.trim() });
    }
  }
  if (columns.length === 0) return [];
  // A wrapped continuation contributes its fragment to the column at the same x.
  const byOrder = new Map<number, { parts: { x: number; text: string }[] }>();
  for (const item of [headerLine, ...wrapLines]) {
    for (const cell of item.items) {
      const m = cell.text.match(BIDDER_CELL_RE);
      const order = m ? Number(m[1]) : nearestColumnOrder(cell.x, columns);
      if (order == null) continue;
      const entry = byOrder.get(order) ?? { parts: [] };
      entry.parts.push({ x: cell.x, text: m ? m[2]!.trim() : cell.text.trim() });
      byOrder.set(order, entry);
    }
  }
  const amounts = totalsLine.items
    .map((item) => ({ x: item.x, value: parsePublishedAmount(item.text) }))
    .filter((a) => a.value !== null);
  const ordered = [...byOrder.entries()].sort((a, b) => a[0] - b[0]);
  if (amounts.length !== ordered.length) {
    // Structural doubt: keep the names, refuse to guess the money.
    return ordered.map(([, entry]) => ({
      bidder_name: entry.parts.map((p) => p.text).join(" ").replace(/\s+/g, " ").trim(),
      bid_amount: null,
    }));
  }
  return ordered.map(([, entry], index) => ({
    bidder_name: entry.parts.map((p) => p.text).join(" ").replace(/\s+/g, " ").trim(),
    bid_amount: amounts[index]!.value,
  }));
}

function nearestColumnOrder(x: number, columns: { order: number; x: number }[]): number | null {
  let best: { order: number; distance: number } | null = null;
  for (const column of columns) {
    const distance = Math.abs(column.x - x);
    if (best === null || distance < best.distance) best = { order: column.order, distance };
  }
  // A continuation fragment must sit near its column; beyond a column pitch we
  // refuse rather than attach text to the wrong bidder.
  if (!best || best.distance > 90) return null;
  return best.order;
}

/** Parse one ALDOT letting PDF into per-contract tabulation rows. */
export function parseAldotTabulationPdf(
  bytes: Uint8Array,
  ctx: AldotPdfContext,
): AldotPdfParseResult {
  const lines = extractPdfLines(bytes);
  const chars = lines.reduce((sum, l) => sum + l.text.length, 0);
  if (lines.length < ALDOT_SCANNED_MIN_LINES || chars < ALDOT_SCANNED_MIN_CHARS) {
    const note =
      `scanned document: text extraction returned ${lines.length} baseline(s) / ${chars} character(s), ` +
      `below the ${ALDOT_SCANNED_MIN_LINES}-line / ${ALDOT_SCANNED_MIN_CHARS}-character floor — ` +
      `prices are not machine-readable and were not guessed`;
    return { rows: [scannedRow(ctx, note)], scanned: true, note, baselines: lines.length, chars };
  }
  const blocks = pageBlocks(lines);
  const byContract = new Map<string, PageBlock[]>();
  for (const block of blocks) {
    if (!block.contractId) continue;
    const list = byContract.get(block.contractId) ?? [];
    list.push(block);
    byContract.set(block.contractId, list);
  }
  const rows: AldotTabRow[] = [];
  for (const [contractId, contractBlocks] of byContract) {
    const head = contractBlocks.find((b) => b.projects || b.county) ?? contractBlocks[0]!;
    const ranking = contractBlocks.find((b) => b.kind === "ranking");
    let bidders: AldotTabBidder[] = ranking ? rankingBidders(ranking) : [];
    let note: string | null = ranking
      ? "per-bidder amounts taken from ALDOT's own Vendor Ranking table for this contract"
      : null;
    if (bidders.length === 0) {
      const tabulation = contractBlocks.find((b) => b.kind === "tabulation");
      bidders = tabulation ? columnAlignedBidders(tabulation) : [];
      if (bidders.length > 0) {
        note =
          "no Vendor Ranking table in this document: per-bidder amounts column-aligned to the publisher's own " +
          "Contract Totals row from the publisher's own column positions";
        if (bidders.every((b) => b.bid_amount === null)) {
          note += "; the cell count did not match the bidder count, so every amount was left NULL";
        }
      } else {
        note = "no bidder table could be read from this contract's pages";
      }
    }
    rows.push({
      source_project_id: contractId,
      reference_number: contractId,
      project_number: head.projects,
      county: head.county,
      title: head.description.length
        ? head.description.join(" ").replace(/\s+/g, " ").trim().slice(0, 400)
        : null,
      bid_opened_on: head.lettingIso ?? aldotMonthDateToIso(ctx.lettingDate),
      tabulation_type: ALDOT_TABULATION_TYPE,
      bidders,
      scanned: false,
      extraction_note: note,
    });
  }
  rows.sort((a, b) => a.source_project_id.localeCompare(b.source_project_id));
  const note =
    rows.length === 0
      ? `no contract header (Call Order / Contract ID) found in ${lines.length} extracted baseline(s)`
      : `read ${rows.length} contract(s) from ${lines.length} baseline(s) / ${chars} character(s)`;
  return { rows, scanned: false, note, baselines: lines.length, chars };
}

/** The single row emitted when a letting's document is a scanned image. */
export function scannedRow(ctx: AldotPdfContext, note: string): AldotTabRow {
  return {
    source_project_id: ctx.fileStem,
    reference_number: ctx.fileStem,
    project_number: null,
    county: null,
    title: null,
    bid_opened_on: aldotMonthDateToIso(ctx.lettingDate),
    tabulation_type: ALDOT_TABULATION_TYPE,
    bidders: [],
    scanned: true,
    extraction_note: note,
  };
}
