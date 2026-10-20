/**
 * The SAM set-aside CODE → stored LABEL contract, pinned to measured evidence.
 *
 * WHY THIS SUITE EXISTS: `normalizeSetAside` used to resolve the SAM code "SBA"
 * to "8(a)". "SBA" is SAM's **Total Small Business** set-aside; only "8A" is the
 * 8(a) Business Development set-aside (and "8AN" its sole-source variant). The
 * mislabel reached 4,134 production `bids` rows (relabelled by migration 065) and
 * told 8(a) certificants they were eligible for set-asides they are not.
 *
 * EVIDENCE (measured 2026-10-19, both keyless and reproducible):
 *
 *   1. the nightly SAM extract
 *      https://s3.amazonaws.com/falextracts/Contract%20Opportunities/datagov/ContractOpportunitiesFullCSV.csv
 *      — 2026-10-18 03:30Z copy, 69,674 data rows, 28,957 carrying a set-aside.
 *      Every SetASideCode → SetASide pair in that file is listed below with its
 *      row count, and every one of them is asserted here.
 *   2. SAM's own notice-detail API for all 4,234 stored `set_aside = '8(a)'`
 *      rows (Accept: application/hal+json) — 4,126 returned "SBA", 63 "8A",
 *      10 "8AN", 15 "NONE", 9 published none, 3 other single rows, 7 had aged out
 *      (404). That split is what migration 065's exception list encodes.
 *
 * ZERO NETWORK: everything here is a pure-function assertion over those byte
 * patterns. The live extract is never fetched by a test (owner guardrail).
 */
import { describe, expect, test } from "bun:test";
import {
  EIGHT_A_SOLE_SOURCE_LABEL,
  TOTAL_SMALL_BUSINESS_LABEL,
  extractSetAsideFromItem,
  normalizeSetAside,
} from "~/jobs/sources/sam-gov";

/**
 * Every distinct (SetASideCode, SetASide) pair in the 2026-10-18 extract, with
 * its row count. The code is the first column of the pair table printed by the
 * evidence harness; the count is not asserted (it is evidence, not a fixture) but
 * the CODE SET is — a new SAM code must be handled deliberately, not silently
 * passed through as a verbatim label nobody reviewed.
 */
const EXTRACT_PAIRS: ReadonlyArray<readonly [string, string, number]> = [
  ["SBA", "Small Business Set Aside - Total", 17702],
  ["NONE", "No Set aside used", 5286],
  ["SDVOSBC", "Service-Disabled Veteran-Owned Small Business (SDVOSB) Set-Aside (FAR 19.14)", 3075],
  ["WOSB", "SBA Certified Women-Owned Small Business (WOSB) Program Set-Aside (FAR 19.15)", 812],
  ["8A", "8(a) Set-Aside (FAR 19.8)", 755],
  ["HZC", "Historically Underutilized Business (HUBZone) Set-Aside (FAR 19.13)", 551],
  ['["SBA"]', "", 184],
  ["SBP", "Small Business Set Aside - Partial", 141],
  ["SDVOSBS", "Service-Disabled Veteran-Owned Small Business (SDVOSB) Sole Source (FAR 19.14)", 95],
  ["8AN", "8(a) Sole Source (FAR 19.8)", 81],
  ["EDWOSB", "Economically Disadvantaged Women-Owned Small Business", 75],
  ["ISBEE", "Indian Small Business Economic Enterprise", 61],
  ["VSA", "Veteran-Owned Small Business Set-Aside (specific to Department of Veterans Affairs)", 45],
  ["WOSBSS", "SBA Certified Women-Owned Small Business (WOSB) Program Sole Source (FAR 19.15)", 27],
  ["HZS", "Historically Underutilized Business (HUBZone) Sole Source (FAR 19.13)", 27],
  ["IEE", "Indian Economic Enterprise", 12],
  ['[""]', "", 12],
  ["BICiv", "Buy Indian Set-Aside (specific to Department of Health and Human Services, Indian Health Services)", 8],
  ["LAS", "Local Area Set-Aside (FAR 26.2)", 6],
  ["EDWOSBSS", "Economically Disadvantaged Women-Owned Small Business Sole Source", 1],
  ["ESB", "Emerging Small Business Set Aside", 1],
];

describe("normalizeSetAside — the SBA / 8A / 8AN distinction the mislabel turned on", () => {
  test("SBA is TOTAL SMALL BUSINESS, never 8(a)", () => {
    expect(normalizeSetAside("SBA")).toBe(TOTAL_SMALL_BUSINESS_LABEL);
    expect(normalizeSetAside("sba")).toBe(TOTAL_SMALL_BUSINESS_LABEL);
    expect(normalizeSetAside(" SBA ")).toBe(TOTAL_SMALL_BUSINESS_LABEL);
    // The whole point: no spelling of the total-small-business code may ever
    // reach the 8(a) label again.
    for (const raw of ["SBA", "sba", "Sba", '["SBA"]']) {
      expect(normalizeSetAside(raw)).not.toBe("8(a)");
    }
  });

  test("8A is 8(a) and 8AN is the sole-source code", () => {
    expect(normalizeSetAside("8A")).toBe("8(a)");
    expect(normalizeSetAside("8a")).toBe("8(a)");
    expect(normalizeSetAside("8(a)")).toBe("8(a)");
    expect(normalizeSetAside("8AN")).toBe(EIGHT_A_SOLE_SOURCE_LABEL);
    expect(normalizeSetAside("8an")).toBe(EIGHT_A_SOLE_SOURCE_LABEL);
  });

  test("the stored label is the SAME string the CSV ingest writes for code SBA", () => {
    // sam-csv.ts#csvSetAsideLabel falls through to the extract's own label for
    // code "SBA" ("Small Business Set Aside - Total"); the 4-hourly sync must not
    // spell it differently, or one notice would flip labels between the two jobs.
    expect(TOTAL_SMALL_BUSINESS_LABEL).toBe("Small Business Set Aside - Total");
    expect(normalizeSetAside("SBA")).toBe(normalizeSetAside("Small Business Set Aside - Total"));
  });

  test('the one-element JSON array form unwraps (184 extract rows carry `["SBA"]`)', () => {
    expect(normalizeSetAside('["SBA"]')).toBe(TOTAL_SMALL_BUSINESS_LABEL);
    expect(normalizeSetAside('["SDVOSBC"]')).toBe("SDVOSB");
    // `[""]` (12 extract rows) carries no code at all → no set-aside, not a label.
    expect(normalizeSetAside('[""]')).toBeNull();
    // A plain bracketed-but-unquoted value is NOT the array form and stays verbatim.
    expect(normalizeSetAside("[SBA]")).toBe("[SBA]");
  });

  test("'none' spellings are no set-aside, not a label", () => {
    for (const raw of ["NONE", "none", "No Set aside used", "no set-aside", "n/a", "", "   "]) {
      expect(normalizeSetAside(raw)).toBeNull();
    }
    expect(normalizeSetAside(null)).toBeNull();
    expect(normalizeSetAside(undefined)).toBeNull();
  });
});

describe("every set-aside code in the nightly extract resolves deliberately", () => {
  /**
   * The label each extract code resolves to (measured 2026-10-19). Two families
   * are deliberately PASS-THROUGH — the function returns SAM's own code verbatim,
   * which is the corpus convention the 4-hourly sync already stores:
   *
   *   * codes with no registry entry: ISBEE, IEE, VSA, LAS, BICiv, HZS, SBP,
   *     ESB (791 production rows carry these spellings today);
   *   * the certification SOLE-SOURCE variants WOSBSS / EDWOSBSS, which collapse
   *     onto their base certification ("WOSB") because the phrase rules match the
   *     "wosb" inside them. The certification is the same and both `open-bids`
   *     and `cert-matching` match the same "wosb" family, so nothing changes for
   *     a user — pinned here so a future edit is a conscious one. (The EDWOSBSS
   *     row is the one lossy case, 1 extract row; flagged in the PR, NOT changed
   *     here: this PR fixes the 8(a) mislabel and nothing else about matching.)
   */
  const CODE_EXPECTATIONS: Record<string, string | null> = {
    SBA: TOTAL_SMALL_BUSINESS_LABEL,
    NONE: null,
    SDVOSBC: "SDVOSB",
    WOSB: "WOSB",
    "8A": "8(a)",
    HZC: "HUBZone",
    '["SBA"]': TOTAL_SMALL_BUSINESS_LABEL,
    SBP: "SBP",
    SDVOSBS: "SDVOSB",
    "8AN": EIGHT_A_SOLE_SOURCE_LABEL,
    EDWOSB: "EDWOSB",
    ISBEE: "ISBEE",
    VSA: "VSA",
    WOSBSS: "WOSB",
    HZS: "HZS",
    IEE: "IEE",
    '[""]': null,
    BICiv: "BICiv",
    LAS: "LAS",
    EDWOSBSS: "WOSB",
    ESB: "ESB",
  };

  test("the fixture covers exactly the codes the extract carries", () => {
    expect(new Set(EXTRACT_PAIRS.map(([code]) => code))).toEqual(new Set(Object.keys(CODE_EXPECTATIONS)));
    expect(EXTRACT_PAIRS.length).toBe(21);
  });

  for (const [code] of EXTRACT_PAIRS) {
    const want = CODE_EXPECTATIONS[code]!;
    test(`code ${code} → ${want === null ? "(no set-aside)" : want}`, () => {
      // SAM sends these codes in exactly this casing (BICiv, ISBEE, …) — a
      // pass-through label is that spelling, so the assertion is exact.
      expect(normalizeSetAside(code)).toBe(want);
    });
  }

  test("the long human labels in the same rows resolve to the same designations", () => {
    const LABEL_EXPECTATIONS: Record<string, string | null> = {
      "Small Business Set Aside - Total": TOTAL_SMALL_BUSINESS_LABEL,
      "No Set aside used": null,
      "Service-Disabled Veteran-Owned Small Business (SDVOSB) Set-Aside (FAR 19.14)": "SDVOSB",
      "SBA Certified Women-Owned Small Business (WOSB) Program Set-Aside (FAR 19.15)": "WOSB",
      "8(a) Set-Aside (FAR 19.8)": "8(a)",
      "Historically Underutilized Business (HUBZone) Set-Aside (FAR 19.13)": "HUBZone",
      "8(a) Sole Source (FAR 19.8)": "8(a)",
      "Economically Disadvantaged Women-Owned Small Business": "EDWOSB",
    };
    for (const [label, want] of Object.entries(LABEL_EXPECTATIONS)) {
      expect(normalizeSetAside(label)).toBe(want);
    }
    // The `{code, value}` object SAM publishes is unwrapped by the ingest's own
    // extractor before normalization — both halves pinned end to end here.
    expect(extractSetAsideFromItem({ data2: { solicitation: { setAside: "SBA" } } }, "")).toBe(
      TOTAL_SMALL_BUSINESS_LABEL,
    );
    expect(extractSetAsideFromItem({ setAside: { code: "8a", value: "SBA Certified 8(a) Program" } }, "")).toBe(
      "8(a)",
    );
    expect(extractSetAsideFromItem({ data2: { solicitation: { setAside: "8AN" } } }, "")).toBe(
      EIGHT_A_SOLE_SOURCE_LABEL,
    );
  });
});
