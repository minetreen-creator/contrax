/**
 * PRIME-DIRECTORY SEED — the deterministic unit suites (owner directive 2026-09-25, step 2a).
 *
 * ZERO network, ZERO database. The workbook is the committed 33-row SLICE of the real FY24
 * SBA directory (`fixtures/fy24-directory-slice.xlsx`): seven companies cut out of the
 * genuine file with the genuine shared-string/numeric cell shape, spanning Individual and
 * Commercial plans, one company with BOTH in FY24, a company whose published name has two
 * spellings, two UEIs that publish the SAME legal name, a company with awards in two HQ
 * states, multi-NAICS and multi-agency companies, and a one-row company.
 *
 * The expectations below were computed independently of this code (a separate reader over
 * the same bytes) and cross-check the stored values field by field — including the
 * majority-vote spelling, the value sums (the file publishes floats like
 * `8928749.4800000004`, so cents-rounding is part of the contract) and the date conversion.
 *
 * Listed in .github/workflows/build-check.yml's "Subcontracting preview data layer tests"
 * step by DIRECTORY (`bun test src/lib/subcontracts`), which is why this file lives here.
 */
import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { PRIME_DIRECTORY_SOURCE } from "~/lib/subcontracts/connector";
import {
  FY24,
  PrimeDirectoryError,
  aggregatePrimes,
  normalizeUei,
  parseUsd,
  primeAwardRows,
  type PrimeAwardRow,
} from "~/lib/subcontracts/prime-directory";
import { PrimeSeedError, seedSubcontractPrimes } from "~/lib/subcontracts/prime-seed.server";
import { XlsxReadError, excelSerialToIsoDate, readXlsxSheet, type XlsxSheet } from "~/lib/subcontracts/xlsx";

const SLICE = "src/lib/subcontracts/fixtures/fy24-directory-slice.xlsx";
const sliceBytes = new Uint8Array(readFileSync(new URL(`./fixtures/fy24-directory-slice.xlsx`, import.meta.url)));
const sheet = readXlsxSheet(sliceBytes);

/** The column letter a header text sits in — the mapping is by header TEXT, not position. */
const columnOf = (header: string): string => {
  const found = Object.entries(sheet.header).find(([, text]) => text.trim() === header);
  if (!found) throw new Error(`the slice has no ${header} column`);
  return found[0];
};

describe("XLSX reader (no dependency)", () => {
  test("reads the committed FY24 slice: 18 columns, 33 data rows, real cell types", () => {
    expect(Object.keys(sheet.header)).toHaveLength(18);
    expect(sheet.header[columnOf("Legal Business Name")]).toBe("Legal Business Name");
    expect(sheet.header[columnOf("Base and All Options Value (Total Contract Value)")]).toBe(
      "Base and All Options Value (Total Contract Value)",
    );
    expect(sheet.rows).toHaveLength(33);
    // The slice was cut out of the 18,940-row file, so row NUMBERS are not contiguous (this
    // one starts at 3): the reader must read the sheet's own numbering, not an offset.
    expect(sheet.rows[0]!.rowNumber).toBe(3);
    for (let i = 1; i < sheet.rows.length; i += 1) {
      expect(sheet.rows[i]!.rowNumber).toBeGreaterThan(sheet.rows[i - 1]!.rowNumber);
    }
    const first = sheet.rows[0]!;
    // Shared strings are resolved to text; the numeric columns stay numeric literals.
    expect(first.byColumn[columnOf("Unique Entity ID")]).toBe("QT2VZ9L1VPQ1");
    expect(first.byColumn[columnOf("Period of Performance Start Date")]).toBe("44805");
    expect(first.byColumn[columnOf("Base and All Options Value (Total Contract Value)")]).toBe(
      "8928749.4800000004",
    );
    // The published plan value carries a trailing space — verbatim in the cell, trimmed later.
    expect(first.byColumn[columnOf("Subcontract Plan")]).toBe("Commercial ");
  });

  test("Excel serial days convert to the published calendar date", () => {
    expect(excelSerialToIsoDate("45566")).toBe("2024-10-01");
    expect(excelSerialToIsoDate(36526)).toBe("2000-01-01");
    expect(excelSerialToIsoDate("44805")).toBe("2022-09-01");
    expect(excelSerialToIsoDate("")).toBeNull();
    expect(excelSerialToIsoDate("not a date")).toBeNull();
  });

  test("a non-workbook buffer fails loudly (never an empty import)", () => {
    expect(() => readXlsxSheet(new Uint8Array([1, 2, 3, 4]))).toThrow(XlsxReadError);
    expect(() => readXlsxSheet(sliceBytes, "xl/worksheets/sheet9.xml")).toThrow(XlsxReadError);
  });
});

describe("FY24 award-row mapping", () => {
  const { rows, accounting } = primeAwardRows(sheet);

  test("maps every published column of a real row, in the source's own values", () => {
    const row = rows.find((r) => r.uei === "QT2VZ9L1VPQ1" && r.piid === "15F06722F0001095")!;
    expect(row).toBeDefined();
    expect(row.legalName).toBe("22ND CENTURY TECHNOLOGIES INC");
    expect(row.agency).toBe("FEDERAL BUREAU OF INVESTIGATION");
    expect(row.department).toBe("JUSTICE, DEPARTMENT OF");
    expect(row.office).toBe("DIVISION 1200");
    expect(row.popStart).toBe("2022-09-01");
    expect(row.completionDate).toBe("2028-02-29");
    expect(row.vendorState).toBe("VIRGINIA");
    expect(row.vendorCity).toBe("MC LEAN");
    expect(row.naicsCode).toBe("541330");
    expect(row.naicsTitle).toBe("ENGINEERING SERVICES");
    expect(row.popState).toBe("DC");
    expect(row.parentLegalName).toBe("22ND CENTURY TECHNOLOGIES INC.");
    expect(row.parentUei).toBe("SQ8PX16HA5J4");
    expect(row.planType).toBe("Commercial");
    expect(row.awardType).toBe("DELIVERY ORDER");
    // USD as published, cents-rounded (the file publishes floats with artifacts).
    expect(row.value).toBe(8928749.48);
  });

  test("reads all 33 rows with nothing skipped, and trims the published plan value", () => {
    expect(rows).toHaveLength(33);
    expect(accounting).toEqual({
      rowsRead: 33,
      rowsWithoutUei: 0,
      rowsWithoutName: 0,
      rowsWithOddUeiShape: 0,
    });
    expect(new Set(rows.map((r) => r.planType))).toEqual(new Set(["Individual", "Commercial"]));
    expect(rows.every((r) => r.uei === normalizeUei(r.uei))).toBe(true);
  });

  test("values and UEIs normalize honestly (no padding, no invented digits)", () => {
    expect(parseUsd("8928749.4800000004")).toBe(8928749.48);
    expect(parseUsd("$1,335,075")).toBe(1335075);
    expect(parseUsd("")).toBeNull();
    expect(parseUsd(null)).toBeNull();
    expect(parseUsd("n/a")).toBeNull();
    expect(normalizeUei(" qt2vz9l1vpq1 ")).toBe("QT2VZ9L1VPQ1");
    expect(normalizeUei("  ")).toBeNull();
    expect(normalizeUei(null)).toBeNull();
  });

  test("a workbook that lost a column throws — it never shifts fields left", () => {
    const withoutUei: XlsxSheet = {
      ...sheet,
      header: Object.fromEntries(
        Object.entries(sheet.header).filter(([, text]) => text.trim() !== "Unique Entity ID"),
      ),
    };
    expect(() => primeAwardRows(withoutUei)).toThrow(PrimeDirectoryError);
    expect(() => primeAwardRows(withoutUei)).toThrow(/Unique Entity ID/);
  });
});

describe("company aggregation (award grain → one row per UEI)", () => {
  const { rows } = primeAwardRows(sheet);
  const { primes, accounting } = aggregatePrimes(rows);
  const byUei = new Map(primes.map((p) => [p.uei, p]));

  test("18,940-shaped collapse: one company per UEI, awards counted, lists collapsed", () => {
    expect(primes).toHaveLength(7);
    expect(new Set(primes.map((p) => p.uei)).size).toBe(7);
    expect(primes.reduce((sum, p) => sum + p.awardRows, 0)).toBe(33);
    expect(primes.map((p) => p.uei)).toEqual([...primes.map((p) => p.uei)].sort());
    expect(accounting).toMatchObject({
      awardsRead: 33,
      companies: 7,
      distinctLegalNames: 11,
      companiesWithNameVariants: 4,
      companiesWithMultipleVendorStates: 1,
      companiesWithoutVendorState: 0,
      companiesWithAmbiguousParent: 3,
      companiesWithMixedPlan: 1,
      awardsWithoutValue: 0,
      awardsWithoutPopStart: 0,
      distinctNaics: 13,
      distinctAgencies: 11,
      distinctVendorStates: 7,
      distinctPopStates: 13,
    });
    expect(accounting.planTypeCounts).toEqual({
      Individual: 4,
      Commercial: 2,
      "Individual + Commercial": 1,
    });
  });

  test("multi-agency + multi-NAICS collapse into sorted distinct lists", () => {
    const abt = byUei.get("C9S1NLQ67626")!;
    expect(abt.awardRows).toBe(6);
    expect(abt.naics).toEqual([
      "541330: ENGINEERING SERVICES",
      "541620: ENVIRONMENTAL CONSULTING SERVICES",
      "541720: RESEARCH AND DEVELOPMENT IN THE SOCIAL SCIENCES AND HUMANITIES",
      "541990: ALL OTHER PROFESSIONAL, SCIENTIFIC, AND TECHNICAL SERVICES",
    ]);
    expect(abt.agencies).toEqual([
      "AGENCY FOR INTERNATIONAL DEVELOPMENT",
      "CENTERS FOR DISEASE CONTROL AND PREVENTION",
      "EDUCATION, DEPARTMENT OF",
      "ENVIRONMENTAL PROTECTION AGENCY",
      "SUBSTANCE ABUSE AND MENTAL HEALTH SERVICES ADMINISTRATION",
    ]);
    expect(abt.popStates).toEqual(["DC", "GA", "MD"]);
    expect(abt.vendorState).toBe("MARYLAND");
    expect(abt.value).toBe(55192816.65);
    expect(abt.latestPopStart).toBe("2024-09-30");
  });

  test("the UEI is the identity: the same published NAME stays two companies", () => {
    // "ABT ASSOCIATES INC." is published for two different UEIs in FY24 — merging them by
    // name would merge two real companies, which is why identity is the UEI.
    const abtOne = byUei.get("C9S1NLQ67626")!;
    const abtTwo = byUei.get("X1ZXL81Y8E18")!;
    expect(abtOne).toBeDefined();
    expect(abtTwo).toBeDefined();
    expect(abtTwo.legalName).toBe("ABT ASSOCIATES INC.");
    expect(abtTwo.vendorState).toBe("MASSACHUSETTS");
    expect(abtTwo.popStates).toEqual(["MA", "MD"]);
    expect(abtTwo.value).toBe(39342162.4);
    // …while a UEI published under several spellings collapses to ONE company.
    expect(primes.filter((p) => p.legalName === "22ND CENTURY TECHNOLOGIES INC")).toHaveLength(1);
  });

  test("the majority published spelling is stored, and the ambiguity is accounted", () => {
    // Three spellings occur for C9S1NLQ67626; the most frequent one is stored.
    const abt = byUei.get("C9S1NLQ67626")!;
    expect(abt.legalName).toBe("ABT ASSOCIATES INC.");
    const variants = new Set(
      rows.filter((r) => r.uei === "C9S1NLQ67626").map((r) => r.legalName),
    );
    expect(variants.size).toBe(3);
    expect(accounting.companiesWithNameVariants).toBe(4);
    // The parent columns hold one value, so a company whose awards disagree stores NULL
    // (the count is reported) — never one of the candidates picked silently.
    expect(abt.ultimateParentName).toBeNull();
    expect(abt.ultimateParentUei).toBeNull();
    expect(byUei.get("P4LGE35HG4B5")!.ultimateParentName).toBe("381 CONSTRUCTORS");
    expect(byUei.get("P4LGE35HG4B5")!.ultimateParentUei).toBe("P4LGE35HG4B5");
  });

  test("mixed plan types and multiple HQ states are resolved explicitly, not silently", () => {
    const mixed = byUei.get("QT2VZ9L1VPQ1")!;
    expect(mixed.subcontractPlanType).toBe("Individual + Commercial");
    expect(mixed.awardRows).toBe(6);
    expect(mixed.value).toBe(55466967.8);
    expect(mixed.vendorState).toBe("VIRGINIA");
    expect(mixed.popStates).toEqual(["DC", "VA"]);
    expect(mixed.naics).toEqual([
      "541330: ENGINEERING SERVICES",
      "541512: COMPUTER SYSTEMS DESIGN SERVICES",
    ]);
    // Two published HQ states: the most common one is stored, and counted.
    const twoStates = byUei.get("WD8KKTRJWAZ3")!;
    expect(twoStates.vendorState).toBe("MARYLAND");
    expect(new Set(rows.filter((r) => r.uei === "WD8KKTRJWAZ3").map((r) => r.vendorState))).toEqual(
      new Set(["DISTRICT OF COLUMBIA", "MARYLAND"]),
    );
    expect(twoStates.subcontractPlanType).toBe("Commercial");
  });

  test("every row carries FY24, the citable SBA page, and no invented industries", () => {
    for (const prime of primes) {
      expect(prime.fy).toBe(FY24);
      expect(prime.sourceUrl).toBe(PRIME_DIRECTORY_SOURCE.officialUrl);
      expect(prime.industries).toEqual([]);
    }
    expect(FY24).toBe("FY24");
  });
});

describe("the loader is fail-closed on its input", () => {
  test("a missing --file path is reported, and NOTHING is written", async () => {
    const missing = "/tmp/contrax-fy24-does-not-exist.xlsx";
    const call = seedSubcontractPrimes({ file: missing });
    await expect(call).rejects.toThrow(PrimeSeedError);
    await expect(seedSubcontractPrimes({ file: missing })).rejects.toThrow(
      /cannot read the FY24 SBA prime-directory workbook at \/tmp\/contrax-fy24-does-not-exist\.xlsx/,
    );
  });

  test("no workbook at all refuses to run (never an empty import)", async () => {
    await expect(seedSubcontractPrimes({})).rejects.toThrow(/no workbook given/);
    await expect(seedSubcontractPrimes({ dryRun: true })).rejects.toThrow(PrimeSeedError);
  });

  test("a dry run maps and accounts for the real slice without touching a database", async () => {
    // No DATABASE_URL is needed: a dry run resolves no source row and issues no statement.
    const result = await seedSubcontractPrimes({ bytes: sliceBytes, file: SLICE, dryRun: true });
    expect(result.dryRun).toBe(true);
    expect(result.sourceId).toBeNull();
    expect(result.companies).toBe(7);
    expect(result.awards).toBe(33);
    expect(result.inserted).toBe(0);
    expect(result.updated).toBe(0);
    expect(result.touched).toBe(0);
    expect(result.storedPlanTypes).toBeNull();
    expect(result.sourceKey).toBe(PRIME_DIRECTORY_SOURCE.sourceKey);
    expect(result.fy).toBe("FY24");
    expect(result.aggregation.companies).toBe(7);
  });

  test("an empty aggregation is accounted for rather than assumed", () => {
    const empty: PrimeAwardRow[] = [];
    const { primes, accounting } = aggregatePrimes(empty);
    expect(primes).toEqual([]);
    expect(accounting).toMatchObject({
      awardsRead: 0,
      companies: 0,
      distinctLegalNames: 0,
      companiesWithNameVariants: 0,
      awardsWithoutValue: 0,
      planTypeCounts: {},
    });
  });
});
