/**
 * Contrax — GSA PRIME DIRECTORY, read surface: pure unit tests (bun test).
 *
 * Deterministic, network-free, DATABASE-FREE: everything here is a pure function over a
 * stored row, a URLSearchParams, or — for the two structural pins — the module's own source
 * text. `~/db` is mocked to a stub that RECORDS every statement, so a test that reaches SQL
 * fails instead of touching whatever DATABASE_URL this sandbox has.
 *
 * WHAT IS PINNED, in order of how much damage getting it wrong would do:
 *   1. THE OWNER-VERBATIM HEADING, byte for byte (middot separators, no year).
 *   2. `?source=` SELECTS THE DIRECTORY: absent/blank ⇒ sba (the shipped behaviour), `gsa`
 *      ⇒ the second directory, anything else ⇒ an error — never a silent coerce.
 *   3. THE SBA RESPONSE IS UNCHANGED: the SBA statement names no migration-051 column, an
 *      SBA row's view gains no new key, and the SBA copy is still the exact shipped text.
 *   4. Only a VALIDATED six-digit code is ever labelled as a trade; an invalid raw value is
 *      carried as evidence and never rendered.
 *   5. `Non-US` is labelled as the SOURCE's wording, never as a state.
 *   6. The honesty sentence for the non-NAICS rows is built from the live count.
 *   7. An invalid query/source answers 400 BEFORE the store is touched.
 */
import { describe, expect, mock, test } from "bun:test";
import { readFileSync } from "node:fs";
import {
  GSA_NAICS_NOT_STATED,
  GSA_NON_US_LABEL,
  GSA_PRIME_DIRECTORY_CONTEXT,
  GSA_PRIME_DIRECTORY_FY,
  GSA_PRIME_DIRECTORY_HEADING,
  GSA_PRIME_DIRECTORY_SOURCE_URL,
  PRIME_DIRECTORY_CONTEXT,
  PRIME_DIRECTORY_HEADING,
  PRIMES_DEFAULT_SOURCE,
  PRIMES_SOURCE_ERROR,
  STATE_NOT_STATED,
  gsaNonNaicsText,
  gsaStateLabel,
  isPrimesQueryError,
  naicsDisplayLabels,
  parsePrimesSource,
  toPrimeView,
  validatePrimesSource,
  type StoredPrimeRow,
} from "./read";

// ── Fake DB ──────────────────────────────────────────────────────────────────
// A statement recorder that REFUSES to behave like a database: any query is recorded and
// throws, so the fail-closed assertions below can never silently pass by reading a store.
const statements: string[] = [];
mock.module("~/db", () => ({
  sql: () => async (strings: TemplateStringsArray, ...values: unknown[]) => {
    statements.push(strings.join(" ? ").replace(/\s+/g, " ").trim());
    void values;
    throw new Error("this suite must not read a database");
  },
}));

const { readPrimesPayload } = await import("~/lib/subcontracts/read.server");

/** A stored GSA row: the source publishes no title, no agency, no award and no date. */
const gsaStoredRow = (over: Partial<StoredPrimeRow> = {}): StoredPrimeRow => ({
  legal_name: "1SPATIAL INC.",
  uei: "HJZQJHWNMJM3",
  vendor_state: "Virginia",
  naics: ["541620"],
  industries: [],
  agencies: [],
  award_rows: 0,
  latest_pop_start: null,
  subcontract_plan_type: null,
  fy: "past fiscal year",
  source_url: GSA_PRIME_DIRECTORY_SOURCE_URL,
  vendor_address: "8614 WESTWOOD CENTER DR STE 350\nVIENNA, VIRGINIA 221822278",
  products_services: "GIS SOFTWARE AND SERVICES",
  source_file_date: "2025-07-09",
  naics_raw: null,
  ...over,
});

describe("gsa read: the owner-verbatim heading", () => {
  test("the heading is byte-exact (middots ·, 'prime contractor directory', no year)", () => {
    expect(GSA_PRIME_DIRECTORY_HEADING).toBe(
      "GSA prime contractor directory \u00b7 past fiscal year \u00b7 last checked by Contrax",
    );
    // The exact characters, so a "helpful" rewrite to an em dash or a year is caught.
    expect([...GSA_PRIME_DIRECTORY_HEADING].filter((c) => c === "\u00b7").length).toBe(2);
    expect(GSA_PRIME_DIRECTORY_HEADING).not.toContain("\u2014");
    expect(GSA_PRIME_DIRECTORY_HEADING).not.toMatch(/\bFY\d/);
    expect(GSA_PRIME_DIRECTORY_HEADING).toContain("prime contractor directory");
    expect(GSA_PRIME_DIRECTORY_HEADING).toContain("last checked by Contrax");
  });

  test("the fiscal-year echo is the literal 'past fiscal year', never a year", () => {
    expect(GSA_PRIME_DIRECTORY_FY).toBe("past fiscal year");
  });

  test("the section's copy makes no coverage claim and states it is not open work", () => {
    for (const text of [GSA_PRIME_DIRECTORY_HEADING, GSA_PRIME_DIRECTORY_CONTEXT]) {
      expect(text.toLowerCase()).not.toContain("nationwide");
      expect(text.toLowerCase()).not.toContain("comprehensive");
    }
    expect(GSA_PRIME_DIRECTORY_CONTEXT).toContain("companies to approach, not open opportunities");
  });
});

describe("gsa read: ?source= selects the directory and never coerces", () => {
  const parse = (query: string) => parsePrimesSource(new URLSearchParams(query));

  test("absent and blank mean the shipped default (sba)", () => {
    expect(PRIMES_DEFAULT_SOURCE).toBe("sba");
    const absent = parse("");
    const blank = parse("source=");
    expect(absent.ok && absent.value).toBe("sba");
    expect(blank.ok && blank.value).toBe("sba");
    expect(parse("source=sba").ok && parse("source=sba").ok).toBe(true);
  });

  test("gsa is accepted, and case is folded (a URL is not a case-sensitive API)", () => {
    const lower = parse("source=gsa");
    const upper = parse("source=GSA");
    expect(lower.ok && lower.value).toBe("gsa");
    expect(upper.ok && upper.value).toBe("gsa");
  });

  test("a present-but-unknown source is a hard failure, never 'the default'", () => {
    for (const bad of ["source=xyz", "source=1", "source=sba,gsa", "source=gsa%2Cgsa"]) {
      const result = parse(bad);
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.error).toBe(PRIMES_SOURCE_ERROR);
    }
    expect(PRIMES_SOURCE_ERROR).toBe("source must be sba or gsa");
    expect(validatePrimesSource("nope").ok).toBe(false);
    expect(validatePrimesSource(null).ok).toBe(true);
  });
});

describe("gsa read: only a VALIDATED six-digit code is ever a trade label", () => {
  test("a stored code resolves through the repo's one NAICS name table", () => {
    expect(naicsDisplayLabels(["236220"])).toEqual(["Commercial Building Construction"]);
    expect(naicsDisplayLabels(["541620"])).toEqual(["Environmental Consulting Services"]);
    // An unknown code is labelled as unknown — NEVER a bare code.
    expect(naicsDisplayLabels(["999999"])).toEqual(["NAICS 999999 (title not stated)"]);
    expect(naicsDisplayLabels(["999999"])[0]).not.toBe("999999");
    // SBA rows keep their own stored "code: TITLE" behaviour.
    expect(naicsDisplayLabels(["541330: ENGINEERING SERVICES"])).toEqual(["ENGINEERING SERVICES"]);
    expect(naicsDisplayLabels([])).toEqual([]);
  });

  test("the raw NAICS value is evidence only: carried, never labelled, never rendered", () => {
    const invalid = toPrimeView(gsaStoredRow({ naics: [], naics_raw: "8711" }));
    // The invalid value IS identifiable through the read surface...
    expect(invalid.naicsRaw).toBe("8711");
    // ...but it is not in `naics` and not in `naicsLabels`, so nothing can render it as a
    // trade: the row states "NAICS not stated" instead.
    expect(invalid.naics).toEqual([]);
    expect(invalid.naicsLabels).toEqual([]);
    expect(GSA_NAICS_NOT_STATED).toBe("NAICS not stated");
  });

  test("an SBA row gains NO new key (the shipped response shape is untouched)", () => {
    const sba = toPrimeView({
      legal_name: "AMERIQUAL GROUP, LLC",
      uei: "C114QV5R7YX8",
      vendor_state: "INDIANA",
      naics: ["311999: ALL OTHER MISCELLANEOUS FOOD MANUFACTURING"],
      industries: [],
      agencies: ["DEFENSE LOGISTICS AGENCY"],
      award_rows: 4,
      latest_pop_start: "2024-09-17T00:00:00.000Z",
      subcontract_plan_type: "Individual",
      fy: "FY24",
      source_url: "https://www.sba.gov/document/support--directory",
    });
    expect(Object.keys(sba)).toEqual([
      "legalName",
      "uei",
      "vendorState",
      "vendorStateLabel",
      "naics",
      "naicsLabels",
      "industries",
      "agencies",
      "awardRows",
      "latestPopStart",
      "subcontractPlanType",
      "fy",
      "sourceUrl",
      "vendorAddress",
      "productsServices",
      "sourceFileDate",
    ]);
    // `naicsRaw` is ABSENT (not null) for a row read without the migration-051 column, which
    // is what keeps an SBA payload byte-identical.
    expect("naicsRaw" in sba).toBe(false);
    expect(sba.fy).toBe("FY24");
  });
});

describe("gsa read: Non-US is the source's wording, never a state", () => {
  test("the label says whose words they are", () => {
    expect(gsaStateLabel("Non-US")).toBe("Non-US (as the source states)");
    expect(GSA_NON_US_LABEL).toBe("Non-US (as the source states)");
    // It is a source value, not a US state: nothing is mapped to a 2-letter code.
    expect(gsaStateLabel("non-us")).toBe(GSA_NON_US_LABEL);
    expect(gsaStateLabel("Texas")).toBe("Texas");
    expect(gsaStateLabel("Puerto Rico")).toBe("Puerto Rico");
    expect(gsaStateLabel("District of Columbia")).toBe("District of Columbia");
    expect(gsaStateLabel(null)).toBe(STATE_NOT_STATED);
    expect(gsaStateLabel("")).toBe(STATE_NOT_STATED);
    const view = toPrimeView(gsaStoredRow({ vendor_state: "Non-US" }));
    expect(view.vendorState).toBe("Non-US");
    expect(view.vendorStateLabel).toBe(GSA_NON_US_LABEL);
  });
});

describe("gsa read: the honesty line is built from the live count", () => {
  test("count and sentence cannot disagree", () => {
    expect(gsaNonNaicsText(105)).toBe(
      "105 rows without a valid NAICS code — no trade label stated, so the NAICS filter cannot match them",
    );
    expect(gsaNonNaicsText(0)).toBe(
      "0 rows without a valid NAICS code — no trade label stated, so the NAICS filter cannot match them",
    );
    // The sentence states the consequence (the filter cannot match) — never a claim about
    // the companies, and never a coverage claim.
    expect(gsaNonNaicsText(105).toLowerCase()).not.toContain("nationwide");
    expect(gsaNonNaicsText(105).toLowerCase()).not.toContain("comprehensive");
  });
});

describe("gsa read: the GSA row view renders the source's own facts", () => {
  test("address joins on one line, products/services pass through verbatim", () => {
    const view = toPrimeView(gsaStoredRow());
    expect(view.vendorAddress).toBe("8614 WESTWOOD CENTER DR STE 350, VIENNA, VIRGINIA 221822278");
    expect(view.productsServices).toBe("GIS SOFTWARE AND SERVICES");
    expect(view.naicsLabels).toEqual(["Environmental Consulting Services"]);
    // The file date is evidence in the payload; the section renders no date of its own.
    expect(view.sourceFileDate).toBe("2025-07-09");
    // Nothing the source does not publish is invented on the way out.
    expect(view.awardRows).toBe(0);
    expect(view.agencies).toEqual([]);
  });

  test("a row with no address/products degrades to null, never to a blank claim", () => {
    const view = toPrimeView(gsaStoredRow({ vendor_address: null, products_services: null }));
    expect(view.vendorAddress).toBeNull();
    expect(view.productsServices).toBeNull();
  });
});

describe("gsa read: the SBA half is unchanged (structural pins)", () => {
  const sourceText = readFileSync(new URL("./read.server.ts", import.meta.url), "utf8");

  test("the shipped SBA statement names no migration-051 column", () => {
    // Exactly one statement selects the awarded contract (SBA) shape, and it is the shipped
    // one: the GSA branch is the only place a 051 column is named.
    // Two statements select the directory shape — the shipped SBA one and the GSA one — and
    // the SBA row shape itself is unchanged between them.
    const selects = sourceText.match(/p\.award_rows, p\.latest_pop_start, p\.subcontract_plan_type, p\.fy, p\.source_url/g);
    expect(selects?.length).toBe(2);
    const gsaColumns = sourceText.match(/p\.naics_raw/g);
    expect(gsaColumns?.length).toBe(1);
    const addressColumns = sourceText.match(/p\.vendor_address, p\.products_services/g);
    expect(addressColumns?.length).toBe(1);
  });

  test("the SBA copy and its default are still the shipped ones", () => {
    expect(PRIME_DIRECTORY_HEADING).toBe("Subcontracting leads — SBA FY24 directory (annual)");
    expect(PRIME_DIRECTORY_CONTEXT).toBe(
      "The SBA FY24 directory is an annual file (fiscal year 2024) of federal prime contractors that reported a subcontracting plan. It is a historical snapshot — these are companies to approach, not open opportunities.",
    );
    expect(PRIMES_DEFAULT_SOURCE).toBe("sba");
  });
});

describe("gsa read: a bad request answers 400 BEFORE the store is touched", () => {
  test("an invalid source returns the documented body and issues no statement", async () => {
    statements.length = 0;
    const payload = await readPrimesPayload({ naics: null, state: null, page: 1, limit: 25 }, "xyz" as never);
    expect(isPrimesQueryError(payload)).toBe(true);
    expect(payload).toEqual({ ok: false, error: "source must be sba or gsa" });
    expect(statements.length).toBe(0);
  });

  test("an invalid query returns its own error and issues no statement", async () => {
    statements.length = 0;
    const payload = await readPrimesPayload({ naics: null, state: null, page: 0, limit: 25 }, "gsa");
    expect(payload).toEqual({ ok: false, error: "page must be between 1 and 500" });
    expect(statements.length).toBe(0);
  });

  test("a VALID GSA read fails closed when the store cannot be read (never an empty list)", async () => {
    statements.length = 0;
    const payload = await readPrimesPayload({ naics: null, state: null, page: 1, limit: 25 }, "gsa");
    expect(isPrimesQueryError(payload)).toBe(false);
    expect("unavailable" in (payload as object)).toBe(true);
    // The stub threw on the very first probe, so the read reported a store failure instead
    // of a fabricated empty directory.
    expect(statements.length).toBe(1);
  });
});
