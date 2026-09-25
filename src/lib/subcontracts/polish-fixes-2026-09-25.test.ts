/**
 * Contrax — SUBCONTRACTING post-go-live polish (live findings O2/O3, 2026-09-25).
 *
 * Three deterministic fixture/no-network regression tests over the three nits the
 * live sweep and the owner's list reported against the shipped feature:
 *
 *   O2  every live card's scope opened with the source's own markup residue
 *       ("> Description ..."). The fixture below is a BYTE-EXACT capture of the live
 *       detail page for the reported notice (aal-0810-01 Sitka FSS Fire Esc, SHA-256
 *       b9462eb6ddb7620da2e23edf362e07790f7a30cd8dca8f9d0906735a4f1e6d23, 36,963 bytes),
 *       and it still contains the exact bytes that produced the residue — so it keeps
 *       reproducing the bug the fix removes.
 *   O3  three notices publish a bare NAICS code (236210) with no title, which used to
 *       reach the trade menu as digits. The live board cell is quoted verbatim below.
 *   P3  an invalid primes query must answer the documented 400 body and never be
 *       reported as "the store is unreachable".
 *
 * ZERO NETWORK: everything here reads a committed fixture or a literal.
 */
import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { listedScopes, splitNaics, storedScopeLabel, stripSourceHeadingResidue } from "./connector";
import {
  PRIMES_DEFAULT_LIMIT,
  isPrimesQueryError,
  parsePrimesQuery,
  scopeValues,
  storedScopeText,
  tallyByTrade,
  toNoticeView,
  tradeOptions,
  validatePrimesQuery,
  type StoredNoticeRow,
} from "./read";
import { parseSubnetDetailPage } from "./subnet";
import { readPrimesPayload } from "./read.server";

const fixture = (name: string) =>
  readFileSync(new URL(`./fixtures/${name}`, import.meta.url), "utf8");

/** The live detail page for the notice the sweep screenshotted (see the header). */
const SITKA = fixture("subnet-detail-sitka-fss-fire-esc.html");

describe("O2 — the source's own heading markup never reaches the scope text", () => {
  test("the fixture still carries the bytes that caused the residue", () => {
    // If SBA ever changes this markup the fixture must be recaptured — the test is
    // only meaningful while the source still emits a bare ">" then its own heading.
    expect(SITKA).toContain(
      '<div class="sba-subnet__section sba-subnet__section__desc">\n      <h2 class="h3">Description</h2>',
    );
    expect(SITKA).toContain("Design and construct an access stair platform");
  });

  test("the parsed scope starts with the description, not with '>' or 'Description'", () => {
    const detail = parseSubnetDetailPage(SITKA);
    expect(detail.description).toBe(
      "Design and construct an access stair platform serving the third floor of the Sitka FSS, including site survey, permitting, final design, construction, inspections, punch-list completion, and as-built drawings.",
    );
    // The exact strings the live cards showed (finding O2) are gone.
    expect(detail.description!.startsWith(">")).toBe(false);
    expect(detail.description!.startsWith("Description")).toBe(false);
    expect(detail.description!).not.toContain("\nDescription");
  });

  test("a STORED scope (already in the database) is normalized at read time too", () => {
    // The stored form observed on all 141 open rows on 2026-09-25.
    const stored = ">\nDescription\nDesign and construct an access stair platform.";
    expect(storedScopeText(stored)).toBe("Design and construct an access stair platform.");
    expect(toNoticeView(row({ scope: stored })).scope).toBe(
      "Design and construct an access stair platform.",
    );
  });

  test("the normalizer strips heading residue of any shape and keeps the body intact", () => {
    expect(stripSourceHeadingResidue(">\nDescription\nQuarterly landscaping for campus")).toBe(
      "Quarterly landscaping for campus",
    );
    expect(stripSourceHeadingResidue("> Description: Please see attachment.")).toBe(
      "Please see attachment.",
    );
    expect(stripSourceHeadingResidue("Scope of work: Traffic control")).toBe("Traffic control");
    expect(stripSourceHeadingResidue(">")).toBe("");
    // Content that merely mentions the word keeps every word: only a LEADING heading is
    // residue, and inner newlines (the source's own paragraph breaks) are preserved.
    expect(stripSourceHeadingResidue("Description of the work\n1) Bypass\n2) Paving")).toBe(
      "Description of the work\n1) Bypass\n2) Paving",
    );
    expect(stripSourceHeadingResidue(">\nDescription\nThe description above")).toBe(
      "The description above",
    );
  });
});

describe("O3 — a bare NAICS code can never surface as a trade label", () => {
  // VERBATIM live board values, 2026-09-25: the same NAICS published with and without
  // its title, which is what made one option "236210" and its neighbour readable.
  const WITH_TITLE = "236210: Industrial Building Construction";
  const BARE = "236210";

  test("the bare cell is read as a CODE, not as a title", () => {
    expect(splitNaics(BARE)).toEqual({ code: "236210", title: null });
    expect(splitNaics("236210:")).toEqual({ code: "236210", title: null });
    expect(splitNaics(WITH_TITLE)).toEqual({
      code: "236210",
      title: "Industrial Building Construction",
    });
  });

  test("both live forms resolve to the SAME readable option label", () => {
    const fromTitle = listedScopes("Industrial Building Construction");
    const fromCode = listedScopes(splitNaics(BARE).title, splitNaics(BARE).code);
    expect(fromTitle).toEqual(["Industrial Building Construction"]);
    expect(fromCode).toEqual(["Industrial Building Construction"]);
    expect(storedScopeLabel(BARE)).toBe("Industrial Building Construction");
  });

  test("the fallback for a code the name table does not know is still readable", () => {
    const label = storedScopeLabel("999999");
    expect(label).toBe("NAICS 999999 (title not stated)");
    expect(label).not.toBe("999999");
    expect(listedScopes(null, "999999")).toEqual([label]);
    // Nothing published ⇒ no scope at all (never an invented one).
    expect(listedScopes(null)).toEqual([]);
    expect(listedScopes("236210:")).toEqual(["Industrial Building Construction"]);
  });

  test("stored bare-code rows, the census and the menu agree on one label", () => {
    const rows = [
      row({ external_id: "amc-0235", trades: ["236210"] }),
      row({ external_id: "amc-0194", trades: ["236210"] }),
      row({ external_id: "dorm", trades: ["Industrial Building Construction"] }),
      row({ external_id: "noplus", trades: [] }),
    ];
    expect(tradeOptions(rows)).toEqual(["Industrial Building Construction"]);
    expect(tallyByTrade(rows)).toEqual([{ key: "Industrial Building Construction", count: 3 }]);
    expect(scopeValues(["236210", "Industrial Building Construction", "  "])).toEqual([
      "Industrial Building Construction",
    ]);
    // The row's own chips carry the same string the filter compares against.
    expect(toNoticeView(rows[0]!).trades).toEqual(["Industrial Building Construction"]);
    expect(tradeOptions(rows).every((value) => !/^\d+$/.test(value))).toBe(true);
  });
});

describe("P3 — an invalid primes query is validated BEFORE the store is read", () => {
  test("validatePrimesQuery rejects NaN / out-of-range / bad values", () => {
    const bad: unknown[] = [
      { naics: null, state: null, page: Number.NaN, limit: PRIMES_DEFAULT_LIMIT },
      { naics: null, state: null, page: 1, limit: Number.NaN },
      { naics: null, state: null, page: 1.5, limit: PRIMES_DEFAULT_LIMIT },
      { naics: null, state: null, page: 0, limit: 25 },
      { naics: null, state: null, page: 501, limit: 25 },
      { naics: null, state: null, page: 1, limit: 101 },
      { naics: null, state: "%", page: 1, limit: 25 },
      { naics: "abc", state: null, page: 1, limit: 25 },
      { naics: null, state: "x".repeat(41), page: 1, limit: 25 },
    ];
    for (const query of bad) {
      const result = validatePrimesQuery(query as never);
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.error.length).toBeGreaterThan(10);
    }
    // The parser and the validator agree, for the same inputs.
    expect(parsePrimesQuery(new URLSearchParams({ limit: "abc" })).ok).toBe(false);
    expect(validatePrimesQuery({ naics: null, state: null, page: 1, limit: 25 }).ok).toBe(true);
    expect(validatePrimesQuery(parsePrimesQuery(new URLSearchParams()).value!).ok).toBe(true);
  });

  test("readPrimesPayload answers the 400 shape WITHOUT touching the store", async () => {
    // No DATABASE_URL is needed for any of these: the guard returns before any query.
    // Before the fix each of them reached SQL and came back as "store unreachable".
    for (const [query, error] of [
      [
        { naics: null, state: null, page: Number.NaN, limit: PRIMES_DEFAULT_LIMIT },
        "page must be a positive integer",
      ],
      [
        { naics: null, state: null, page: 1, limit: Number.NaN },
        "limit must be a positive integer",
      ],
      [{ naics: null, state: "%", page: 1, limit: 25 }, "state must be a state name"],
      [{ naics: null, state: null, page: 0, limit: 25 }, "page must be between 1 and 500"],
      [{ naics: null, state: null, page: 1, limit: 0 }, "limit must be between 1 and 100"],
      [{ naics: null, state: null, page: 1, limit: 99999 }, "limit must be between 1 and 100"],
    ] as const) {
      const result = await readPrimesPayload(query as never, new Date(0));
      expect(isPrimesQueryError(result)).toBe(true);
      if (isPrimesQueryError(result)) {
        expect(result.ok).toBe(false);
        expect(result.error).toContain(error);
        expect(result.error).not.toContain("unreachable");
      }
      expect("unavailable" in (result as object)).toBe(false);
    }
  });
});

/** A stored row built from literals (shapes taken from the live 09-25 sweep). */
function row(over: Partial<StoredNoticeRow> = {}): StoredNoticeRow {
  return {
    external_id: "dorm-common-area-landscaping",
    title: "Dorm Common Area Landscaping",
    prime: "PTSI Managed Services Inc.",
    prime_division: "TSSC",
    website: null,
    scope: "Landscaping and grounds maintenance.",
    summary: null,
    trades: ["Landscaping Services"],
    certs_solicited: [],
    naics_code: "561730",
    naics_title: "Landscaping Services",
    place_of_performance: "Alaska",
    state_code: "AK",
    closing_date: "2026-10-06T00:00:00.000Z",
    performance_start_date: null,
    contact_name: null,
    contact_email: null,
    source_url: "https://legacy.sba.gov/federal-contracting/contracting-guide/prime-subcontracting/subcontracting-opportunities",
    detail_url: "https://legacy.sba.gov/opportunity/dorm-common-area-landscaping",
    status: "open",
    last_verified_at: "2026-09-25T16:28:09.129Z",
    ...over,
  };
}
