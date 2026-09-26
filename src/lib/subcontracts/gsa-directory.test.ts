/**
 * Contrax — GSA PRIME DIRECTORY, parser unit tests (bun test).
 *
 * Deterministic, network-free, database-free: every input is the COMMITTED fixture
 * (`fixtures/gsa-directory-slice.csv`, 23 real rows cut from the live 2,072-row file) or a
 * literal. No fetch, no DB, no clock — this suite is what makes the parser's behaviour a
 * claim rather than an assumption.
 *
 * WHAT IS PINNED, in the order the requirements put it:
 *   1. THE INVALID VALUES STAY IDENTIFIABLE. Only /^\d{6}$/ is a NAICS code in this file.
 *      12 of the fixture's rows publish something else; their raw cell is stored VERBATIM in
 *      `naicsRaw` (and therefore in the `naics_raw` column), while every valid-code row has
 *      `naicsRaw === null` — so "how many invalid values are stored" is an exact, queryable
 *      number. Only validated six-digit codes reach `naics[]`, the array the page displays.
 *   2. THE 2 `Non-US` ROWS ARE KEPT VERBATIM and counted (`nonUsRows`); a source value is
 *      never normalised into a US state.
 *   3. The `<br>` addresses become real line breaks and render on one line with ", ".
 *   4. Identity is the UEI: duplicate NAMES are counted and never deduped; duplicate UEIs
 *      are counted and the first row wins.
 *   5. The source's own mojibake and its quoted commas are kept byte-for-byte.
 *   6. `fy` is the literal 'past fiscal year' and `source_file_date` comes ONLY from the
 *      source's own dated URL — never from Last-Modified.
 */
import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import {
  GSA_COLUMNS,
  GSA_DIRECTORY_PAGE_URL,
  GSA_FY_LABEL,
  GSA_NAICS_RE,
  GsaDirectoryError,
  gsaAddressLine,
  gsaContentFingerprint,
  gsaFileDateFromUrl,
  gsaFileNameFromUrl,
  normalizeGsaAddress,
  parseGsaDirectory,
  splitCsvRows,
} from "./gsa-directory";

/** The committed slice of the REAL file (23 rows, CRLF, no trailing newline). */
const FIXTURE_URL = new URL("./fixtures/gsa-directory-slice.csv", import.meta.url);
const FIXTURE_TEXT = readFileSync(FIXTURE_URL, "utf8");
/** The source's own dated URL, exactly as the live redirect presents it. */
const DATED_URL =
  "https://www.gsa.gov/system/files/subcontractor_directory_Jul-9-2025.csv?token=abc";
/** The fixture's header line — used to build synthetic files that keep the real shape. */
const HEADER = FIXTURE_TEXT.split("\r\n")[0]!;

const parsed = parseGsaDirectory(FIXTURE_TEXT, DATED_URL);

describe("gsa directory: the file's own shape is read, not assumed", () => {
  test("the real 23-row slice parses to 23 companies, header excluded", () => {
    expect(splitCsvRows(FIXTURE_TEXT).length).toBe(24);
    expect(parsed.rows.length).toBe(23);
    expect(parsed.accounting.rowsRead).toBe(23);
    expect(parsed.accounting.blankRows).toBe(0);
    // 23 rows carry `<br>` in the address; the fixture has no blank/UEI-less row and no
    // repeated UEI (identity is the UEI).
    expect(parsed.accounting.addressWithBreak).toBe(23);
    expect(parsed.accounting.rowsWithoutUei).toBe(0);
    expect(parsed.accounting.duplicateUeis).toBe(0);
    expect(parsed.accounting.rowsWithoutNaicsCell).toBe(0);
    expect(parsed.accounting.addressWithOtherMarkup).toBe(0);
  });

  test("every row carries the literal 'past fiscal year' and the citable page URL", () => {
    expect(GSA_FY_LABEL).toBe("past fiscal year");
    for (const row of parsed.rows) {
      expect(row.fy).toBe("past fiscal year");
      expect(row.sourceUrl).toBe(GSA_DIRECTORY_PAGE_URL);
      expect(row.sourceFileDate).toBe("2025-07-09");
    }
  });

  test("the six source columns are matched by their exact header text", () => {
    expect(Object.keys(GSA_COLUMNS)).toEqual([
      "Unique Entity ID (UEI)",
      "Vendor name",
      "Vendor physical address",
      "State",
      "NAICS code",
      "Major products or service lines",
    ]);
  });

  test("a reshaped file is REFUSED, never imported as if it had the columns", () => {
    expect(() => parseGsaDirectory("", null)).toThrow(GsaDirectoryError);
    expect(() => parseGsaDirectory("Vendor name,State\nA,B", null)).toThrow(
      /not the GSA contractor directory/,
    );
  });
});

describe("gsa directory: the INVALID NAICS values stay identifiable in the data", () => {
  /** The 12 fixture rows whose NAICS cell is present but is not a six-digit code. */
  const dirty = parsed.rows.filter((row) => row.naicsRaw !== null);
  const clean = parsed.rows.filter((row) => row.naicsRaw === null);

  test("12 rows are counted as non-NAICS and 11 carry a valid code", () => {
    expect(parsed.accounting.nonNaicsCodesDropped).toBe(12);
    expect(dirty.length).toBe(12);
    expect(clean.length).toBe(11);
    // `naicsRaw IS NOT NULL` in the database is EXACTLY this set — the count the run row
    // reports (`nonNaicsDropped`) and the count in the table cannot disagree.
    expect(dirty.length).toBe(parsed.accounting.nonNaicsCodesDropped);
    expect(clean.every((row) => row.naics.length === 1 && GSA_NAICS_RE.test(row.naics[0]!))).toBe(
      true,
    );
  });

  test("the raw cell is stored VERBATIM for every invalid row", () => {
    const raw = Object.fromEntries(dirty.map((row) => [row.uei, row.naicsRaw]));
    expect(raw).toEqual({
      FBMJWJUTP7Z2: "8711", // a 4-digit code
      FDLJFLVDKP66: "4811111", // 7 digits
      GRQ4XLHA37H7: "01", // 2 digits, leading zero
      KW68LJNPMLE7: "201",
      LAB1VT25WJM9: "3261600100", // 10 digits
      LCVVFLQ7Y476: "006", // PSC-looking
      LJXMD6WRZJA5: "33411", // 5 digits
      LUUMAWREV1E4: "132",
      QLERPBSKSEZ7: "2211", // 4 digits
      QT2VZ9L1VPQ1: "0000",
      U1SKMRQVNM38: "1", // 1 digit
      WLP5Z6ENFVY5: "608",
    });
    // Nothing is trimmed, padded or re-cased on the way in.
    for (const row of dirty) expect(row.naicsRaw).toBe(row.naicsRaw!.trim());
  });

  test("a valid code stores NO raw value (and a blank cell stores none either)", () => {
    for (const row of clean) {
      expect(row.naicsRaw).toBeNull();
      expect(row.naics[0]).toMatch(/^\d{6}$/);
    }
    // The raw value of a valid row would be identical to its code, so storing it would add
    // nothing: `naics_raw IS NOT NULL` means "this row's code was invalid", exactly.
    const blank = parseGsaDirectory(
      [HEADER, `AAAAAAAAAAAA,NO NAICS CO,1 MAIN ST,Virginia,,SOMETHING`].join("\r\n"),
      null,
    );
    expect(blank.accounting.rowsWithoutNaicsCell).toBe(1);
    expect(blank.accounting.nonNaicsCodesDropped).toBe(0);
    expect(blank.rows[0]!.naics).toEqual([]);
    expect(blank.rows[0]!.naicsRaw).toBeNull();
  });

  test("the invalid value is NEVER promoted into the displayed NAICS array", () => {
    // `naics[]` is what every surface labels; a bare non-NAICS code in it would be rendered
    // as a trade (the #449 rule). It is empty for all 12 rows instead.
    for (const row of dirty) expect(row.naics).toEqual([]);
    expect(GSA_NAICS_RE.test("8711")).toBe(false);
    expect(GSA_NAICS_RE.test("123456")).toBe(true);
  });

  test("a repeated UEI is counted and the FIRST row is the record", () => {
    const file = [
      HEADER,
      "AAAAAAAAAAAA,FIRST CO,1 MAIN ST,Virginia,541511,ONE",
      "AAAAAAAAAAAA,SECOND CO,2 OTHER ST,Texas,541512,TWO",
      "BBBBBBBBBBBB,THIRD CO,3 THIRD ST,Ohio,541513,THREE",
    ].join("\r\n");
    const result = parseGsaDirectory(file, null);
    expect(result.accounting.duplicateUeis).toBe(1);
    expect(result.rows.map((row) => row.legalName)).toEqual(["FIRST CO", "THIRD CO"]);
  });

  test("a non-ASCII value is kept byte-for-byte, never 'cleaned'", () => {
    // The live file carries one double-encoded sequence; the fixture keeps it. Encoding it
    // away would be a silent edit of the source's own words.
    const mojibake = parsed.rows.find((row) => row.uei === "HKJMJP8F7MU1")!;
    expect(mojibake.productsServices).toBe(
      "INDUSTRIAL PRODUCTS AND SERVICES \u00c2\u0080\u0093 INDUSTRIAL PRODUCTS",
    );
    // The exact double-encoded sequence, character by character: U+00C2, U+0080, U+0093.
    const codes = [...mojibake.productsServices!].map((c) => c.charCodeAt(0));
    expect(codes.slice(codes.indexOf(194), codes.indexOf(194) + 3)).toEqual([194, 128, 147]);
  });
});

describe("gsa directory: the 2 Non-US rows are verbatim, counted, and never a state", () => {
  test("exactly two rows publish Non-US, and the source's words are kept", () => {
    expect(parsed.accounting.nonUsRows).toBe(2);
    const nonUs = parsed.rows.filter((row) => row.vendorState === "Non-US");
    expect(nonUs.map((row) => row.uei)).toEqual(["CXXAWKEG1JB4", "JKGUNVNCCQJ7"]);
    // The address carries the same words; nothing is mapped to a US state or a 2-letter code.
    expect(nonUs[0]!.vendorAddress).toContain("NON-US 15-540");
  });

  test("states are stored verbatim, including territories and D.C.", () => {
    const states = [...new Set(parsed.rows.map((row) => row.vendorState))].sort();
    expect(states).toEqual([
      "Connecticut",
      "District of Columbia",
      "Georgia",
      "Maryland",
      "Michigan",
      "Minnesota",
      "New York",
      "Non-US",
      "Pennsylvania",
      "Puerto Rico",
      "Texas",
      "Virginia",
      "Washington",
      "West Virginia",
    ]);
    expect(parsed.accounting.distinctStates).toBe(14);
  });
});

describe("gsa directory: duplicate NAMES are real rows, and identity is the UEI", () => {
  test("two names repeat; both rows are kept and the repeats are counted", () => {
    expect(parsed.accounting.repeatedVendorNames).toBe(2);
    const att = parsed.rows.filter((row) => row.legalName === "AT&T CORP.");
    expect(att.map((row) => row.uei)).toEqual(["MNALR8D818N7", "QJ86FJL3NBT1"]);
    const cbre = parsed.rows.filter((row) => row.legalName === "CBRE HEERY, INC.");
    expect(cbre.length).toBe(2);
    // Deduping by name would delete two real companies; the UEI is what makes them distinct.
    expect(new Set(parsed.rows.map((row) => row.uei)).size).toBe(parsed.rows.length);
  });

  test("a quoted comma inside a name survives the CSV split", () => {
    expect(parsed.rows.find((row) => row.uei === "U9PKUDH7SPX6")!.legalName).toBe("11400, INC.");
    expect(splitCsvRows('a,b\n"11400, INC.",2')[1]).toEqual(["11400, INC.", "2"]);
  });
});

describe("gsa directory: the address is the source's own, with its own line breaks", () => {
  test("<br> becomes a line break; a card renders one line joined with ', '", () => {
    const row = parsed.rows.find((r) => r.uei === "CXXAWKEG1JB4")!;
    expect(row.vendorAddress).toBe("ZURAWIA, NO.71\nBIALYSTOK, NON-US 15-540");
    expect(gsaAddressLine(row.vendorAddress)).toBe("ZURAWIA, NO.71, BIALYSTOK, NON-US 15-540");
    // Idempotent: re-rendering an already-joined line cannot double the commas.
    expect(gsaAddressLine(gsaAddressLine(row.vendorAddress))).toBe(
      "ZURAWIA, NO.71, BIALYSTOK, NON-US 15-540",
    );
  });

  test("<BR /> spellings all break, and other markup is removed, never injected", () => {
    expect(normalizeGsaAddress("A<br>B").text).toBe("A\nB");
    expect(normalizeGsaAddress("A<BR />B").text).toBe("A\nB");
    expect(normalizeGsaAddress("A<br/>B").text).toBe("A\nB");
    const withMarkup = normalizeGsaAddress("A<br><b>B</b> <i>C</i>");
    expect(withMarkup.text).toBe("A\nB C");
    expect(withMarkup.hadOtherMarkup).toBe(true);
    expect(withMarkup.hadBreak).toBe(true);
  });

  test("an empty address is null, not an empty string", () => {
    expect(normalizeGsaAddress("").text).toBe("");
    expect(gsaAddressLine("")).toBeNull();
    expect(gsaAddressLine(null)).toBeNull();
    expect(gsaAddressLine("  ")).toBeNull();
  });
});

describe("gsa directory: the file date comes from the source's own URL, never elsewhere", () => {
  test("a dated file name yields its own date", () => {
    expect(gsaFileDateFromUrl(DATED_URL)).toBe("2025-07-09");
    expect(gsaFileDateFromUrl("https://www.gsa.gov/x/subcontractor_directory_Jan-2-2026.csv")).toBe(
      "2026-01-02",
    );
    // A URL this pattern does not match yields NULL — the connector never falls back to the
    // CDN's Last-Modified (the live file name says Jul-9-2025 while the header said a later
    // date; only the name is the source's own statement).
    expect(gsaFileDateFromUrl("https://www.gsa.gov/media/170283")).toBeNull();
    expect(gsaFileDateFromUrl("https://www.gsa.gov/x/subcontractor_directory.csv")).toBeNull();
    expect(gsaFileDateFromUrl(null)).toBeNull();
    expect(gsaFileDateFromUrl("https://www.gsa.gov/x/report_Foo-9-2025.csv")).toBeNull();
  });

  test("the file name is evidence for the run log", () => {
    expect(gsaFileNameFromUrl(DATED_URL)).toBe("subcontractor_directory_Jul-9-2025.csv");
    expect(gsaFileNameFromUrl("https://www.gsa.gov/media/170283")).toBeNull();
    // A dated URL is required for a date: no URL, no date.
    expect(parseGsaDirectory(FIXTURE_TEXT, null).rows[0]!.sourceFileDate).toBeNull();
  });

  test("the content fingerprint ignores row order and notices a raw-code change", () => {
    const base = parseGsaDirectory(FIXTURE_TEXT, DATED_URL).rows;
    expect(gsaContentFingerprint([...base].reverse())).toBe(gsaContentFingerprint(base));
    const edited = base.map((row) =>
      row.uei === "FBMJWJUTP7Z2" ? { ...row, naicsRaw: "8712" } : row,
    );
    expect(gsaContentFingerprint(edited)).not.toBe(gsaContentFingerprint(base));
  });
});
