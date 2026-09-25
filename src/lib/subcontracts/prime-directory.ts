/**
 * Contrax — SUBCONTRACTING preview: the SBA FY24 PRIME DIRECTORY, row mapping +
 * aggregation (BUILD-PLAN §6.1 S2 / §6.2 `subcontract_primes`).
 *
 * WHAT THE FILE IS. The official annual SBA "Directory of Federal Government Prime
 * Contractors with Subcontracting Plans" — FPDS-derived, ONE ROW PER FY24 AWARD
 * (18,940 rows × 18 columns), named at the AWARD grain. It is a list of companies with a
 * federal subcontracting plan — COMPANIES TO APPROACH, not open opportunities (SBA's own
 * framing), with no contact information of any kind. The operator loads it by hand from
 * the saved evidence file; the file's host path is robots-disallowed, so it is never
 * crawled (BUILD-PLAN §6.1 S2).
 *
 * TWO GRAINS, mapped explicitly. `primeAwardRows` is the file as published (one row per
 * award, values verbatim). `aggregatePrimes` collapses it to ONE ROW PER COMPANY, because
 * that is what the table is for: `UNIQUE (source_id, uei)` in migration 050. Every
 * collapse rule is stated here rather than being implicit:
 *   • identity            = the UEI (trimmed + upper-cased). A company whose UEI repeats
 *                           across awards is ONE row; `award_rows` records how many
 *                           published awards it collapsed. A row with no UEI is NOT
 *                           imported (it cannot be identified) and is counted.
 *   • legal_name          = the exact published spelling that occurs MOST OFTEN among
 *                           that UEI's awards (ties → first in file order). The source
 *                           legitimately spells one company several ways ("… INC" /
 *                           "… INC." / "…, INC."); the column holds one string, so the
 *                           majority spelling is used and the number of UEIs with more
 *                           than one published spelling is REPORTED, never hidden.
 *   • naics               = distinct "code: title" values, sorted (the source publishes
 *                           the code and its description in separate columns).
 *   • agencies            = distinct Contracting Agency Name values, sorted.
 *   • vendor_state        = the most common Vendor Address State (HQ) for that UEI
 *                           (ties → first in file order). The count of UEIs with awards
 *                           in more than one published HQ state is REPORTED.
 *   • pop_states          = distinct Principal Place of Performance State Codes, sorted.
 *                           Kept SEPARATE from vendor_state: "based in" ≠ "works in".
 *   • subcontract_plan_type = the single published plan type, trimmed ("Individual" /
 *                           "Commercial" — the file publishes "Commercial " WITH a
 *                           trailing space); a company with BOTH in FY24 gets an explicit
 *                           "Individual + Commercial" rather than a silent pick.
 *   • value               = the SUM of "Base and All Options Value (Total Contract Value)"
 *                           over that company's FY24 award rows, rounded to 2 decimals.
 *                           UNITS: US dollars as published by FPDS — a total contract
 *                           value ceiling, NOT obligations and NOT money paid.
 *   • latest_pop_start    = the LATEST published Period of Performance Start Date.
 *   • award_rows          = the number of published award rows collapsed into the company.
 *   • fy / source_url     = "FY24" and the canonical SBA directory PAGE (the citable
 *                           link — BUILD-PLAN §6.1 S2 measured that the per-year file URL
 *                           404s on www.sba.gov and is not a page a reader can cite).
 *   • ultimate_parent_*   = the published parent name/UEI when ALL of the company's rows
 *                           agree on it; otherwise NULL (the column holds one value and
 *                           choosing one of several parents would invent a fact). The
 *                           count of such companies is REPORTED.
 *   • industries          = left empty: the brief-name map in migration 050 does not
 *                           include it and the file publishes no such field. An empty
 *                           array is the honest value; nothing is inferred from NAICS.
 *
 * NO NETWORK, NO DATABASE: this module is pure mapping over rows the loader already read.
 */
import { PRIME_DIRECTORY_SOURCE } from "~/lib/subcontracts/connector";
import { excelSerialToIsoDate, type XlsxSheet } from "~/lib/subcontracts/xlsx";

/** The fiscal year this file is (BUILD-PLAN §6.1 S2: FY24 is the current annual file). */
export const FY24 = "FY24";

/**
 * The 18 columns the report publishes, by the EXACT header text in row 1, mapped to the
 * field names this code uses. Header text (not column position) is the contract: a
 * reordered sheet still imports, and a sheet that lost a column fails loudly instead of
 * shifting every value one field to the left.
 */
export const FY24_COLUMNS = {
  "Legal Business Name": "legalName",
  "Unique Entity ID": "uei",
  "Contracting Agency Name": "agency",
  "Contracting Department Name": "department",
  "Contracting Office Name": "office",
  "Procurement Instrument Identifier": "piid",
  "Period of Performance Start Date": "popStartSerial",
  "Completion Date": "completionSerial",
  "Vendor Address State": "vendorState",
  "Vendor Address City": "vendorCity",
  "NAICS Code": "naicsCode",
  "NAICS Description": "naicsTitle",
  "Principal Place of Performance State Code": "popState",
  "Ultimate Parent Legal Business Name": "parentLegalName",
  "Ultimate Parent Unique Entity ID": "parentUei",
  "Subcontract Plan": "planType",
  "Award or Indefinite Delivery Vehicle Type": "awardType",
  "Base and All Options Value (Total Contract Value)": "valueRaw",
} as const;

export type Fy24Field = (typeof FY24_COLUMNS)[keyof typeof FY24_COLUMNS];

/** One published award row, normalized to the source's own values. */
export interface PrimeAwardRow {
  legalName: string;
  uei: string;
  agency: string;
  department: string;
  office: string;
  piid: string;
  /** ISO date (or null when the cell is empty/unreadable). */
  popStart: string | null;
  completionDate: string | null;
  vendorState: string | null;
  vendorCity: string | null;
  naicsCode: string | null;
  naicsTitle: string | null;
  popState: string | null;
  parentLegalName: string | null;
  parentUei: string | null;
  planType: string | null;
  awardType: string | null;
  /** USD as published ("Base and All Options Value"), rounded to cents. */
  value: number | null;
}

export interface PrimeRowAccounting {
  /** Data rows read from the sheet (row 1 is the header). */
  rowsRead: number;
  /** Rows dropped because they publish no UEI — they cannot be identified. */
  rowsWithoutUei: number;
  /** Rows dropped because they publish no legal name. */
  rowsWithoutName: number;
  /** Rows whose UEI does not look like the 12-character UEI the source publishes. */
  rowsWithOddUeiShape: number;
}

export class PrimeDirectoryError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PrimeDirectoryError";
  }
}

const trimmed = (value: string | undefined): string | null => {
  const text = (value ?? "").trim();
  return text === "" ? null : text;
};

/** `"1335075"` / `"8928749.4800000004"` → `1335075` / `8928749.48`. */
export function parseUsd(value: string | null): number | null {
  if (value === null) return null;
  const cleaned = value.replace(/[$,\s]/g, "");
  if (cleaned === "") return null;
  const parsed = Number.parseFloat(cleaned);
  if (!Number.isFinite(parsed)) return null;
  return Math.round(parsed * 100) / 100;
}

/** The UEI as the table's identity: trimmed and upper-cased (never invented, never padded). */
export function normalizeUei(value: string | null): string | null {
  if (value === null) return null;
  const text = value.trim().toUpperCase();
  return text === "" ? null : text;
}

const UEI_SHAPE = /^[A-Z0-9]{12}$/;

/**
 * Maps the workbook rows to award rows. Throws when a required column is missing — a
 * sheet that lost its UEI column must never import as if it had one.
 */
export function primeAwardRows(sheet: XlsxSheet): {
  rows: PrimeAwardRow[];
  accounting: PrimeRowAccounting;
} {
  const byHeader = new Map<string, string>();
  for (const [column, header] of Object.entries(sheet.header)) {
    const text = header.trim();
    if (text !== "") byHeader.set(text, column);
  }
  const missing = Object.keys(FY24_COLUMNS).filter((header) => !byHeader.has(header));
  if (missing.length > 0) {
    throw new PrimeDirectoryError(
      `the workbook is not the FY24 prime directory: missing column(s) ${missing
        .map((m) => JSON.stringify(m))
        .join(", ")} (found: ${[...byHeader.keys()].map((h) => JSON.stringify(h)).join(", ")})`,
    );
  }
  const cell = (row: { byColumn: Record<string, string> }, header: keyof typeof FY24_COLUMNS) =>
    row.byColumn[byHeader.get(header)!];
  const accounting: PrimeRowAccounting = {
    rowsRead: sheet.rows.length,
    rowsWithoutUei: 0,
    rowsWithoutName: 0,
    rowsWithOddUeiShape: 0,
  };
  const rows: PrimeAwardRow[] = [];
  for (const raw of sheet.rows) {
    // A wholly blank trailing row (every mapped cell empty) is not a record.
    const mapped = Object.keys(FY24_COLUMNS).map((header) => trimmed(cell(raw, header as keyof typeof FY24_COLUMNS)));
    if (mapped.every((v) => v === null)) continue;
    const uei = normalizeUei(cell(raw, "Unique Entity ID"));
    const legalName = trimmed(cell(raw, "Legal Business Name"));
    if (uei === null) {
      accounting.rowsWithoutUei += 1;
      continue;
    }
    if (legalName === null) {
      accounting.rowsWithoutName += 1;
      continue;
    }
    if (!UEI_SHAPE.test(uei)) accounting.rowsWithOddUeiShape += 1;
    rows.push({
      legalName,
      uei,
      agency: trimmed(cell(raw, "Contracting Agency Name")) ?? "",
      department: trimmed(cell(raw, "Contracting Department Name")) ?? "",
      office: trimmed(cell(raw, "Contracting Office Name")) ?? "",
      piid: trimmed(cell(raw, "Procurement Instrument Identifier")) ?? "",
      popStart: excelSerialToIsoDate(cell(raw, "Period of Performance Start Date") ?? ""),
      completionDate: excelSerialToIsoDate(cell(raw, "Completion Date") ?? ""),
      vendorState: trimmed(cell(raw, "Vendor Address State")),
      vendorCity: trimmed(cell(raw, "Vendor Address City")),
      naicsCode: trimmed(cell(raw, "NAICS Code")),
      naicsTitle: trimmed(cell(raw, "NAICS Description")),
      popState: trimmed(cell(raw, "Principal Place of Performance State Code")),
      parentLegalName: trimmed(cell(raw, "Ultimate Parent Legal Business Name")),
      parentUei: normalizeUei(cell(raw, "Ultimate Parent Unique Entity ID")),
      planType: trimmed(cell(raw, "Subcontract Plan")),
      awardType: trimmed(cell(raw, "Award or Indefinite Delivery Vehicle Type")),
      value: parseUsd(cell(raw, "Base and All Options Value (Total Contract Value)") ?? null),
    });
  }
  return { rows, accounting };
}

/** One company row, exactly the shape `subcontract_primes` stores. */
export interface PrimeSeedRow {
  uei: string;
  legalName: string;
  ultimateParentName: string | null;
  ultimateParentUei: string | null;
  naics: string[];
  industries: string[];
  vendorState: string | null;
  popStates: string[];
  agencies: string[];
  awardRows: number;
  value: number | null;
  latestPopStart: string | null;
  subcontractPlanType: string | null;
  fy: string;
  sourceUrl: string;
}

export interface PrimeAggregationAccounting {
  awardsRead: number;
  companies: number;
  /** Distinct published legal-name spellings across the file. */
  distinctLegalNames: number;
  /** UEIs whose awards publish more than one spelling (the majority spelling is stored). */
  companiesWithNameVariants: number;
  /** UEIs with awards in more than one published HQ state (the most common is stored). */
  companiesWithMultipleVendorStates: number;
  /** UEIs with no usable HQ state at all. */
  companiesWithoutVendorState: number;
  /** UEIs whose awards disagree about the ultimate parent (both parent columns stored NULL). */
  companiesWithAmbiguousParent: number;
  /** UEIs whose awards publish more than one plan type in FY24. */
  companiesWithMixedPlan: number;
  /** Plan-type split at the COMPANY grain (mixed companies counted separately). */
  planTypeCounts: Record<string, number>;
  awardsWithoutValue: number;
  awardsWithoutPopStart: number;
  /** Distinct published values behind the aggregates — for cross-checking the loader. */
  distinctAgencies: number;
  distinctNaics: number;
  distinctVendorStates: number;
  distinctPopStates: number;
}

/** The value kept for a tied vote: the most frequent, ties broken by first appearance. */
function mostFrequent(values: readonly string[]): string | null {
  const counts = new Map<string, number>();
  for (const value of values) counts.set(value, (counts.get(value) ?? 0) + 1);
  let best: string | null = null;
  let bestCount = 0;
  for (const value of values) {
    const count = counts.get(value)!;
    if (count > bestCount) {
      best = value;
      bestCount = count;
    }
  }
  return best;
}

const distinctSorted = (values: readonly (string | null)[]): string[] => {
  const set = new Set<string>();
  for (const value of values) if (value !== null && value !== "") set.add(value);
  return [...set].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
};

/**
 * Collapses the award grain to one row per company (per UEI). Deterministic: companies are
 * returned sorted by UEI, every list is sorted, and every tie-break is "first in the file".
 */
export function aggregatePrimes(awards: readonly PrimeAwardRow[]): {
  primes: PrimeSeedRow[];
  accounting: PrimeAggregationAccounting;
} {
  const byUei = new Map<string, PrimeAwardRow[]>();
  for (const award of awards) {
    const bucket = byUei.get(award.uei);
    if (bucket) bucket.push(award);
    else byUei.set(award.uei, [award]);
  }
  const primes: PrimeSeedRow[] = [];
  const accounting: PrimeAggregationAccounting = {
    awardsRead: awards.length,
    companies: 0,
    distinctLegalNames: new Set(awards.map((a) => a.legalName)).size,
    companiesWithNameVariants: 0,
    companiesWithMultipleVendorStates: 0,
    companiesWithoutVendorState: 0,
    companiesWithAmbiguousParent: 0,
    companiesWithMixedPlan: 0,
    planTypeCounts: {},
    awardsWithoutValue: awards.filter((a) => a.value === null).length,
    awardsWithoutPopStart: awards.filter((a) => a.popStart === null).length,
    distinctAgencies: distinctSorted(awards.map((a) => a.agency)).length,
    distinctNaics: distinctSorted(awards.map((a) => a.naicsCode)).length,
    distinctVendorStates: distinctSorted(awards.map((a) => a.vendorState)).length,
    distinctPopStates: distinctSorted(awards.map((a) => a.popState)).length,
  };
  const ueis = [...byUei.keys()].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
  for (const uei of ueis) {
    const bucket = byUei.get(uei)!;
    if (new Set(bucket.map((a) => a.legalName)).size > 1) accounting.companiesWithNameVariants += 1;
    const states = bucket.map((a) => a.vendorState).filter((s): s is string => s !== null && s !== "");
    if (states.length === 0) accounting.companiesWithoutVendorState += 1;
    if (new Set(states).size > 1) accounting.companiesWithMultipleVendorStates += 1;
    const parents = distinctSorted(bucket.map((a) => a.parentLegalName));
    const parentUeis = distinctSorted(bucket.map((a) => a.parentUei));
    if (parents.length > 1 || parentUeis.length > 1) accounting.companiesWithAmbiguousParent += 1;
    const plans = distinctSorted(bucket.map((a) => a.planType));
    if (plans.length > 1) accounting.companiesWithMixedPlan += 1;
    const planType = plans.length === 0 ? null : plans.length === 1 ? plans[0]! : "Individual + Commercial";
    accounting.planTypeCounts[planType ?? "(none)"] =
      (accounting.planTypeCounts[planType ?? "(none)"] ?? 0) + 1;
    const values = bucket.map((a) => a.value).filter((v): v is number => v !== null);
    const value = values.length === 0 ? null : Math.round(values.reduce((sum, v) => sum + v, 0) * 100) / 100;
    const popStarts = bucket.map((a) => a.popStart).filter((d): d is string => d !== null);
    const naics = distinctSorted(
      bucket.map((a) => (a.naicsCode === null ? null : `${a.naicsCode}: ${a.naicsTitle ?? ""}`.trimEnd())),
    ).map((entry) => (entry.endsWith(":") ? entry.slice(0, -1) : entry));
    primes.push({
      uei,
      legalName: mostFrequent(bucket.map((a) => a.legalName))!,
      ultimateParentName: parents.length === 1 ? parents[0]! : null,
      ultimateParentUei: parentUeis.length === 1 ? parentUeis[0]! : null,
      naics,
      industries: [],
      vendorState: mostFrequent(states),
      popStates: distinctSorted(bucket.map((a) => a.popState)),
      agencies: distinctSorted(bucket.map((a) => a.agency)),
      awardRows: bucket.length,
      value,
      latestPopStart: popStarts.length === 0 ? null : popStarts.reduce((a, b) => (a > b ? a : b)),
      subcontractPlanType: planType,
      fy: FY24,
      sourceUrl: PRIME_DIRECTORY_SOURCE.officialUrl,
    });
  }
  accounting.companies = primes.length;
  return { primes, accounting };
}
