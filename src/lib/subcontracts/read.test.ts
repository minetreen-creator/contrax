/**
 * Contrax — SUBCONTRACTING preview, READ surface: pure unit tests (bun test).
 *
 * Deterministic, network-free, database-free: everything here is a pure function
 * over a stored row or a URLSearchParams. The SQL half (`read.server.ts`) is
 * exercised against the real database separately (the CI step's DB-backed half and
 * the SELECT-only live probes recorded in
 * shared/subcontracts-step2b-2026-09-25/EVIDENCE.md).
 *
 * What is pinned, in order of how much damage getting it wrong would do:
 *   - an `unverified` row (no closing date) can never reach the open list's shape;
 *   - a missing value renders as an explicit "not specified" — never a guess;
 *   - the date normalizer does not shift a calendar day across a timezone;
 *   - the excluded-count line, the posting-board sentence and the freshness wording
 *     are the owner's, byte for byte;
 *   - the filter options come from the open set only;
 *   - the primes query rejects a present-but-invalid value instead of coercing it.
 */
import { describe, expect, test } from "bun:test";
import {
  LAST_CHECKED_LABEL,
  LISTED_SCOPES_NOTE,
  NO_CLOSING_DATE_LISTED,
  NOT_SPECIFIED,
  PRIME_DIRECTORY_CONTEXT,
  PRIME_DIRECTORY_HEADING,
  PRIMES_DEFAULT_LIMIT,
  PRIMES_MAX_LIMIT,
  SUBNET_POSTING_BOARD_SENTENCE,
  SUBNET_SOURCE_LABEL,
  STATE_BUCKET_UNKNOWN,
  STATE_NOT_STATED,
  UNAVAILABLE_EXPLANATION,
  UNAVAILABLE_NEVER_SYNCED_REASON,
  UNAVAILABLE_STORE_REASON,
  UNAVAILABLE_TABLES_REASON,
  checkedAtText,
  companyCountText,
  dayText,
  emailAddress,
  excludedNoClosingDateText,
  isUnavailable,
  normalizeDay,
  normalizeStamp,
  noticeCountText,
  parsePrimesQuery,
  stateChip,
  stateOptions,
  tallyByState,
  tallyByTrade,
  toNoticeView,
  toPrimeView,
  tradeOptions,
  type StoredNoticeRow,
  type StoredPrimeRow,
} from "./read";

/** A stored row with every field real (shapes taken from the live 09-25 sweep). */
const openRow = (over: Partial<StoredNoticeRow> = {}): StoredNoticeRow => ({
  external_id: "dorm-common-area-landscaping",
  title: "Dorm Common Area Landscaping",
  prime: "PTSI Managed Services Inc.",
  prime_division: "TSSC",
  website: "https://www.parsons.com/",
  scope: "Landscaping and grounds maintenance.",
  summary: null,
  trades: ["Landscaping Services"],
  certs_solicited: ["Small Business (SB)", "SBA-certified HUBZone Small Business (HUBZone SB)"],
  naics_code: "561730",
  naics_title: "Landscaping Services",
  place_of_performance: "Alaska",
  state_code: "AK",
  closing_date: "2026-10-06T00:00:00.000Z",
  performance_start_date: "2027-04-15T00:00:00.000Z",
  contact_name: "Masanori Akers",
  contact_email: "mailto:masanori.s-ctr.akers@faa.gov",
  source_url: "https://legacy.sba.gov/federal-contracting/contracting-guide/prime-subcontracting/subcontracting-opportunities",
  detail_url: "https://legacy.sba.gov/opportunity/dorm-common-area-landscaping",
  status: "open",
  last_verified_at: "2026-09-25T16:28:09.129Z",
  ...over,
});

describe("subcontracts read: owner copy is byte-exact (OWNER-COPY 2026-09-25)", () => {
  test("freshness is OUR check, never the source's own date", () => {
    expect(LAST_CHECKED_LABEL).toBe("last checked by Contrax");
    // The banned direction: SUBNet publishes no posted/published date, so that
    // wording must never label our fetch time.
    expect(LAST_CHECKED_LABEL).not.toContain("posted");
    expect(LAST_CHECKED_LABEL).not.toContain("published");
    expect(LAST_CHECKED_LABEL).not.toContain("listed");
    expect(SUBNET_SOURCE_LABEL).toBe("SBA SUBNet");
  });

  test("the excluded line carries the real count", () => {
    expect(excludedNoClosingDateText(0)).toBe("0 excluded — no closing date stated");
    expect(excludedNoClosingDateText(91)).toBe("91 excluded — no closing date stated");
  });

  test("the posting-board sentence is verbatim, and the banned words are absent", () => {
    expect(SUBNET_POSTING_BOARD_SENTENCE).toBe(
      "SBA SUBNet is a national posting board, not a directory. A state with few or no listings means no prime has posted there recently — it does not mean no subcontracting exists in that state.",
    );
    for (const text of [
      SUBNET_POSTING_BOARD_SENTENCE,
      PRIME_DIRECTORY_HEADING,
      PRIME_DIRECTORY_CONTEXT,
      LISTED_SCOPES_NOTE,
      NO_CLOSING_DATE_LISTED,
      UNAVAILABLE_EXPLANATION,
      UNAVAILABLE_TABLES_REASON,
      UNAVAILABLE_STORE_REASON,
      UNAVAILABLE_NEVER_SYNCED_REASON,
    ]) {
      expect(text.toLowerCase()).not.toContain("nationwide");
      expect(text.toLowerCase()).not.toContain("comprehensive");
    }
  });

  test("the prime section is labelled historical with the FY24 directory", () => {
    expect(PRIME_DIRECTORY_HEADING).toContain("SBA FY24 directory");
    expect(PRIME_DIRECTORY_HEADING).toContain("annual");
    expect(PRIME_DIRECTORY_CONTEXT).toContain("companies to approach, not open opportunities");
  });
});

describe("subcontracts read: no closing date ⇒ excluded, never guessed", () => {
  test("an open row without a closing date renders the explicit 'no date' label", () => {
    const view = toNoticeView(openRow({ closing_date: null }));
    expect(view.closingDate).toBeNull();
    expect(view.closingDateText).toBeNull();
    // The card prints NO_CLOSING_DATE_LISTED for a null closingDate; the view never
    // invents one, and never borrows the performance start date.
    expect(NO_CLOSING_DATE_LISTED).toBe("no closing date listed");
  });

  test("a missing scope/summary/NAICS renders 'Not specified', never a blank", () => {
    const view = toNoticeView(
      openRow({ scope: null, summary: null, naics_code: null, naics_title: null, website: null, prime_division: null }),
    );
    expect(view.scope).toBeNull();
    expect(view.summary).toBeNull();
    expect(view.naicsCode).toBeNull();
    expect(view.primeDivision).toBeNull();
    expect(NOT_SPECIFIED).toBe("Not specified");
  });

  test("an unusable contact address is null (the card says so) — never a broken mailto", () => {
    expect(emailAddress("mailto:masanori.s-ctr.akers@faa.gov")).toBe("masanori.s-ctr.akers@faa.gov");
    expect(emailAddress("bids@prospectconst.com")).toBe("bids@prospectconst.com");
    expect(emailAddress("mailto:")).toBeNull();
    expect(emailAddress("not-an-address")).toBeNull();
    expect(emailAddress("  ")).toBeNull();
    expect(emailAddress(null)).toBeNull();
    expect(toNoticeView(openRow({ contact_email: "not-an-address" })).contactEmail).toBeNull();
  });
});

describe("subcontracts read: dates do not drift across timezones", () => {
  test("a DATE column normalizes to the same calendar day it stores", () => {
    expect(normalizeDay("2026-09-25T00:00:00.000Z")).toBe("2026-09-25");
    expect(normalizeDay(new Date("2026-09-25T00:00:00.000Z"))).toBe("2026-09-25");
    // The driver's Date for 2026-10-06 must NOT become 2026-10-05.
    expect(normalizeDay(new Date(Date.UTC(2026, 9, 6)))).toBe("2026-10-06");
    expect(normalizeDay(null)).toBeNull();
    expect(normalizeDay("")).toBeNull();
    expect(normalizeDay("not a date")).toBeNull();
  });

  test("day text is rendered in UTC from the stored day", () => {
    expect(dayText("2026-10-06")).toBe("Oct 6, 2026");
    expect(dayText("2026-09-25")).toBe("Sep 25, 2026");
    expect(dayText(null)).toBeNull();
  });

  test("our fetch time renders in US Eastern (the source's own date basis)", () => {
    // 2026-09-25T16:28:09Z is 12:28 PM in Eastern daylight time.
    const text = checkedAtText("2026-09-25T16:28:09.129Z");
    expect(text).toContain("Sep 25, 2026");
    expect(text).toContain("12:28 PM");
    expect(text).toContain("EDT");
    expect(normalizeStamp("2026-09-25T16:28:09.129Z")).toBe("2026-09-25T16:28:09.129Z");
    expect(checkedAtText(null)).toBeNull();
    expect(checkedAtText("nonsense")).toBeNull();
  });
});

describe("subcontracts read: counts come from the stored open set", () => {
  const rows: StoredNoticeRow[] = [
    openRow({ external_id: "a", state_code: "CA", trades: ["Water and Sewer Line and Related Structures Construction"] }),
    openRow({ external_id: "b", state_code: "CA", trades: ["Water and Sewer Line and Related Structures Construction", "Landscaping Services"] }),
    openRow({ external_id: "c", state_code: "AK", trades: ["Landscaping Services"] }),
    openRow({ external_id: "d", state_code: null, trades: [] }),
  ];

  test("by-state tallies every row, including one whose state is not stated", () => {
    expect(tallyByState(rows)).toEqual([
      { key: "CA", count: 2 },
      { key: STATE_BUCKET_UNKNOWN, count: 1 },
      { key: "AK", count: 1 },
    ]);
    // Every row appears exactly once in the by-state tally — a row whose state is
    // missing is COUNTED (under its own bucket), never dropped.
    expect(tallyByState(rows).reduce((sum, bucket) => sum + bucket.count, 0)).toBe(rows.length);
  });

  test("by-trade counts a multi-trade notice in EACH of its trades", () => {
    const buckets = tallyByTrade(rows);
    expect(buckets).toEqual([
      { key: "Landscaping Services", count: 2 },
      { key: "Water and Sewer Line and Related Structures Construction", count: 2 },
    ]);
    // 4 rows, 4 trade memberships (a=1, b=2, c=1, d=0): a multi-trade notice is
    // counted once per trade it lists, which is the only reading that matches the
    // per-trade filter's own behaviour.
    expect(buckets.reduce((sum, bucket) => sum + bucket.count, 0)).toBe(4);
  });

  test("a row with no trades contributes to no trade bucket (never to an 'unknown' one)", () => {
    expect(tallyByTrade([openRow({ trades: [] })])).toEqual([]);
    expect(tallyByTrade([openRow({ trades: null })])).toEqual([]);
  });

  test("filter options come from the OPEN set only, deduped and sorted", () => {
    expect(stateOptions(rows)).toEqual(["AK", "CA"]);
    expect(tradeOptions(rows)).toEqual([
      "Landscaping Services",
      "Water and Sewer Line and Related Structures Construction",
    ]);
    // An empty open set offers no options at all — never a menu of states that does
    // not correspond to any open notice.
    expect(stateOptions([])).toEqual([]);
    expect(tradeOptions([])).toEqual([]);
  });

  test("count labels are singular/plural correct", () => {
    expect(noticeCountText(0)).toBe("0 open notices");
    expect(noticeCountText(1)).toBe("1 open notice");
    expect(noticeCountText(141)).toBe("141 open notices");
    expect(companyCountText(1)).toBe("1 company");
    expect(companyCountText(2917)).toBe("2917 companies");
  });

  test("the state chip is explicit when the source's wording has no state", () => {
    expect(stateChip("AK")).toBe("Subcontract · AK");
    expect(stateChip("ca")).toBe("Subcontract · CA");
    expect(stateChip(null)).toBe(`Subcontract · ${STATE_NOT_STATED}`);
    expect(STATE_NOT_STATED).toBe("state not stated");
  });
});

describe("subcontracts read: fail-closed states are explicit, never empty-looking", () => {
  test("an unavailable payload is distinguishable from a payload with 0 rows", () => {
    const unavailable = {
      unavailable: {
        reason: UNAVAILABLE_TABLES_REASON,
        explanation: UNAVAILABLE_EXPLANATION,
        sourceUrl: "https://legacy.sba.gov/federal-subcontracting",
      },
    };
    expect(isUnavailable(unavailable)).toBe(true);
    expect(isUnavailable({ rows: [], counts: { total: 0, byState: [], byTrade: [] } } as never)).toBe(false);
    // Every reason is a sentence a visitor can read, and each says WHY nothing is
    // shown rather than implying there is nothing to show.
    for (const reason of [
      UNAVAILABLE_TABLES_REASON,
      UNAVAILABLE_STORE_REASON,
      UNAVAILABLE_NEVER_SYNCED_REASON,
    ]) {
      expect(reason.length).toBeGreaterThan(40);
      expect(reason).not.toContain("[]");
    }
    expect(UNAVAILABLE_EXPLANATION).toBe("Contrax shows nothing rather than an empty or unverified list.");
  });
});

describe("subcontracts read: the primes query validates instead of coercing", () => {
  const parse = (query: Record<string, string>) => parsePrimesQuery(new URLSearchParams(query));

  test("a bare request is page 1 with no restriction", () => {
    const bare = parse({});
    expect(bare.ok).toBe(true);
    if (bare.ok) expect(bare.value).toEqual({ naics: null, state: null, page: 1, limit: PRIMES_DEFAULT_LIMIT });
  });

  test("the NAICS code is taken from a full 'code: TITLE' value", () => {
    const code = parse({ naics: "541330" });
    const full = parse({ naics: "541330: ENGINEERING SERVICES" });
    expect(code.ok && code.value.naics).toBe("541330");
    expect(full.ok && full.value.naics).toBe("541330");
  });

  test("a present-but-invalid value is a hard failure, never 'no filter'", () => {
    for (const bad of [{ naics: "abc" }, { naics: "1" }, { naics: "1234567" }, { state: "12" }, { page: "0" }, { page: "-1" }, { page: "abc" }, { page: String(501) }, { limit: "0" }, { limit: "101" }, { limit: "twenty" }]) {
      expect(parse(bad).ok).toBe(false);
    }
    // Blank values are ABSENT, not invalid (a `<select>` sends "" for "all").
    expect(parse({ naics: "", state: "", page: "", limit: "" }).ok).toBe(true);
  });

  test("state and limit bounds behave", () => {
    const ok = parse({ state: "VIRGINIA", limit: "50", page: "3" });
    expect(ok.ok && ok.value.state).toBe("VIRGINIA");
    expect(ok.ok && ok.value.limit).toBe(50);
    expect(ok.ok && ok.value.page).toBe(3);
    const lower = parse({ state: "virginia" });
    expect(lower.ok && lower.value.state).toBe("VIRGINIA");
    expect(parse({ limit: "100" }).ok).toBe(true);
    expect(parse({ limit: String(PRIMES_MAX_LIMIT + 1) }).ok).toBe(false);
    expect(parse({ state: "x".repeat(41) }).ok).toBe(false);
  });
});

describe("subcontracts read: the prime row carries the annual file's own facts", () => {
  const storedPrime: StoredPrimeRow = {
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
    source_url: "https://www.sba.gov/document/support--directory-federal-government-prime-contractors-subcontracting-plans",
  };

  test("maps the stored row, keeping the FY echo and the UEI", () => {
    const view = toPrimeView(storedPrime);
    expect(view.legalName).toBe("AMERIQUAL GROUP, LLC");
    expect(view.uei).toBe("C114QV5R7YX8");
    expect(view.fy).toBe("FY24");
    expect(view.vendorState).toBe("INDIANA");
    expect(view.awardRows).toBe(4);
    expect(view.latestPopStart).toBe("2024-09-17");
    expect(view.agencies).toEqual(["DEFENSE LOGISTICS AGENCY"]);
  });

  test("a prime with no state/agencies degrades to empty, never to a fabricated value", () => {
    const view = toPrimeView({
      ...storedPrime,
      vendor_state: null,
      agencies: null,
      naics: null,
      industries: null,
      award_rows: null,
      latest_pop_start: null,
      subcontract_plan_type: null,
      source_url: null,
    });
    expect(view.vendorState).toBeNull();
    expect(view.agencies).toEqual([]);
    expect(view.naics).toEqual([]);
    expect(view.awardRows).toBe(0);
    expect(view.latestPopStart).toBeNull();
    expect(view.sourceUrl).toBeNull();
  });
});
