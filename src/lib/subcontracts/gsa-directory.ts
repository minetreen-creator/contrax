/**
 * Contrax — SUBCONTRACTING preview: the GSA PRIME CONTRACTOR DIRECTORY, pure mapping
 * (owner-approved expansion 2026-09-26; mechanism proven by
 * shared/subcontracting-expansion-research-2026-09-25/spike/README.md).
 *
 * WHAT THE FILE IS. One CSV per year on the page
 * https://www.gsa.gov/small-business/find-opportunities — companies that have been
 * awarded GSA contracts carrying a subcontracting plan. ONE ROW PER COMPANY, keyed by
 * UEI, with the full physical address and the source's own "Major products or service
 * lines" description. It is a DIRECTORY OF COMPANIES TO APPROACH — not open
 * opportunities, and the source publishes no posted/closing/deadline field at all.
 *
 * PURE MODULE: no network, no DB, no node builtins, no env reads. The HTTP half lives
 * in `gsa-directory.server.ts`, the run orchestration in `gsa-sync.server.ts`.
 *
 * THE QUIRKS THIS PARSER IS WRITTEN AGAINST (all measured on the live 294,471-byte
 * file, 2026-09-26 — see the spike's §3.1):
 *   a. CRLF line endings, NO trailing newline, and NOT pure ASCII (one row carries a
 *      double-encoded mojibake sequence). Text is decoded as UTF-8 and kept VERBATIM —
 *      never re-encoded, never "cleaned" into a different character.
 *   b. `<br>` inside the address field (2,055 / 2,072 rows) is an HTML line break in a
 *      CSV that has no embedded newlines: it becomes "\n" here, and the read surface
 *      renders that as ", ". It is never injected as HTML.
 *   c. The `NAICS code` column is DIRTY: only /^\d{6}$/ is a NAICS code. 105 of 2,072
 *      rows publish something else (`0000`, `006`, `1`, `132`, `2211`, 7- and 10-digit
 *      concatenations, PSC-looking values). The invalid CODE is dropped — the ROW is
 *      kept, is counted, and shows an explicit "NAICS not stated" fallback — and the RAW
 *      CELL is stored verbatim in `naics_raw` so those 105 values stay identifiable in the
 *      data (owner refinement 2026-09-26; NULL for every valid code). A bare non-NAICS
 *      code is never rendered as a trade label (the #449 rule).
 *   d. The source publishes NO NAICS title. Titles are resolved at READ time through
 *      the repo's single NAICS name table (`unmappedScopeLabel`) — never invented here.
 *   e. `State` is a full name (53 distinct values) including `Non-US` (17 rows),
 *      `Puerto Rico` and `District of Columbia`. It is stored VERBATIM: "Non-US" is not
 *      a state and is never normalised into one.
 *   f. `Major products or service lines` is mixed free text and short codes (121 rows
 *      are digits-only). It is a DESCRIPTION, stored verbatim; nothing is classified
 *      from it.
 *   g. Vendor NAMES are not unique (21 names appear twice). Identity is the UEI, which
 *      is unique across the file (0 duplicates, 0 blanks). Duplicate names are counted
 *      and reported, never "deduped" away.
 *   h. `fy` is NOT NULL on the table and this source publishes no fiscal year: every
 *      GSA row stores the LITERAL `'past fiscal year'` (see GSA_FY_LABEL). The real
 *      file date goes in `source_file_date`, taken from the source's own dated file
 *      URL — never inferred from a Last-Modified header (the two disagree: the file
 *      name says Jul-9-2025 while the CDN restamps Last-Modified).
 */
/**
 * The canonical page a reader can cite (never the raw CSV, never the /media handle).
 * The SBA directory's citable page lives on the connector (`PRIME_DIRECTORY_SOURCE`).
 */
export const GSA_DIRECTORY_PAGE_URL = "https://www.gsa.gov/small-business/find-opportunities";

/**
 * The literal stored in `subcontract_primes.fy` for every GSA row.
 *
 * `fy` is NOT NULL and the owner-locked heading deliberately carries no year ("past
 * fiscal year"), so this exact string is stored — never `FY25`, never a year inferred
 * from the file name or from Last-Modified. The real file date is evidence and lives in
 * `source_file_date`.
 */
export const GSA_FY_LABEL = "past fiscal year";

/** The six columns the source publishes, by EXACT header text (order preserved). */
export const GSA_COLUMNS = {
  "Unique Entity ID (UEI)": "uei",
  "Vendor name": "legalName",
  "Vendor physical address": "address",
  State: "state",
  "NAICS code": "naicsCode",
  "Major products or service lines": "productsServices",
} as const;

export type GsaColumnHeader = keyof typeof GSA_COLUMNS;

/** The date every GSA row's `fy` holds. Named so it cannot be confused with SBA's FY24. */
export const GSA_STORED_FY = GSA_FY_LABEL;

export class GsaDirectoryError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "GsaDirectoryError";
  }
}

// ── CSV reading (dependency-free, RFC 4180 subset) ───────────────────────────

/**
 * Splits CSV text into rows of fields. Handles quoted fields, `""` escapes, quoted
 * commas (`"11400, INC."`) and quoted values containing `<br>`; accepts `\r\n` and `\n`
 * and does not require a final newline. It is deliberately small: the source file is
 * single-line-per-row and this is the whole surface it needs.
 */
export function splitCsvRows(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let inQuotes = false;
  let sawAnything = false;
  for (let i = 0; i < text.length; i += 1) {
    const char = text[i]!;
    if (inQuotes) {
      if (char === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i += 1;
        } else {
          inQuotes = false;
        }
      } else {
        field += char;
      }
      continue;
    }
    if (char === '"') {
      inQuotes = true;
      sawAnything = true;
      continue;
    }
    if (char === ",") {
      row.push(field);
      field = "";
      sawAnything = true;
      continue;
    }
    if (char === "\n") {
      row.push(field);
      rows.push(row);
      row = [];
      field = "";
      sawAnything = false;
      continue;
    }
    if (char === "\r") continue;
    field += char;
    sawAnything = true;
  }
  if (sawAnything || field !== "" || row.length > 0) {
    row.push(field);
    rows.push(row);
  }
  return rows;
}

// ── Normalisation (source words → a storable value) ──────────────────────────

/** Only six digits are a NAICS code in this file (quirk c). */
export const GSA_NAICS_RE = /^\d{6}$/;
/** The UEI shape the source publishes (identity is the UEI, quirk g). */
export const GSA_UEI_RE = /^[A-Z0-9]{12}$/;
/** Any residual HTML markup in the address field (global, for `replace`). */
const HTML_TAG_RE = /<\/?[a-z][^<>]*>/gi;
/** The same pattern NON-global, so `RegExp.lastIndex` can never leak between calls. */
const HTML_TAG_TEST = /<\/?[a-z][^<>]*>/i;
/** `<br>`, `<br/>`, `<BR />` — the source's own line break inside a CSV field. */
const BR_RE = /\s*<br\s*\/?>\s*/gi;

export interface GsaAddressParts {
  /** The address with each source `<br>` as a line break, ready to render as text. */
  text: string;
  /** True when the raw cell carried a `<br>` (2,055 of 2,072 live rows). */
  hadBreak: boolean;
  /** True when residual markup (anything other than `<br>`) had to be removed. */
  hadOtherMarkup: boolean;
}

/**
 * The source's address cell → plain text lines. `<br>` becomes a newline, any other tag
 * is removed (markup is not address content), each line is trimmed and inner whitespace
 * collapsed, and blank lines are dropped. Nothing is re-ordered or invented: the
 * address is the source's own words, with its own line breaks.
 */
export function normalizeGsaAddress(raw: string | null | undefined): GsaAddressParts {
  const value = typeof raw === "string" ? raw : "";
  const hadBreak = /<br\s*\/?>/i.test(value);
  const withoutBreaks = value.replace(BR_RE, "\n");
  const hadOtherMarkup = HTML_TAG_TEST.test(withoutBreaks);
  const text = withoutBreaks
    .replace(HTML_TAG_RE, " ")
    .split("\n")
    .map((line) => line.replace(/\s+/g, " ").trim())
    .filter((line) => line !== "")
    .join("\n");
  return { text, hadBreak, hadOtherMarkup };
}

/**
 * The address as ONE line for a card: the stored line breaks become ", ". Already
 * normalised text is passed in (idempotent), so a re-render cannot double the commas.
 */
export function gsaAddressLine(stored: string | null | undefined): string | null {
  if (typeof stored !== "string") return null;
  const text = stored
    .split("\n")
    .map((line) => line.replace(/\s+/g, " ").trim())
    .filter((line) => line !== "")
    .join(", ")
    .trim();
  if (text === "") return null;
  return text.replace(/^,\s*/, "").replace(/,\s*$/, "");
}

/**
 * The dated file URL's own date (`…/subcontractor_directory_Jul-9-2025.csv` → `2025-07-09`).
 *
 * The ONLY date source this connector trusts for `source_file_date`, because it is the
 * source's own file name. A URL the pattern does not match yields NULL — the connector
 * never falls back to Last-Modified, which the CDN restamps (the live file name says
 * Jul-9-2025 while the header said 2026-05-11).
 */
export function gsaFileDateFromUrl(url: string | null | undefined): string | null {
  if (typeof url !== "string") return null;
  const match = /([A-Za-z]{3})-(\d{1,2})-(\d{4})\.csv(?:$|[?#])/.exec(url);
  if (!match) return null;
  const months: Record<string, string> = {
    jan: "01",
    feb: "02",
    mar: "03",
    apr: "04",
    may: "05",
    jun: "06",
    jul: "07",
    aug: "08",
    sep: "09",
    oct: "10",
    nov: "11",
    dec: "12",
  };
  const month = months[match[1]!.toLowerCase()];
  if (!month) return null;
  const day = Number(match[2]);
  if (!Number.isInteger(day) || day < 1 || day > 31) return null;
  return `${match[3]}-${month}-${String(day).padStart(2, "0")}`;
}

/** The source's own file name from a URL, for the run log (evidence, not a claim). */
export function gsaFileNameFromUrl(url: string | null | undefined): string | null {
  if (typeof url !== "string") return null;
  const name = url.split("?")[0]!.split("/").pop();
  return name && name.toLowerCase().endsWith(".csv") ? name : null;
}

// ── Rows ─────────────────────────────────────────────────────────────────────

/** One company, exactly the fields this source publishes (plus the file date). */
export interface GsaDirectoryRow {
  /** Trimmed + upper-cased UEI — the identity (`UNIQUE (source_id, uei)`). */
  uei: string;
  legalName: string;
  /** Address text with the source's `<br>` as line breaks; null when the cell was blank. */
  vendorAddress: string | null;
  /** Verbatim source wording — `Non-US`, `Puerto Rico`, `District of Columbia` included. */
  vendorState: string | null;
  /** The 6-digit code only, as a one-element array; `[]` when the source published none. */
  naics: string[];
  /**
   * The NAICS cell VERBATIM — but ONLY for a row whose cell is present and is NOT a valid
   * six-digit code (`0000`, `006`, `1`, `132`, `2211`, a 7- or 10-digit concatenation, a
   * PSC-looking value). NULL for a valid code (the validated code is in `naics`) and NULL
   * for a blank cell. This is the stored audit trail that keeps the invalid values
   * IDENTIFIABLE IN THE DATA (owner refinement 2026-09-26) while only validated six-digit
   * codes are ever DISPLAYED — the raw value is never rendered as a trade label.
   */
  naicsRaw: string | null;
  productsServices: string | null;
  /** The source's own file date (from the dated URL), or null. Never inferred. */
  sourceFileDate: string | null;
  fy: string;
  sourceUrl: string;
}

export interface GsaParseAccounting {
  /** Physical CSV rows after the header. */
  rowsRead: number;
  /** Rows dropped because every mapped cell was blank (not a record). */
  blankRows: number;
  /** Rows dropped because they publish no UEI — they cannot be identified. */
  rowsWithoutUei: number;
  /** Rows dropped because they publish no vendor name. */
  rowsWithoutName: number;
  /** UEIs whose shape is not the 12-character UEI the source publishes. */
  rowsWithOddUeiShape: number;
  /** Rows that repeat a UEI already seen in this file (first occurrence wins). */
  duplicateUeis: number;
  /** Distinct vendor NAMES repeated by more than one row (identity is the UEI, quirk g). */
  repeatedVendorNames: number;
  /** Rows whose NAICS cell is present but NOT a 6-digit code — the code is dropped. */
  nonNaicsCodesDropped: number;
  /** Rows that publish no NAICS cell at all. */
  rowsWithoutNaicsCell: number;
  /** Rows whose address carried a `<br>`. */
  addressWithBreak: number;
  /** Rows whose address carried markup other than `<br>` (removed). */
  addressWithOtherMarkup: number;
  /** Rows whose state reads `Non-US`. */
  nonUsRows: number;
  /** Rows with no parsed address. */
  rowsWithoutAddress: number;
  /** Distinct states as the source writes them. */
  distinctStates: number;
}

export interface GsaParseResult {
  rows: GsaDirectoryRow[];
  accounting: GsaParseAccounting;
}

const clean = (value: string | undefined): string | null => {
  const text = (value ?? "").trim();
  return text === "" ? null : text;
};

/**
 * Maps the CSV to rows. Throws when a required column is missing (a reshaped file must
 * never import as if it had the columns), and never invents a value.
 */
export function parseGsaDirectory(text: string, fileUrl: string | null = null): GsaParseResult {
  const grid = splitCsvRows(text);
  const headerRow = grid[0];
  if (!headerRow) {
    throw new GsaDirectoryError("the GSA directory file is empty — there is no header row to read");
  }
  const columnOf = new Map<string, number>();
  headerRow.forEach((header, index) => {
    const name = header.trim();
    if (name !== "") columnOf.set(name, index);
  });
  const missing = (Object.keys(GSA_COLUMNS) as GsaColumnHeader[]).filter(
    (header) => !columnOf.has(header),
  );
  if (missing.length > 0) {
    throw new GsaDirectoryError(
      `the file is not the GSA contractor directory: missing column(s) ${missing
        .map((m) => JSON.stringify(m))
        .join(", ")} (found: ${headerRow.map((h) => JSON.stringify(h.trim())).join(", ")})`,
    );
  }

  const sourceFileDate = gsaFileDateFromUrl(fileUrl);
  const accounting: GsaParseAccounting = {
    rowsRead: Math.max(0, grid.length - 1),
    blankRows: 0,
    rowsWithoutUei: 0,
    rowsWithoutName: 0,
    rowsWithOddUeiShape: 0,
    duplicateUeis: 0,
    repeatedVendorNames: 0,
    nonNaicsCodesDropped: 0,
    rowsWithoutNaicsCell: 0,
    addressWithBreak: 0,
    addressWithOtherMarkup: 0,
    nonUsRows: 0,
    rowsWithoutAddress: 0,
    distinctStates: 0,
  };

  const rows: GsaDirectoryRow[] = [];
  const seenUeis = new Set<string>();
  const nameCounts = new Map<string, number>();
  const states = new Set<string>();

  for (let i = 1; i < grid.length; i += 1) {
    const raw = grid[i]!;
    const cell = (header: GsaColumnHeader): string => raw[columnOf.get(header)!] ?? "";
    const mapped = (Object.keys(GSA_COLUMNS) as GsaColumnHeader[]).map((h) => cell(h).trim());
    if (mapped.every((value) => value === "")) {
      accounting.blankRows += 1;
      continue;
    }
    const uei = cell("Unique Entity ID (UEI)").trim().toUpperCase();
    const legalName = cell("Vendor name").trim();
    if (uei === "") {
      accounting.rowsWithoutUei += 1;
      continue;
    }
    if (legalName === "") {
      accounting.rowsWithoutName += 1;
      continue;
    }
    if (!GSA_UEI_RE.test(uei)) accounting.rowsWithOddUeiShape += 1;
    if (seenUeis.has(uei)) {
      // Identity is the UEI; a repeated UEI is reported and the FIRST row is the record.
      accounting.duplicateUeis += 1;
      continue;
    }
    seenUeis.add(uei);
    nameCounts.set(legalName, (nameCounts.get(legalName) ?? 0) + 1);

    const naicsRaw = cell("NAICS code").trim();
    const naicsCode = GSA_NAICS_RE.test(naicsRaw) ? naicsRaw : null;
    if (naicsRaw === "") accounting.rowsWithoutNaicsCell += 1;
    else if (naicsCode === null) accounting.nonNaicsCodesDropped += 1;

    const address = normalizeGsaAddress(cell("Vendor physical address"));
    if (address.hadBreak) accounting.addressWithBreak += 1;
    if (address.hadOtherMarkup) accounting.addressWithOtherMarkup += 1;
    if (address.text === "") accounting.rowsWithoutAddress += 1;

    const state = clean(cell("State"));
    if (state !== null) states.add(state);
    if (state?.toUpperCase() === "NON-US") accounting.nonUsRows += 1;

    rows.push({
      uei,
      legalName,
      vendorAddress: address.text === "" ? null : address.text,
      vendorState: state,
      naics: naicsCode === null ? [] : [naicsCode],
      // The raw cell is stored ONLY when it failed validation (owner refinement): a valid
      // code already lives in `naics`, and a blank cell has nothing to audit.
      naicsRaw: naicsCode === null && naicsRaw !== "" ? naicsRaw : null,
      productsServices: clean(cell("Major products or service lines")),
      sourceFileDate,
      fy: GSA_FY_LABEL,
      sourceUrl: GSA_DIRECTORY_PAGE_URL,
    });
  }

  for (const count of nameCounts.values()) if (count > 1) accounting.repeatedVendorNames += 1;
  accounting.distinctStates = states.size;
  return { rows, accounting };
}

/**
 * A row-order-insensitive fingerprint of the normalised rows — the run's own evidence
 * that the CONTENT changed, independent of the CDN's restamped Last-Modified.
 */
export function gsaContentFingerprint(rows: readonly GsaDirectoryRow[]): string {
  const lines = rows
    .map((row) =>
      [
        row.uei,
        row.legalName,
        row.vendorAddress ?? "",
        row.vendorState ?? "",
        row.naics[0] ?? row.naicsRaw ?? "",
        row.productsServices ?? "",
      ].join("\u0001"),
    )
    .sort()
    .join("\n");
  // One lane of the repo's dependency-free FNV-1a hash would be too narrow for a change
  // gate, so this uses the same 4-lane shape the state-grants connector uses via
  // contentFingerprint — kept local so the pure module has no import cycles.
  return fnvLanes(lines);
}

/** Four independent FNV-1a lanes over the text, hex-joined (dependency-free). */
function fnvLanes(text: string): string {
  const seeds = [0x811c9dc5, 0x01000193, 0x9e3779b9, 0x85ebca6b];
  const values = seeds.map((seed) => {
    let hash = seed >>> 0;
    for (let i = 0; i < text.length; i += 1) {
      hash ^= text.charCodeAt(i);
      hash = Math.imul(hash, 0x01000193) >>> 0;
    }
    return hash.toString(16).padStart(8, "0");
  });
  return values.join("");
}
