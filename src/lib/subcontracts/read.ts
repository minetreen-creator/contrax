/**
 * Contrax — SUBCONTRACTING preview, READ side: PURE shaping, labels and query
 * validation (owner directive 2026-09-25, BUILD-PLAN.md §6.3/§6.4).
 *
 * PURE MODULE: no DB, no network, no node builtins, no env reads. Everything here
 * is a pure function over a stored row or over a URLSearchParams, so the whole
 * read surface is unit-tested with zero I/O
 * (src/lib/subcontracts/read.test.ts). The SQL lives in `read.server.ts`.
 *
 * WHO DECIDES WHAT — the honesty contract of this page:
 *   - The DATABASE decides status (`open` | `closed` | `unverified`) and the open
 *     set. Nothing in this module may re-derive `open` from a date: a notice whose
 *     closing date passed is already `closed` in storage. The page's client-side
 *     Eastern filter is a DISPLAY GUARD only (a row may be up to one sweep old).
 *   - `unverified` rows (no closing date published, or the source stopped
 *     publishing them) NEVER enter the open list and are never rendered as open.
 *     They are reported as a count — the owner's excluded line — so their absence
 *     is visible rather than silent.
 *   - A missing value is rendered as "Not specified" / "no closing date listed";
 *     it is never guessed, rounded, or inferred from another field.
 *   - There is no published/updated timestamp on SBA SUBNet at all, so the ONLY
 *     freshness statement this page may make is OUR fetch time, labelled
 *     "last checked by Contrax" (owner copy 2026-09-25, correction 1). The words
 *     "posted"/"published" never label that timestamp.
 *   - The words "nationwide" and "comprehensive" are banned on this surface: the
 *     source is a posting board, not a directory, and its per-state sparsity is a
 *     property of the board (BUILD-PLAN §6.4 #3, §6.6 #9).
 */
import {
  GSA_PRIME_DIRECTORY_SOURCE,
  PRIME_DIRECTORY_SOURCE,
  SUBNET_SOURCE,
  storedScopeLabel,
  stripSourceHeadingResidue,
  unmappedScopeLabel,
  type SubcontractStatus,
} from "~/lib/subcontracts/connector";
import { GSA_FY_LABEL, gsaAddressLine } from "~/lib/subcontracts/gsa-directory";

/** The official SBA page the annual prime file is published on (never the raw XLSX). */
export const PRIME_DIRECTORY_SOURCE_URL = PRIME_DIRECTORY_SOURCE.officialUrl;
/** The official GSA page the directory CSV is published from (never the raw CSV). */
export const GSA_PRIME_DIRECTORY_SOURCE_URL = GSA_PRIME_DIRECTORY_SOURCE.officialUrl;
/** The official SBA SUBNet board, linked from the honest unavailable state. */
export const SUBNET_SOURCE_URL = SUBNET_SOURCE.officialUrl;

// ── Labels the owner approved (BUILD-PLAN §6.4, OWNER-COPY 2026-09-25) ────────

/** Short source label used in the freshness line (never the long registry name). */
export const SUBNET_SOURCE_LABEL = "SBA SUBNet";

/** Owner copy: the ONLY freshness wording allowed for our own fetch time. */
export const LAST_CHECKED_LABEL = "last checked by Contrax";

/** Owner copy (correction 3): the excluded-bucket line. `{n}` is the real count. */
export function excludedNoClosingDateText(count: number): string {
  return `${count} excluded — no closing date stated`;
}

/**
 * BUILD-PLAN §6.4 #3, SHIPPED VERBATIM. This sentence is why a sparse state is not
 * a bug and why the page may never imply coverage of a state's market.
 */
export const SUBNET_POSTING_BOARD_SENTENCE =
  "SBA SUBNet is a national posting board, not a directory. A state with few or no listings means no prime has posted there recently — it does not mean no subcontracting exists in that state.";

/** The draft's own note on trade labels — kept, because it is the honest one. */
export const LISTED_SCOPES_NOTE =
  "labels reflect the notice; they are not an eligibility or fit determination";

/** The plan's card wording for a notice with no published closing date. */
export const NO_CLOSING_DATE_LISTED = "no closing date listed";

/** One fallback every "missing value" renders with (never a blank, never a guess). */
export const NOT_SPECIFIED = "Not specified";

/** The state chip when the source's wording could not be normalized to a state. */
export const STATE_NOT_STATED = "state not stated";

// ── The prime-directory (S2) labels ──────────────────────────────────────────

/** The annual file's fiscal year, echoed everywhere the prime rows are shown. */
export const PRIME_DIRECTORY_FY = "FY24";

/** Owner copy (correction 2): the prime list is HISTORICAL, not a live lead set. */
export const PRIME_DIRECTORY_HEADING = "Subcontracting leads — SBA FY24 directory (annual)";

export const PRIME_DIRECTORY_CONTEXT =
  "The SBA FY24 directory is an annual file (fiscal year 2024) of federal prime contractors that reported a subcontracting plan. It is a historical snapshot — these are companies to approach, not open opportunities.";

// ── The GSA directory (S3) labels — owner-verbatim where marked ──────────────

/**
 * The fiscal-year value stored on every GSA row and echoed by the read path.
 *
 * This source publishes NO fiscal year, so `fy` holds the literal 'past fiscal year'
 * (the same string the owner's heading uses). 'FY25' or any year would be an inference
 * from the file name, which is exactly what the owner's wording avoids.
 */
export const GSA_PRIME_DIRECTORY_FY = GSA_FY_LABEL;

/** Owner-verbatim (2026-09-26), byte for byte — middot separators, no year, no em dash. */
export const GSA_PRIME_DIRECTORY_HEADING =
  "GSA prime contractor directory · past fiscal year · last checked by Contrax";

/**
 * Why this list is historical and what it is not. Mirrors the SBA section's framing
 * because the honesty rules are identical: a directory of companies to approach.
 */
export const GSA_PRIME_DIRECTORY_CONTEXT =
  "The GSA directory lists companies that hold GSA contracts carrying a subcontracting plan. It is an annual file — these are companies to approach, not open opportunities.";

/** The fallback for a row the source published no valid NAICS code for. */
export const GSA_NAICS_NOT_STATED = "NAICS not stated";

/** The source's own wording for a company outside the United States. */
export const GSA_NON_US_STATE = "Non-US";
/** How that value is labelled — it is a source value, not a US state. */
export const GSA_NON_US_LABEL = "Non-US (as the source states)";

/**
 * How a stored state value is shown. Verbatim, EXCEPT the source's own `Non-US`, which
 * is explicitly labelled as the source's wording: it is not a state and must never be
 * read as one. Nothing is mapped to a 2-letter code here — the directory publishes full
 * names, and inventing a code would put a company in a filter it never stated.
 */
export function gsaStateLabel(state: string | null | undefined): string {
  const value = (state ?? "").trim();
  if (!value) return STATE_NOT_STATED;
  return value.toUpperCase() === GSA_NON_US_STATE.toUpperCase() ? GSA_NON_US_LABEL : value;
}

/**
 * The honesty line for rows the source published no valid 6-digit NAICS code for.
 * Mirrors the page's existing excluded-count pattern ("N excluded — no closing date
 * stated"): the count is real, the consequence is stated, and nothing is implied about
 * the companies themselves.
 */
export function gsaNonNaicsText(count: number): string {
  return `${count} rows without a valid NAICS code — no trade label stated, so the NAICS filter cannot match them`;
}

/**
 * One stored NAICS entry → the label the surface shows, never a bare code.
 *
 * SBA rows store `"541330: ENGINEERING SERVICES"` (the source's own title) and keep it.
 * GSA rows store the CODE ONLY (the source publishes no title), so the code is resolved
 * through the repo's single NAICS name table by the same resolver the SUBNet notices use
 * (#449): a known code becomes its name, an unknown one becomes
 * "NAICS <code> (title not stated)". A bare code is therefore never rendered as a trade.
 */
export function naicsDisplayLabels(stored: readonly string[]): string[] {
  const labels: string[] = [];
  for (const entry of stored) {
    const text = (entry ?? "").trim();
    if (!text) continue;
    const withTitle = /^(\d{2,6})\s*[:\-–]\s*(.+)$/.exec(text);
    if (withTitle) {
      labels.push(withTitle[2]!.trim());
      continue;
    }
    if (/^\d{2,6}$/.test(text)) {
      labels.push(unmappedScopeLabel(text));
      continue;
    }
    labels.push(text);
  }
  return labels;
}

// ── Fail-closed reasons (BUILD-PLAN §6.3) ────────────────────────────────────
//
// Every one of these is a REASON STRING for an explicit `unavailable` state. The
// page renders it instead of a list. A fabricated empty list would read as "there
// are no subcontracting notices", which is a claim we cannot support from a store
// we could not read.

/** The tables are not in this database (e.g. a preview DB without migration 050). */
export const UNAVAILABLE_TABLES_REASON =
  "This deployment's database does not have the subcontracting tables (migration 050 has not been applied here), so there is no stored SUBNet data to read.";

/** The store exists but could not be read (no connection string, timeout, SQL error). */
export const UNAVAILABLE_STORE_REASON =
  "Contrax could not read the stored subcontracting notices (the store is unreachable right now).";

/** No completed sweep is recorded, so there is no honest open set to show. */
export const UNAVAILABLE_NEVER_SYNCED_REASON =
  "No completed SBA SUBNet check is recorded for this deployment yet, so there is no checked set of notices to show.";

/**
 * The GSA directory has never been checked by this deployment.
 *
 * The GSA section prints "last checked by Contrax" + a real timestamp, so with no recorded
 * check there is no honest line to print — and no rows to date. It is `unavailable`, not
 * an empty list, for the same reason the notice list is: "we have not looked" and "there is
 * nothing to show" are different statements.
 */
export const UNAVAILABLE_GSA_NEVER_SYNCED_REASON =
  "No completed GSA directory check is recorded for this deployment yet, so there is no checked set of companies to show.";

/** Shown with every unavailable state, so "nothing here" is never read as "none exist". */
export const UNAVAILABLE_EXPLANATION =
  "Contrax shows nothing rather than an empty or unverified list.";

// ── Source-markup normalization (live findings O2/O3, 2026-09-25) ─────────────
//
// Two kinds of SOURCE MARKUP used to ride into the rendered text. Neither is data,
// so both are removed at this ONE boundary (and in the parser, via the same functions)
// rather than being papered over per surface:
//
//   O2 — every stored scope began "> Description ...": the section splitter left the
//        div tag's closing ">" at the head of the body, and the source's own
//        <h2>Description</h2> heading followed it. `storedScopeText` drops that
//        residue and keeps the description itself byte-for-byte.
//   O3 — three notices published a bare NAICS code and no title, so `trades` held
//        "236210" and the trade menu offered digits as a trade name. `scopeValues`
//        resolves a bare code to its standard NAICS name (never to the raw code), on
//        the row's own values AND on the census buckets, so a filter value and its
//        option label can never disagree.

/** A stored scope with the source's own heading residue removed; null when empty. */
export function storedScopeText(stored: string | null | undefined): string | null {
  if (typeof stored !== "string") return null;
  const text = stripSourceHeadingResidue(stored);
  return text.length > 0 ? text : null;
}

/**
 * A row's listed scopes as the surface shows them: trimmed, de-duplicated, and with a
 * bare NAICS code resolved to a readable label (see O3 above). A stored row is not
 * refetched while its index row is unchanged, so this read-side resolution is what
 * makes the value ALREADY in the database render honestly.
 */
export function scopeValues(trades: readonly string[] | null | undefined): string[] {
  const labels: string[] = [];
  for (const value of trades ?? []) {
    const text = typeof value === "string" ? value.trim() : "";
    if (!text) continue;
    const label = storedScopeLabel(text);
    if (label && !labels.includes(label)) labels.push(label);
  }
  return labels;
}

// ── Stored shapes ────────────────────────────────────────────────────────────

/** A `DATE` comes back from the driver as a Date or as a `YYYY-MM-DD` string. */
export type StoredDay = string | Date | null | undefined;
export type StoredStamp = string | Date | null | undefined;

/**
 * One row exactly as `subcontract_opportunities` stores it (the columns the read
 * surface selects). Deliberately loose types: the driver's JS types are part of the
 * boundary, so normalization happens here, once, in `normalizeDay`/`normalizeStamp`.
 */
export interface StoredNoticeRow {
  external_id: string;
  title: string;
  prime: string;
  prime_division: string | null;
  website: string | null;
  scope: string | null;
  summary: string | null;
  trades: string[] | null;
  certs_solicited: string[] | null;
  naics_code: string | null;
  naics_title: string | null;
  place_of_performance: string | null;
  state_code: string | null;
  closing_date: StoredDay;
  performance_start_date: StoredDay;
  contact_name: string | null;
  contact_email: string | null;
  source_url: string;
  detail_url: string;
  status: SubcontractStatus;
  last_verified_at: StoredStamp;
}

/** One notice as the page renders it. Every field is either real or null. */
export interface SubcontractNoticeView {
  externalId: string;
  title: string;
  prime: string;
  primeDivision: string | null;
  primeWebsite: string | null;
  stateCode: string | null;
  stateChip: string;
  placeOfPerformance: string | null;
  /** `YYYY-MM-DD`, or null when the source published no closing date. */
  closingDate: string | null;
  closingDateText: string | null;
  performanceStartDate: string | null;
  performanceStartText: string | null;
  scope: string | null;
  summary: string | null;
  trades: string[];
  certsSolicited: string[];
  naicsCode: string | null;
  naicsTitle: string | null;
  contactName: string | null;
  /** The prime's own address, `mailto:` stripped — null when unusable. */
  contactEmail: string | null;
  detailUrl: string;
  /** ISO instant of OUR last successful fetch of this row. */
  lastCheckedAt: string;
}

export interface CountBucket {
  /** The stored value (`AK`, a trade label, a NAICS code, a state name). */
  key: string;
  count: number;
}

/** The bucket used when a row's state could not be normalized from its source wording. */
export const STATE_BUCKET_UNKNOWN = "(state not stated)";

// ── Normalization ────────────────────────────────────────────────────────────

/**
 * The calendar day of a stored DATE, as `YYYY-MM-DD`, WITHOUT a timezone shift:
 * a `DATE` column has no time-of-day, and a local-time `toISOString()` would move
 * a 2026-09-25 closing date to 2026-09-24 for some readers.
 */
export function normalizeDay(value: StoredDay): string | null {
  if (value === null || value === undefined) return null;
  if (value instanceof Date) {
    if (Number.isNaN(value.getTime())) return null;
    return value.toISOString().slice(0, 10);
  }
  const text = String(value).trim();
  if (!text) return null;
  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(text);
  return match ? `${match[1]}-${match[2]}-${match[3]}` : null;
}

/** An ISO instant, or null. Used for `last_verified_at` (our fetch time). */
export function normalizeStamp(value: StoredStamp): string | null {
  if (value === null || value === undefined) return null;
  const date = value instanceof Date ? value : new Date(String(value));
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

/**
 * The prime's contact address. The source's own markup yields the address with or
 * without the `mailto:` URI scheme depending on which page it came from, so the
 * scheme is stripped here and anything that is not address-shaped becomes null
 * (which the card renders as "no contact email listed") — never a broken link.
 */
export function emailAddress(stored: string | null | undefined): string | null {
  if (!stored) return null;
  const text = String(stored).trim().replace(/^mailto:/i, "").trim();
  if (!text) return null;
  return /^[^\s@<>,;"]+@[^\s@<>,;"]+\.[^\s@<>,;"]+$/.test(text) ? text : null;
}

/** A `YYYY-MM-DD` day rendered for humans, in UTC (no drift), e.g. "Oct 6, 2026". */
export function dayText(day: string | null): string | null {
  if (!day) return null;
  const date = new Date(`${day}T12:00:00Z`);
  if (Number.isNaN(date.getTime())) return null;
  return date.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    timeZone: "UTC",
  });
}

/**
 * OUR fetch time, rendered in US Eastern — the timezone the source's own closing
 * dates are interpreted in. Date + time, because the sweep is a daily job.
 */
export function checkedAtText(stamp: string | Date | null | undefined): string | null {
  const iso = normalizeStamp(stamp);
  if (!iso) return null;
  return new Date(iso).toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
    timeZone: "America/New_York",
    timeZoneName: "short",
  });
}

/** The card's state chip: `Subcontract · AK`, or an explicit "not stated". */
export function stateChip(stateCode: string | null | undefined): string {
  const code = (stateCode ?? "").trim().toUpperCase();
  return `Subcontract · ${code ? code : STATE_NOT_STATED}`;
}

export function noticeCountText(count: number): string {
  return `${count} open ${count === 1 ? "notice" : "notices"}`;
}

export function companyCountText(count: number): string {
  return `${count} ${count === 1 ? "company" : "companies"}`;
}

// ── Row → view ───────────────────────────────────────────────────────────────

export function toNoticeView(row: StoredNoticeRow): SubcontractNoticeView {
  const closingDate = normalizeDay(row.closing_date);
  const performanceStart = normalizeDay(row.performance_start_date);
  return {
    externalId: row.external_id,
    title: row.title,
    prime: row.prime,
    primeDivision: row.prime_division?.trim() || null,
    primeWebsite: row.website?.trim() || null,
    stateCode: row.state_code?.trim().toUpperCase() || null,
    stateChip: stateChip(row.state_code),
    placeOfPerformance: row.place_of_performance?.trim() || null,
    closingDate,
    closingDateText: dayText(closingDate),
    performanceStartDate: performanceStart,
    performanceStartText: dayText(performanceStart),
    scope: storedScopeText(row.scope),
    summary: row.summary?.trim() || null,
    trades: scopeValues(row.trades),
    certsSolicited: (row.certs_solicited ?? []).filter((value) => Boolean(value?.trim())),
    naicsCode: row.naics_code?.trim() || null,
    naicsTitle: row.naics_title?.trim() || null,
    contactName: row.contact_name?.trim() || null,
    contactEmail: emailAddress(row.contact_email),
    detailUrl: row.detail_url,
    lastCheckedAt: normalizeStamp(row.last_verified_at) ?? "",
  };
}

// ── Counts (stored data only) ─────────────────────────────────────────────────

function sortBuckets(buckets: CountBucket[]): CountBucket[] {
  return buckets.sort((a, b) => b.count - a.count || a.key.localeCompare(b.key));
}

/** Open notices per state, from the stored rows. `null` state stays visible. */
export function tallyByState(rows: readonly StoredNoticeRow[]): CountBucket[] {
  const counts = new Map<string, number>();
  for (const row of rows) {
    const key = row.state_code?.trim().toUpperCase() || STATE_BUCKET_UNKNOWN;
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  return sortBuckets([...counts].map(([key, count]) => ({ key, count })));
}

/** Open notices per listed trade. A row with several trades counts once in each. */
export function tallyByTrade(rows: readonly StoredNoticeRow[]): CountBucket[] {
  const counts = new Map<string, number>();
  for (const row of rows) {
    // `scopeValues` (not the raw column): the census tile and the trade menu must show
    // the SAME label the row's own card shows, and neither may be a bare NAICS code.
    for (const trade of scopeValues(row.trades)) {
      counts.set(trade, (counts.get(trade) ?? 0) + 1);
    }
  }
  return sortBuckets([...counts].map(([key, count]) => ({ key, count })));
}

/**
 * The filter options, taken from the OPEN set only (kept from the draft, BUILD-PLAN
 * §1.2/§6.4 #2): a menu entry can never offer a value no open notice carries, so a
 * filter can never be the reason the whole board looks empty.
 */
export function stateOptions(rows: readonly StoredNoticeRow[]): string[] {
  return tallyByState(rows)
    .map((bucket) => bucket.key)
    .filter((key) => key !== STATE_BUCKET_UNKNOWN)
    .sort();
}

export function tradeOptions(rows: readonly StoredNoticeRow[]): string[] {
  const values = new Set<string>();
  for (const row of rows) {
    for (const trade of scopeValues(row.trades)) values.add(trade);
  }
  return [...values].sort();
}

// ── The payload contract (BUILD-PLAN §6.3) ───────────────────────────────────

export interface SubcontractsCoverage {
  /** Short label: "SBA SUBNet". */
  source: string;
  /** The ladder value from `subcontract_sources` (must be one of these four). */
  tier: "unavailable" | "limited" | "curated" | "connected";
  /** The latest SUCCESSFUL sweep's finish time (ISO), or null. */
  lastSyncAt: string | null;
  /** Max `last_verified_at` over the stored rows — the fallback freshness. */
  lastCheckedAt: string | null;
  /** Rows excluded from the open list because no closing date is stated. */
  missingClosingDateCount: number;
  /** The owner's excluded line, pre-rendered so it cannot drift per surface. */
  excludedText: string;
}

export interface SubcontractsPayload {
  rows: SubcontractNoticeView[];
  counts: {
    total: number;
    byState: CountBucket[];
    byTrade: CountBucket[];
  };
  coverage: SubcontractsCoverage;
  primeDirectory: {
    fy: string;
    sourceUrl: string;
    counts: { total: number };
  };
  /** Server time this payload was read (the response is `no-store`). */
  generatedAt: string;
}

export interface SubcontractsUnavailable {
  unavailable: {
    reason: string;
    explanation: string;
    /** The official board, so the honest state is still actionable. */
    sourceUrl: string;
  };
}

export type SubcontractsResponse = SubcontractsPayload | SubcontractsUnavailable;

/** Both reads (`/api/subcontracts` and `/api/subcontracts/primes`) share this shape. */
export type SubcontractsReadResponse = SubcontractsResponse | PrimesResponse;

export function isUnavailable(
  payload: SubcontractsReadResponse,
): payload is SubcontractsUnavailable {
  return "unavailable" in payload;
}

// ── The primes payload (BUILD-PLAN §6.3, S2) ─────────────────────────────────

export interface PrimeRowView {
  legalName: string;
  uei: string;
  vendorState: string | null;
  /** Verbatim, except the source's own `Non-US`, which is labelled as the source's wording. */
  vendorStateLabel: string;
  /** Stored NAICS entries, exactly as stored (SBA: `"code: TITLE"`; GSA: the code only). */
  naics: string[];
  /** The NAICS labels the surface shows — never a bare code (see naicsDisplayLabels). */
  naicsLabels: string[];
  /**
   * GSA-only evidence: the source's NAICS cell VERBATIM for a row whose code failed
   * /^\d{6}$/ (NULL for a valid code and for every SBA row — the key is ABSENT there, so the
   * SBA response stays byte-identical). It is carried so the invalid values are verifiable
   * through the read surface, and it is NEVER rendered as a trade label: every surface shows
   * `naicsLabels`, and a row with no valid code shows GSA_NAICS_NOT_STATED instead.
   */
  naicsRaw?: string | null;
  industries: string[];
  agencies: string[];
  awardRows: number;
  latestPopStart: string | null;
  subcontractPlanType: string | null;
  fy: string;
  sourceUrl: string | null;
  /**
   * GSA-only, migration 051. The source's full physical address with the source's own
   * `<br>` line breaks already turned into ", " — null for every SBA row.
   */
  vendorAddress: string | null;
  /** GSA-only: the source's own "Major products or service lines" text. Null for SBA rows. */
  productsServices: string | null;
  /** GSA-only: the source's own file date (evidence). Never rendered as a date. */
  sourceFileDate: string | null;
}

export interface StoredPrimeRow {
  legal_name: string;
  uei: string;
  vendor_state: string | null;
  naics: string[] | null;
  industries: string[] | null;
  agencies: string[] | null;
  award_rows: number | string | null;
  latest_pop_start: StoredDay;
  subcontract_plan_type: string | null;
  fy: string;
  source_url: string | null;
  /** Migration 051 — absent (undefined) on a database that has not applied it. */
  vendor_address?: string | null;
  products_services?: string | null;
  source_file_date?: StoredDay;
  /** Migration 051 — the raw NAICS cell for an INVALID code only (NULL for a valid one). */
  naics_raw?: string | null;
}

export function toPrimeView(row: StoredPrimeRow): PrimeRowView {
  const naics = (row.naics ?? []).filter((value) => Boolean(value?.trim()));
  return {
    legalName: row.legal_name,
    uei: row.uei,
    vendorState: row.vendor_state?.trim() || null,
    vendorStateLabel: gsaStateLabel(row.vendor_state),
    naics,
    naicsLabels: naicsDisplayLabels(naics),
    // Present ONLY when the caller read the migration-051 column: the SBA branch never
    // selects it, so an SBA row keeps exactly the keys it shipped with (byte-identical).
    ...(row.naics_raw === undefined ? {} : { naicsRaw: row.naics_raw?.trim() || null }),
    industries: (row.industries ?? []).filter((value) => Boolean(value?.trim())),
    agencies: (row.agencies ?? []).filter((value) => Boolean(value?.trim())),
    awardRows: Number(row.award_rows ?? 0),
    latestPopStart: normalizeDay(row.latest_pop_start),
    subcontractPlanType: row.subcontract_plan_type?.trim() || null,
    fy: row.fy,
    sourceUrl: row.source_url?.trim() || null,
    // The stored address keeps the source's line breaks; a card shows it on ONE line.
    vendorAddress: gsaAddressLine(row.vendor_address),
    productsServices: row.products_services?.trim() || null,
    sourceFileDate: normalizeDay(row.source_file_date),
  };
}

export interface PrimesQuery {
  naics: string | null;
  state: string | null;
  page: number;
  limit: number;
}

export const PRIMES_DEFAULT_LIMIT = 25;
export const PRIMES_MAX_LIMIT = 100;
export const PRIMES_MAX_PAGE = 500;

/**
 * Which directory a primes read is about. `sba` is the DEFAULT and keeps the existing
 * behaviour byte-for-byte; `gsa` is the second directory (migration 051).
 */
export type PrimesSourceId = "sba" | "gsa";
export const PRIMES_SOURCE_IDS: readonly PrimesSourceId[] = ["sba", "gsa"] as const;
export const PRIMES_DEFAULT_SOURCE: PrimesSourceId = "sba";

/** The error text for a present-but-invalid `source` value (the 400 body). */
export const PRIMES_SOURCE_ERROR = "source must be sba or gsa";

export function isPrimesSourceId(value: unknown): value is PrimesSourceId {
  return value === "sba" || value === "gsa";
}

/**
 * The `?source=` parameter. An ABSENT value is the default (`sba` — the existing
 * behaviour); a PRESENT but unknown value is a hard 400, exactly like every other
 * parameter, because a silently-coerced source would answer about a different directory
 * than the one that was asked for. Case is folded (a URL is not a case-sensitive API).
 */
export function validatePrimesSource(value: unknown): Parsed<PrimesSourceId> {
  if (value === null || value === undefined) return { ok: true, value: PRIMES_DEFAULT_SOURCE };
  const text = String(value).trim().toLowerCase();
  if (text === "") return { ok: true, value: PRIMES_DEFAULT_SOURCE };
  if (!isPrimesSourceId(text)) return { ok: false, error: PRIMES_SOURCE_ERROR };
  return { ok: true, value: text };
}

/** The `?source=` half of the HTTP route's parsing. */
export function parsePrimesSource(searchParams: URLSearchParams): Parsed<PrimesSourceId> {
  return validatePrimesSource(searchParams.get("source"));
}

export type Parsed<T> = { ok: true; value: T } | { ok: false; error: string };

/** `541330` — the NAICS code half of the stored `"541330: ENGINEERING SERVICES"`. */
const NAICS_CODE = /^\d{2,6}$/;
/** A US state name as the SBA file writes it (uppercase in storage). */
const STATE_VALUE = /^[A-Za-z][A-Za-z .'\-]{1,39}$/;

/**
 * Validates the primes query. Like every other Contrax read surface, an invalid
 * PRESENT value is a hard 400 (never silently coerced into "all rows" — a coerced
 * filter would answer a different question than the one asked), while an ABSENT
 * value means "no restriction".
 */
export function parsePrimesQuery(searchParams: URLSearchParams): Parsed<PrimesQuery> {
  const rawNaics = (searchParams.get("naics") ?? "").trim();
  const rawState = (searchParams.get("state") ?? "").trim();
  const rawPage = (searchParams.get("page") ?? "").trim();
  const rawLimit = (searchParams.get("limit") ?? "").trim();

  // A PRESENT value that is not a whole number fails HERE with the parser's own
  // wording ("must be a positive integer", not a range complaint); every other rule is
  // decided once, by validatePrimesQuery below, so a typed query and a parsed one can
  // never be judged by two different rule sets.
  if (rawPage && !/^\d+$/.test(rawPage)) {
    return { ok: false, error: "page must be a positive integer" };
  }
  if (rawLimit && !/^\d+$/.test(rawLimit)) {
    return { ok: false, error: "limit must be a positive integer" };
  }

  return validatePrimesQuery({
    naics: rawNaics ? rawNaics.split(":")[0]!.trim() : null,
    state: rawState || null,
    page: rawPage ? Number(rawPage) : 1,
    limit: rawLimit ? Number(rawLimit) : PRIMES_DEFAULT_LIMIT,
  });
}

/**
 * Validates a PRIMES QUERY that is already typed: the SAME rules, applied to the
 * values themselves rather than to raw strings.
 *
 * WHY THIS SECOND GATE EXISTS. The HTTP route parses first — but the READ layer must
 * not assume its caller did. Handed an unvalidated query, `readPrimesPayload` bound
 * `NaN` to LIMIT/OFFSET, Postgres raised `invalid input syntax for type bigint:
 * "NaN"`, and the catch-all reported that as "the store is unreachable" — a bad
 * REQUEST blamed on the STORE, whose only fault was being asked an impossible
 * question (QA side finding, 2026-09-25). This function is what the read layer calls
 * BEFORE it builds any SQL, so an invalid query returns the documented 400 body and
 * no statement is ever sent.
 */
export function validatePrimesQuery(query: PrimesQuery): Parsed<PrimesQuery> {
  let naics: string | null = null;
  if (typeof query?.naics === "string" && query.naics.trim()) {
    // The UI sends the code; a full "code: TITLE" value is accepted too and reduced
    // to its code, so a caller cannot accidentally ask for an exact array element
    // that the filter would then silently fail to match.
    const code = query.naics.trim().split(":")[0]!.trim();
    if (!NAICS_CODE.test(code)) {
      return { ok: false, error: "naics must be a 2–6 digit NAICS code" };
    }
    naics = code;
  }

  let state: string | null = null;
  if (typeof query?.state === "string" && query.state.trim()) {
    const value = query.state.trim();
    if (!STATE_VALUE.test(value) || value.length > 40) {
      return { ok: false, error: "state must be a state name as the SBA directory writes it" };
    }
    state = value.toUpperCase();
  }

  const page = query?.page;
  if (!Number.isInteger(page)) return { ok: false, error: "page must be a positive integer" };
  if (page < 1 || page > PRIMES_MAX_PAGE) {
    return { ok: false, error: "page must be between 1 and " + PRIMES_MAX_PAGE };
  }

  const limit = query?.limit;
  if (!Number.isInteger(limit)) return { ok: false, error: "limit must be a positive integer" };
  if (limit < 1 || limit > PRIMES_MAX_LIMIT) {
    return { ok: false, error: "limit must be between 1 and " + PRIMES_MAX_LIMIT };
  }

  return { ok: true, value: { naics, state, page, limit } };
}

export interface PrimesPayload {
  rows: PrimeRowView[];
  /** Rows matching the CURRENT filter — the label above the list. */
  counts: { filtered: number; directoryTotal: number };
  fy: string;
  sourceUrl: string;
  page: number;
  limit: number;
  hasMore: boolean;
  /** Filter options, read from the stored file (capped, with a truncation flag). */
  options: { naics: CountBucket[]; states: CountBucket[]; naicsTruncated: boolean };
  generatedAt: string;
  /**
   * Which directory this payload describes. Always present; `sba` is the default and is
   * what the section that shipped on 2026-09-25 reads.
   */
  source: PrimesSourceId;
  /**
   * The GSA-only block (absent for `sba`, so the SBA response is unchanged). Everything
   * here is either a REAL recorded timestamp or a REAL stored count — never a date claim:
   * this source publishes no posted/closing/deadline field, and the section renders no
   * date of its own.
   */
  gsa?: {
    /** The latest COMPLETED check's finish time (ISO) — what "last checked" prints. */
    lastCheckedAt: string | null;
    /** The source's own file date from its dated URL. Evidence; never rendered as a date. */
    sourceFileDate: string | null;
    /** The source's own file name from the last completed check. Evidence for QA. */
    sourceFile: string | null;
    /** Stored rows whose NAICS cell is not a valid 6-digit code (live count). */
    nonNaicsRows: number;
    /** The pre-rendered honesty line, so it cannot drift per surface. */
    nonNaicsText: string;
  };
}

export type PrimesResponse = PrimesPayload | SubcontractsUnavailable;

/**
 * The documented error body for a PRESENT-but-invalid primes parameter — the shape the
 * HTTP route answers with status 400. It is returned by the READ layer too, so an
 * invalid query can never reach SQL (and so can never be reported as a store failure).
 */
export interface PrimesQueryError {
  ok: false;
  error: string;
}

/** What `/api/subcontracts/primes` can return: a payload, a fail-closed state, or 400. */
export type PrimesReadResponse = PrimesResponse | PrimesQueryError;

/** `true` only for the invalid-query body above (a payload never carries `ok: false`). */
export function isPrimesQueryError(value: unknown): value is PrimesQueryError {
  return (
    typeof value === "object" &&
    value !== null &&
    "ok" in value &&
    (value as { ok?: unknown }).ok === false
  );
}

/** The NAICS option list is capped so a page load cannot ship the whole file. */
export const PRIMES_NAICS_OPTION_CAP = 60;
