/**
 * SAM.gov NIGHTLY CONTRACT-OPPORTUNITIES CSV — pure parse / filter / map layer.
 * (owner-approved 2026-10-19, spec: shared/sam-csv-ingest-spec-2026-10-19.md)
 *
 * WHY THIS EXISTS
 * ---------------
 * SAM.gov publishes ONE keyless, no-quota, rolling full extract of every ACTIVE
 * Contract Opportunity notice per day (~03:30 UTC):
 *
 *   https://s3.amazonaws.com/falextracts/Contract%20Opportunities/datagov/ContractOpportunitiesFullCSV.csv
 *
 * 201.8 MB / 47 columns / 69,781 rows (measured 2026-10-19, extract dated
 * 2026-10-17). It carries the response deadline, the notice type, set-aside
 * code + label, NAICS, PSC, the parent/office hierarchy AND the place of
 * performance state (`PopState`) in every row — a superset of what the 4-hourly
 * SAM.gov search sync assembles with two requests per notice. Measured on that
 * extract: 12,232 rows carry a future response deadline and are not award /
 * justification notices, against the 1,114 federal rows with a real future
 * deadline stored in production (≈11×).
 *
 * HARD RULES BAKED IN HERE (owner's words, spec §Owner's rules 1–4, 7)
 * ------------------------------------------------------------------
 *  1. STORE ONLY REAL BIDS. A row is kept only when `ResponseDeadLine` PARSES
 *     and its UTC DATE is today or later — exactly the counter's
 *     `OPEN_BID_SQL` (`due_date IS NOT NULL AND due_date::date >= NOW()::date`).
 *     Award / justification notices are dropped with the SAME normalization the
 *     counter's `AWARD_NOTICE_EXCLUSION_SQL` uses (`isAwardOrJustificationType`).
 *  2. STATE = `PopState` ONLY — never the office `State`/`City`/`ZipCode`
 *     columns, never geocoding, never the agency text. A row with no `PopState`
 *     stores a BLANK location and a NULL normalized_state. `location` never
 *     borrows a state from anywhere else, so the map/counter's `deriveStateCode`
 *     resolves exactly the state the notice itself publishes.
 *  3. IDENTITY = SAM's own `NoticeId` (32-hex), stored as `sam-<id>`, which is
 *     the identity the 4-hourly sync already writes (`sam-${item._id}` —
 *     measured in production: 15,067/15,084 `sam_gov` rows carry
 *     `^sam-[0-9a-f]{32}$`). Both jobs therefore upsert `ON CONFLICT (source,
 *     external_id)` on the SAME pair, so one notice can never become two rows.
 *     Rows are written under the EXISTING `sam_gov` source label, which
 *     `isFederalLabel()` already classifies as federal — the counter's federal
 *     figure picks them up with no classifier change.
 *  4. NEVER LOAD THE FILE. The CSV is parsed as a STREAM (the ingest pipes
 *     `curl` into stdin); this module's record splitter is incremental and
 *     handles quoted fields with embedded newlines and `""` escapes.
 *  5. NO STATE INFERENCE (spec §7): the 69% no-state gap is a separate project.
 *     `normalized_state` / `source_jurisdiction` carry the published PopState or
 *     NULL — this module deliberately does NOT call the write-path geography
 *     derivation (`deriveInsertLocationColumns`), whose agency-text fallback
 *     would invent a state for a `location`-less federal row.
 *
 * PURE: no DB, no network, no `process.env`, no server imports — unit-tested in
 * sam-csv.test.ts against a real byte-range fixture of the source.
 */

import { isAwardNoticeType } from "~/lib/open-bids";
import { isLowContent } from "~/lib/low-content";
import { normalizeStateInput } from "~/lib/location-state";
import { US_STATES } from "~/lib/states";
import { mapCategory } from "~/lib/trade-classification";
import { normalizeSetAside, stripHtml } from "~/jobs/sources/sam-gov";

/** The keyless SAM.gov daily extract (owner spec §Source of truth). */
export const SAM_CSV_URL =
  "https://s3.amazonaws.com/falextracts/Contract%20Opportunities/datagov/ContractOpportunitiesFullCSV.csv";

/**
 * The `bids.source` label every row of this job is written under. It is the
 * SAME label the 4-hourly SAM.gov sync uses, and that is deliberate: with an
 * identical `external_id` (`sam-<NoticeId>`) the two jobs share ONE dedupe key
 * — `(source, external_id)` — so they can never create two rows for one notice
 * (spec §Dedupe). `isFederalLabel("sam_gov")` is already TRUE, so the homepage
 * counter's federal figure picks the rows up unchanged (spec §New rows' source
 * label). A distinct label (`sam_csv`) would need a cross-label uniqueness
 * guarantee the schema cannot give without a non-additive index, so it is
 * deliberately NOT used.
 */
export const SAM_CSV_SOURCE = "sam_gov";

/** Verbatim header of the source (2026-10-19). Used to locate columns BY NAME. */
export const SAM_CSV_COLUMNS: readonly string[] = [
  "NoticeId", "Title", "Sol#", "Department/Ind.Agency", "CGAC", "Sub-Tier",
  "FPDS Code", "Office", "AAC Code", "PostedDate", "Type", "BaseType",
  "ArchiveType", "ArchiveDate", "SetASideCode", "SetASide", "ResponseDeadLine",
  "NaicsCode", "ClassificationCode", "PopStreetAddress", "PopCity", "PopState",
  "PopZip", "PopCountry", "Active", "AwardNumber", "AwardDate", "Award$",
  "Awardee", "PrimaryContactTitle", "PrimaryContactFullname",
  "PrimaryContactEmail", "PrimaryContactPhone", "PrimaryContactFax",
  "SecondaryContactTitle", "SecondaryContactFullname", "SecondaryContactEmail",
  "SecondaryContactPhone", "SecondaryContactFax", "OrganizationType", "State",
  "City", "ZipCode", "CountryCode", "AdditionalInfoLink", "Link", "Description",
];

// ── STREAMING RECORD SPLITTER ───────────────────────────────────────────────
//
// A row-per-line reader is WRONG for this file: `Description` is quoted HTML
// that routinely contains newlines. This is an incremental RFC-4180 record
// splitter: feed it chunks as they arrive from `curl` and it returns every
// COMPLETE record so far, holding the partial tail until the next chunk. Peak
// memory is one record, not the 201.8 MB file (spec: never load it all).

export interface CsvRecordStream {
  /** Feed one decoded chunk; returns the records it completed. */
  push(chunk: string): string[][];
  /** Flush the final record (the file may not end with a newline). */
  end(): string[][];
}

export function createCsvRecordStream(): CsvRecordStream {
  let field = "";
  let record: string[] = [];
  let inQuotes = false;
  const complete: string[][] = [];

  const finishField = () => {
    record.push(field);
    field = "";
  };
  const finishRecord = () => {
    finishField();
    complete.push(record);
    record = [];
  };

  return {
    push(chunk: string): string[][] {
      for (let i = 0; i < chunk.length; i++) {
        const ch = chunk[i]!;
        if (inQuotes) {
          if (ch === '"') {
            if (chunk[i + 1] === '"') {
              field += '"'; // "" escape
              i++;
            } else {
              inQuotes = false;
            }
          } else {
            field += ch;
          }
          continue;
        }
        if (ch === '"') {
          inQuotes = true;
          continue;
        }
        if (ch === ",") {
          finishField();
          continue;
        }
        if (ch === "\r") continue; // CRLF / lone CR
        if (ch === "\n") {
          finishRecord();
          continue;
        }
        field += ch;
      }
      return complete.splice(0, complete.length);
    },
    end(): string[][] {
      const out = complete.splice(0, complete.length);
      // A trailing record is only real when it holds any data — an empty final
      // field after the last newline is not a row.
      if (field.length > 0 || record.length > 0) {
        finishField();
        if (record.some((f) => f.length > 0)) out.push(record);
        record = [];
        field = "";
      }
      return out;
    },
  };
}

/** Column name → index, from the file's own header row. Later duplicates lose. */
export function csvHeaderIndex(header: readonly string[]): Map<string, number> {
  const index = new Map<string, number>();
  header.forEach((name, i) => index.set(name.trim(), i));
  return index;
}

// ── ROW → NOTICE ────────────────────────────────────────────────────────────

/** One parsed source row, limited to the columns this job uses. */
export interface SamCsvNotice {
  noticeId: string;
  title: string;
  solicitationNumber: string | null;
  subTier: string | null;
  office: string | null;
  postedDate: string | null;
  noticeType: string | null;
  archiveDate: string | null;
  setAsideCode: string | null;
  setAsideLabel: string | null;
  /** Raw `ResponseDeadLine` text (ISO-8601 with offset), kept verbatim. */
  responseDeadline: string | null;
  naicsCode: string | null;
  psc: string | null;
  popCity: string | null;
  popState: string | null;
  /** The OFFICE state column — parsed to prove it is never used (spec §2). */
  officeState: string | null;
  link: string | null;
  description: string;
}

const NOTICE_ID_RE = /^[0-9a-fA-F]{32}$/;
const NAICS_RE = /^\d{2,6}$/;
const PSC_RE = /^[A-Za-z][0-9]{3}$/;

function cell(record: readonly string[], index: Map<string, number>, name: string): string {
  const i = index.get(name);
  if (i === undefined || i >= record.length) return "";
  return String(record[i] ?? "").trim();
}

/**
 * Map one CSV record to a notice, or null when the row is unusable (a short
 * row, or a missing/invalid SAM `NoticeId` — an identity is never invented).
 */
export function parseSamCsvRecord(
  record: readonly string[],
  index: Map<string, number>,
): SamCsvNotice | null {
  const noticeId = cell(record, index, "NoticeId");
  if (!NOTICE_ID_RE.test(noticeId)) return null;
  const naics = cell(record, index, "NaicsCode");
  const psc = cell(record, index, "ClassificationCode").toUpperCase();
  return {
    noticeId: noticeId.toLowerCase(),
    title: cell(record, index, "Title") || "Untitled Opportunity",
    solicitationNumber: cell(record, index, "Sol#") || null,
    subTier: cell(record, index, "Sub-Tier") || null,
    office: cell(record, index, "Office") || null,
    postedDate: cell(record, index, "PostedDate") || null,
    noticeType: cell(record, index, "Type") || null,
    archiveDate: cell(record, index, "ArchiveDate") || null,
    setAsideCode: cell(record, index, "SetASideCode") || null,
    setAsideLabel: cell(record, index, "SetASide") || null,
    responseDeadline: cell(record, index, "ResponseDeadLine") || null,
    naicsCode: NAICS_RE.test(naics) ? naics : null,
    psc: PSC_RE.test(psc) ? psc : null,
    popCity: cell(record, index, "PopCity") || null,
    popState: cell(record, index, "PopState") || null,
    // Parsed ONLY so the test can prove the ingest never reads it for state.
    officeState: cell(record, index, "State") || null,
    link: cell(record, index, "Link") || null,
    description: cell(record, index, "Description"),
  };
}

// ── FILTERS (mirror the counter exactly) ────────────────────────────────────

/** Parse an ISO-8601 `ResponseDeadLine` (with offset) → Date, or null. */
export function parseDeadline(raw: string | null | undefined): Date | null {
  const s = String(raw ?? "").trim();
  if (!s) return null;
  const iso = s.replace(/Z$/i, "+00:00");
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) {
    // Tolerate the SAM "YYYY-MM-DD HH:mm:ss" spelling (no T, no offset).
    const alt = new Date(s.replace(" ", "T") + (/[+-]\d\d:?\d\d$|Z$/.test(s) ? "" : "Z"));
    return Number.isNaN(alt.getTime()) ? null : alt;
  }
  return d;
}

/** UTC midnight of a date — the granularity `OPEN_BID_SQL` compares at. */
export function utcDateStart(d: Date): number {
  return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate());
}

/**
 * TRUE when the row belongs in the corpus: a parsable deadline whose UTC date
 * is TODAY OR LATER. This is `OPEN_BID_SQL`
 * (`due_date IS NOT NULL AND due_date::date >= NOW()::date`) evaluated in JS, so
 * a stored row can never be one the counter would refuse to count.
 */
export function isOpenDeadline(raw: string | null | undefined, now: Date = new Date()): boolean {
  const d = parseDeadline(raw);
  if (!d) return false;
  return utcDateStart(d) >= utcDateStart(now);
}

/**
 * The counter's `AWARD_NOTICE_EXCLUSION_SQL` set, plus the CSV's own
 * "Justification and Approval (J&A)" spelling (spec §Filters). The shared
 * `isAwardNoticeType` is the authority for the first three values; this adds the
 * J&A family by PREFIX so no downstream spelling ("Justification & Approval
 * (J&A)", "Justification and Approval") can slip through.
 */
export function isAwardOrJustificationType(noticeType: string | null | undefined): boolean {
  if (noticeType == null) return false;
  const t = String(noticeType).toLowerCase().trim();
  if (isAwardNoticeType(t)) return true;
  return t.startsWith("justification");
}

/** Every reason a row is dropped, for the run log (never a silent skip). */
export type SkipReason =
  | "unusable_row"
  | "missing_deadline"
  | "past_deadline"
  | "award_or_justification"
  | "duplicate_notice_id";

/** The two reasons a row is not a live opportunity (checked in this order). */
export function noticeSkipReason(
  notice: SamCsvNotice,
  now: Date = new Date(),
): SkipReason | null {
  if (isAwardOrJustificationType(notice.noticeType)) return "award_or_justification";
  if (!notice.responseDeadline) return "missing_deadline";
  if (!isOpenDeadline(notice.responseDeadline, now)) {
    return parseDeadline(notice.responseDeadline) ? "past_deadline" : "missing_deadline";
  }
  return null;
}

// ── NOTICE → bids ROW ───────────────────────────────────────────────────────

/** The subset of `bids` columns this job writes. */
export interface SamCsvBidRow {
  external_id: string;
  title: string;
  agency: string;
  description: string;
  location: string;
  category: string;
  due_date: string;
  estimated_value: string;
  source_url: string;
  set_aside: string | null;
  naics_code: string | null;
  psc: string | null;
  notice_type: string | null;
  solicitation_number: string | null;
  /** Published PopState only — NULL when the notice has none. */
  normalized_state: string | null;
  /** Same evidence as normalized_state (no curated pin exists for sam_gov). */
  source_jurisdiction: string | null;
  /** Verbatim stored `location`, or NULL when blank. */
  raw_location: string | null;
  /** `YYYY-MM-DD` from `PostedDate`, or NULL. */
  posted_date: string | null;
  /** `YYYY-MM-DD` from `ArchiveDate`, or NULL. */
  archive_date: string | null;
}

/** The identity both SAM jobs agree on: `sam-<32-hex NoticeId>`. */
export function samCsvExternalId(noticeId: string): string {
  return `sam-${String(noticeId).trim().toLowerCase()}`;
}

/**
 * The set-aside label this job stores.
 *
 * DELIBERATE DEVIATION FROM THE 4-HOURLY SYNC, measured and documented: the
 * shared `normalizeSetAside` maps the CODE "SBA" → "8(a)", but in SAM's daily
 * extract "SBA" is the **Total Small Business Set-Aside** code (its own human
 * label in the same row reads "Small Business Set Aside - Total"). Reusing the
 * code path would stamp "8(a)" on total-small-business notices and tell 8(a)
 * firms they are eligible for set-asides they are not — an honesty failure the
 * 10k new rows would spread widely. So the LABEL is authoritative here (it is
 * SAM's own words), and the code is used only when the label yields nothing:
 *
 *   "Service-Disabled Veteran-Owned Small Business" → SDVOSB   (label, via the
 *   shared normalizer's own phrase rules)
 *   "Small Business Set Aside - Total"              → the label, verbatim
 *   "8(a) Sole Source"                              → 8(a)
 *
 * The 4-hourly sync's behavior is UNTOUCHED (owner rule: keep that job as it is)
 * — this is reported as a separate finding, not silently "fixed" there.
 */
export function csvSetAsideLabel(notice: SamCsvNotice): string | null {
  const code = String(notice.setAsideCode ?? "").trim();
  const label = String(notice.setAsideLabel ?? "").trim();
  // Explicit NON-set-aside (1,472 of the 12,232 measured rows): the file says so
  // in words, and the shared normalizer would otherwise return the phrase
  // "No Set aside used" verbatim as if it were a set-aside.
  if (code.toUpperCase() === "NONE" || /^(no\s*set[-\s]?aside|no set aside)/i.test(label)) {
    return null;
  }
  const fromLabel = normalizeSetAside(label);
  // 1) SAM's own words, when they name a set-aside this product recognises.
  if (fromLabel && CANONICAL_SET_ASIDES.has(fromLabel)) return fromLabel;
  // 2) The code — the corpus convention the 4-hourly sync already stores
  //    (SDVOSBC→SDVOSB, HZC→HUBZone, ISBEE/IEE/VSA/LAS/BICiv verbatim) — EXCEPT
  //    the two total/partial small-business codes, whose "SBA" spelling the
  //    shared normalizer wrongly resolves to "8(a)" (see the block comment).
  if (
    /^[A-Za-z][A-Za-z0-9]{1,11}$/.test(code) &&
    !["SBA", "SBP"].includes(code.toUpperCase())
  ) {
    return normalizeSetAside(code);
  }
  // 3) Everything else: the label verbatim ("Small Business Set Aside - Total").
  return fromLabel;
}

/** The set-aside values `normalizeSetAside` resolves to a real designation. */
const CANONICAL_SET_ASIDES: ReadonlySet<string> = new Set([
  "8(a)",
  "8AN",
  "SDVOSB",
  "VOSB",
  "WOSB",
  "EDWOSB",
  "WOSB/EDWOSB",
  "HUBZone",
  "MBE",
  "WBE",
  "DBE",
]);

/** `PostedDate`/`ArchiveDate` arrive as "YYYY-MM-DD HH:mm:ss" — keep the date. */
export function csvDateOnly(raw: string | null | undefined): string | null {
  const m = String(raw ?? "").trim().match(/^(\d{4}-\d{2}-\d{2})/);
  return m ? m[1]! : null;
}

/**
 * Map a notice to the `bids` row this job writes, or null when the notice is
 * not a live opportunity (award / justification, or no future deadline).
 *
 * STATE RULE (spec §4): `location` is the notice's own place of performance —
 * "PopCity, PopState" when both exist, the bare `PopState` when only it exists,
 * and EMPTY when the notice publishes no `PopState`. The office columns
 * (`State`/`City`/`ZipCode`) are never read here, and no agency-text fallback is
 * applied, so a row's state is exactly what SAM published for the work site.
 */
export function csvNoticeToBid(
  notice: SamCsvNotice,
  now: Date = new Date(),
): SamCsvBidRow | null {
  if (noticeSkipReason(notice, now) !== null) return null;

  const state = normalizeStateInput(notice.popState); // "" unless a real USPS code
  const location = state
    ? notice.popCity
      ? `${notice.popCity}, ${state}`
      : state
    : "";
  const deadline = parseDeadline(notice.responseDeadline)!;
  const agency = notice.office || notice.subTier || "Federal Agency";
  const link = notice.link && /^https?:\/\//i.test(notice.link)
    ? notice.link
    : `https://sam.gov/opp/${notice.noticeId}/view`;

  return {
    external_id: samCsvExternalId(notice.noticeId),
    title: notice.title,
    agency,
    description: stripHtml(notice.description).substring(0, 2000),
    location,
    category: mapCategory(notice.noticeType ?? "", notice.title, notice.description),
    due_date: deadline.toISOString(),
    estimated_value: "Not specified",
    source_url: link,
    set_aside: csvSetAsideLabel(notice),
    naics_code: notice.naicsCode,
    psc: notice.psc,
    notice_type: notice.noticeType,
    solicitation_number: notice.solicitationNumber,
    normalized_state: state || null,
    source_jurisdiction: state || null,
    raw_location: location || null,
    posted_date: csvDateOnly(notice.postedDate),
    archive_date: csvDateOnly(notice.archiveDate),
  };
}

/**
 * The fields that, when changed, make a stored row worth rewriting. Mirrors the
 * `IS DISTINCT FROM` guard the ingest's upsert applies in SQL, and is the
 * client-side mirror used by the change-detection tests (spec §Change
 * detection: title, description, due_date, state/location, set_aside, naics_code,
 * psc, agency, source_url, posted/archive dates).
 */
export function csvBidChangeTuple(row: SamCsvBidRow): string {
  return [
    row.title,
    row.description,
    row.due_date,
    row.location,
    row.set_aside ?? "",
    row.naics_code ?? "",
    row.psc ?? "",
    row.notice_type ?? "",
    row.agency,
    row.source_url,
    row.normalized_state ?? "",
    row.posted_date ?? "",
    row.archive_date ?? "",
  ].join("\u0001");
}

// ── TOTALSTATES PROJECTION (the owner's hard gate) ──────────────────────────

/**
 * The state codes the homepage /map counter would attribute to a row — the SAME
 * rule as `deriveStateCode` in ~/lib/contract-map: the LAST whitespace/comma
 * token that is a real 2-letter USPS code, else a full state name, else none.
 * Kept here as a thin, dependency-free mirror so the projection below can be
 * computed without loading the map module; `sam-csv.test.ts` pins that the two
 * agree on the shapes this job produces.
 */
export function stateCodeFromLocation(location: string | null | undefined): string | null {
  const loc = String(location ?? "").trim();
  if (!loc) return null;
  const codes = new Set<string>(US_STATES);
  const tokens = loc.split(/[\s,()/]+/).filter(Boolean);
  for (let i = tokens.length - 1; i >= 0; i--) {
    const t = tokens[i]!.toUpperCase();
    if (/^[A-Z]{2}$/.test(t) && codes.has(t)) return t;
  }
  return null;
}

export interface StateProjection {
  /** States present in the live counter population (before the run). */
  before: string[];
  /** States that would be present once this run's rows are stored. */
  after: string[];
  /** States the run would ADD to the counter (the change that must not ship). */
  added: string[];
  /** States the run would REMOVE (only possible through a close-out). */
  removed: string[];
}

/**
 * The KEPT-ROW upper bound on the counter's state set: the live set plus every
 * state any kept row publishes (low-content rows included). Used by the dry-run
 * measurement; the live run reports the counter's own counted arithmetic through
 * `projectStateCounts` (which drops low-content rows exactly as the counter
 * does). Nothing here gates or aborts anything — the state count follows the
 * real data (owner 2026-10-19).
 */
export function projectStates(
  liveStates: readonly string[],
  rows: readonly SamCsvBidRow[],
): StateProjection {
  const before = [...new Set(liveStates.map((s) => String(s).toUpperCase()))].sort();
  const after = new Set(before);
  for (const row of rows) {
    const code = row.normalized_state ?? stateCodeFromLocation(row.location);
    if (code) after.add(code);
  }
  const afterList = [...after].sort();
  return {
    before,
    after: afterList,
    added: afterList.filter((c) => !before.includes(c)),
    removed: before.filter((c) => !afterList.includes(c)),
  };
}
// ── TOTALSTATES IS OBSERVED, NOT GATED (owner 2026-10-19) ───────────────────
/**
 * Every jurisdiction the counter can attribute a bid to — 50 states + DC.
 * (US_STATES is the single source of truth.)
 */
export const ALL_COUNTER_STATES: readonly string[] = [...US_STATES];

export interface StateSetChange {
  /** Did the counter's open-bid state set change in EITHER direction? */
  changed: boolean;
  before: string[];
  after: string[];
  /** States this run would ADD to the counter. */
  added: string[];
  /** States this run would DROP from the counter (a close-out can do this). */
  removed: string[];
}

/**
 * ── THE OWNER'S DECISION (2026-10-19): THE STATE COUNT FOLLOWS THE REAL DATA ─
 * A changed counter state set is an OBSERVATION, not an approval gate. The set
 * was 50 on 2026-10-17 and becomes 51 the first time real Maine notices enter
 * the live counter (10 of them in the 2026-10-17 extract); it may move back down
 * when those notices close, and it must be free to move in BOTH directions. A
 * stalled nightly import is worse than a count moving by one, so a change is
 * LOGGED AND ALERTED (see `./sam-csv-state-alert.ts`) and the import ALWAYS
 * PROCEEDS: the run never fails, and never writes nothing, because the count
 * moved. (Supersedes the "approved state set" block-gate of the first build,
 * which refused to write and exited non-zero on a set change.)
 *
 * Pure: no I/O, no opinion about which set is "right" — only what changed.
 */
export function describeStateSetChange(
  before: readonly string[],
  after: readonly string[],
): StateSetChange {
  const b = [...new Set(before.map((s) => String(s).toUpperCase()))].sort();
  const a = [...new Set(after.map((s) => String(s).toUpperCase()))].sort();
  const added = a.filter((c) => !b.includes(c));
  const removed = b.filter((c) => !a.includes(c));
  return { changed: added.length > 0 || removed.length > 0, before: b, after: a, added, removed };
}

export interface StateOpenCountDelta {
  state: string;
  /** Open rows the counter attributes to this state BEFORE the run. */
  before: number;
  /** …and after it, once this run's counted rows are stored. */
  after: number;
  delta: number;
  /** Entering the counter for the first time in this run. */
  added: boolean;
  /** Leaving the counter (its last counted row closed out). */
  removed: boolean;
}

/**
 * Per-state open-count deltas over the UNION of both count maps — so a run that
 * adds Maine says "ME 0 → 10" and a run that loses it says "ME 10 → 0", rather
 * than only naming a code. Only states whose count actually moves are returned.
 */
export function stateOpenCountDeltas(
  before: Readonly<Record<string, number>>,
  after: Readonly<Record<string, number>>,
): StateOpenCountDelta[] {
  const keys = new Set([...Object.keys(before), ...Object.keys(after)]);
  return [...keys]
    .sort()
    .map((state) => {
      const b = before[state] ?? 0;
      const a = after[state] ?? 0;
      return {
        state,
        before: b,
        after: a,
        delta: a - b,
        added: b === 0 && a > 0,
        removed: a === 0 && b > 0,
      };
    })
    .filter((d) => d.delta !== 0);
}

export interface CounterRowStats {
  /** Kept rows that enter the counter (real deadline, not low-content). */
  counted: number;
  /** Kept rows the counter's OWN low-content rule refuses: counted by nobody. */
  refusedLowContent: number;
  /**
   * Counted rows whose deadline is later TODAY. The counter's rule is
   * date-granular (`due_date::date >= NOW()::date`) while a timestamp-strict
   * count (`due_date > now`) excludes these; both are reported so a projection
   * can never be out by an unexplained boundary.
   */
  countedTodayOnly: number;
  /** Kept rows that publish a PopState — what the state picker can see. */
  withPopState: number;
  /** Kept rows that publish NO PopState (blank location, NULL normalized_state). */
  withoutPopState: number;
}

/**
 * The row-level half of the counter's arithmetic, over this run's kept rows:
 * how many of them the counter will actually count, how many its OWN low-content
 * rule refuses, and how many carry a PopState at all (a row with no PopState can
 * never move the state picker, whatever else it does). Pure.
 *
 * The state SET itself is never guessed here: the live run reads the counter
 * before and after the write (its own query) and reports the delta between those
 * two real reads, which is the only way a REMOVAL (the last counted row in a
 * state closing out) can be seen honestly.
 */
export function keptRowCounterStats(
  rows: readonly SamCsvBidRow[],
  now: Date = new Date(),
): CounterRowStats {
  let counted = 0;
  let refusedLowContent = 0;
  let countedTodayOnly = 0;
  let withPopState = 0;
  let withoutPopState = 0;
  const nowMs = now.getTime();
  for (const row of rows) {
    const code = row.normalized_state ?? stateCodeFromLocation(row.location);
    if (code) withPopState++;
    else withoutPopState++;
    if (isLowContent(row.title, row.location, row.set_aside)) {
      refusedLowContent++; // the counter's LOW_CONTENT rule refuses it: nobody counts it
      continue;
    }
    counted++;
    const due = row.due_date ? new Date(row.due_date) : null;
    if (due && !Number.isNaN(due.getTime()) && due.getTime() <= nowMs) countedTodayOnly++;
  }
  return { counted, refusedLowContent, countedTodayOnly, withPopState, withoutPopState };
}
// ── CLOSE-OUT RULE ─────────────────────────────────────────────────────────

/**
 * Whether a stored row must be CLOSED OUT (spec §Close-out). Two honest
 * triggers, and nothing else:
 *
 *  1. its deadline has passed (the counter's `OPEN_BID_SQL` already refuses it,
 *     so the flag only records the truth), or
 *  2. it is MISSING from tonight's file — the notice left SAM's active extract
 *     (cancelled / archived) — and it was stored BEFORE the extract was
 *     generated, so a notice the 4-hourly sync found TODAY (a genuine same-day
 *     new bid, which the owner keeps that job for) is never closed by this job
 *     just because last night's file predates it.
 *
 * Rows with no deadline at all are never closed by this rule: they were never
 * "open" under `OPEN_BID_SQL` (they are deadline-less, not closed), so marking
 * them closed would claim something the data does not say.
 */
export function shouldCloseOut(args: {
  dueDate: string | Date | null;
  externalId: string;
  tonightIds: ReadonlySet<string>;
  createdAt: string | Date | null;
  extractTime: Date;
  now: Date;
}): boolean {
  const due = args.dueDate ? new Date(args.dueDate) : null;
  if (due && !Number.isNaN(due.getTime())) {
    if (utcDateStart(due) < utcDateStart(args.now)) return true; // deadline passed
  } else {
    return false; // deadline-less rows are "not open", never "closed"
  }
  if (args.tonightIds.has(args.externalId)) return false; // still in the file
  const created = args.createdAt ? new Date(args.createdAt) : null;
  if (created && !Number.isNaN(created.getTime()) && created.getTime() >= args.extractTime.getTime()) {
    return false; // stored after the extract was generated — not yet representable
  }
  return true;
}
