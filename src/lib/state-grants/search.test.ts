/**
 * Unit tests — STATE GRANT SEARCH, PURE HALF (part 2, re-cut for the corrected
 * model; owner R1 2026-09-19).
 *
 * DETERMINISTIC AND OFFLINE: no database, no network, no live source. These
 * tests pin the request contract (what a caller may ask for and what a bad
 * request gets), the read-time status rule, the display rules (an estimate is
 * never a deadline) and the "Not specified" mapping — plus the one vocabulary
 * rule the owner's correction exists for: `forecast` is not a status anywhere in
 * the part-2 surface.
 */
import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import {
  NOT_SPECIFIED,
  STATE_GRANT_STATUSES,
  STATE_GRANT_STATUS_LABELS,
  type StateGrantStatus,
} from "~/lib/state-grants/connector";
import {
  STATE_GRANT_DEFAULT_LIMIT,
  STATE_GRANT_ESTIMATE_NOTE,
  STATE_GRANT_MAX_LIMIT,
  describeStateGrantCount,
  effectiveStateGrantStatus,
  hostOf,
  isStateGrantStatus,
  isSupportedStateCode,
  parseStateGrantSearchRequest,
  stateGrantDeadlineDisplay,
  stateGrantSourceLabel,
  stateGrantToday,
  toStateGrantRecordView,
} from "~/lib/state-grants/search";

const THE_FIVE: readonly StateGrantStatus[] = [
  "open",
  "upcoming",
  "rolling",
  "closed",
  "unverified",
];

/** What a valid parse gave us, or a failed expectation with the real error. */
function params(body: unknown) {
  const parsed = parseStateGrantSearchRequest(body);
  if (!parsed.ok) throw new Error(`expected a valid request, got: ${parsed.error}`);
  return parsed.params;
}

function errorOf(body: unknown): string {
  const parsed = parseStateGrantSearchRequest(body);
  if (parsed.ok) throw new Error("expected the request to be rejected");
  return parsed.error;
}

/** A stored row as the store returns it, for the view-mapping tests. */
function row(overrides: Record<string, unknown> = {}) {
  return {
    id: "id-1",
    stateCode: "VA",
    stateName: "Virginia",
    sourceKey: "va-vtc-grants",
    sourceName: "Virginia Tourism Corporation grants",
    sourceAgency: "Virginia Tourism Corporation",
    sourceOfficialUrl: "https://www.vatc.org/grants/",
    externalId: "mmlp",
    title: "Matching Marketing Leverage Program",
    agency: "Virginia Tourism Corporation",
    summary: "   ",
    status: "open" as StateGrantStatus,
    postedDate: "2026-09-01",
    closeDate: "2026-12-31",
    estimatedCloseDate: null,
    url: "https://www.vatc.org/grants/mmlp/",
    sourceUrl: "https://www.vatc.org/grants/",
    sourceUpdatedAt: null,
    fetchedAt: "2026-09-19T12:00:00.000Z",
    lastSeenAt: "2026-09-19T12:00:00.000Z",
    eligibleApplicants: "Virginia localities and DMOs",
    eligibleGeography: "Virginia",
    categories: ["Tourism"],
    awardRange: "Tier One $10,000 Tier Two $20,000",
    awardMinAmount: 10000,
    awardMaxAmount: 20000,
    totalFunding: "Not specified",
    matchingRequirement: "1:1 cash match",
    ...overrides,
  } as Parameters<typeof toStateGrantRecordView>[0];
}

describe("the status vocabulary (no forecast, anywhere)", () => {
  test("the five statuses are exactly the owner's, in serving order", () => {
    expect([...STATE_GRANT_STATUSES]).toEqual([...THE_FIVE]);
  });

  test("`forecast` is not a status, and the labels never say it", () => {
    expect(isStateGrantStatus("forecast")).toBe(false);
    for (const status of THE_FIVE) {
      expect(STATE_GRANT_STATUS_LABELS[status].toLowerCase()).not.toContain("forecast");
      expect(describeStateGrantCount(status, 3, true).toLowerCase()).not.toContain("forecast");
    }
  });

  test("no part-2 source file contains a `forecast` string LITERAL", () => {
    // Comments may name the retired status in backticks (that is documentation);
    // a quoted literal would be code that could still carry it.
    const files = [
      "search.ts",
      "search.server.ts",
      "coverage.server.ts",
      "store.server.ts",
      "../../routes/state-grants.tsx",
      "../../routes/api/state-grants/search.ts",
      "../../routes/api/state-grants/coverage.ts",
    ];
    for (const file of files) {
      const source = readFileSync(new URL(file, import.meta.url), "utf8");
      expect(source.match(/["']forecast["']/g) ?? []).toEqual([]);
    }
  });
});

describe("request contract", () => {
  test("an empty body is the default search", () => {
    expect(params(undefined)).toEqual({
      stateCodes: [],
      sourceKeys: [],
      status: null,
      term: null,
      eligibleApplicants: null,
      eligibleGeography: null,
      categories: [],
      awardRange: null,
      totalFunding: null,
      matchingRequirement: null,
      awardMinAmount: null,
      awardMaxAmount: null,
      limit: STATE_GRANT_DEFAULT_LIMIT,
      offset: 0,
      limitCapped: false,
    });
  });

  test("a non-object body is refused", () => {
    expect(errorOf([1, 2])).toMatch(/JSON object/);
    expect(errorOf("hello")).toMatch(/JSON object/);
  });

  test("every one of the five statuses is accepted; `forecast` is refused by name", () => {
    for (const status of THE_FIVE) expect(params({ status }).status).toBe(status);
    const error = errorOf({ status: "forecast" });
    expect(error).toContain("open, upcoming, rolling, closed, unverified");
  });

  test("source keys are deduped and refuse a separator character", () => {
    expect(params({ sourceKeys: ["va-vtc-grants", "va-vtc-grants"] }).sourceKeys).toEqual([
      "va-vtc-grants",
    ]);
    expect(params({ sourceKeys: [] }).sourceKeys).toEqual([]);
    expect(errorOf({ sourceKeys: "va-vtc-grants" })).toMatch(/array of source keys/);
    expect(errorOf({ sourceKeys: ["a,b"] })).toMatch(/must not contain a comma/);
  });

  test("state codes are validated, upper-cased and deduped", () => {
    expect(params({ stateCodes: ["va", "VA", "dc"] }).stateCodes).toEqual(["VA", "DC"]);
    expect(errorOf({ stateCodes: ["VA", "XX"] })).toMatch(/Unknown state code "XX"/);
    expect(errorOf({ stateCodes: "VA" })).toMatch(/array of two-letter state codes/);
  });

  test("term is stripped of control characters and bounded", () => {
    expect(params({ term: "  tourism\u0000 " }).term).toBe("tourism");
    expect(params({ term: "   " }).term).toBeNull();
    expect(errorOf({ term: "x".repeat(121) })).toMatch(/at most 120 characters/);
    expect(errorOf({ term: 5 })).toMatch(/term must be a string/);
  });

  test("the normalized-column text filters are parsed the same way, by name", () => {
    const parsed = params({
      eligibleApplicants: " small business ",
      eligibleGeography: "Virginia",
      awardRange: "tier",
      totalFunding: "$50,000",
      matchingRequirement: "cash match",
    });
    expect(parsed.eligibleApplicants).toBe("small business");
    expect(parsed.eligibleGeography).toBe("Virginia");
    expect(parsed.awardRange).toBe("tier");
    expect(parsed.totalFunding).toBe("$50,000");
    expect(parsed.matchingRequirement).toBe("cash match");
    expect(errorOf({ eligibleApplicants: 5 })).toMatch(/eligibleApplicants must be a string/);
    expect(errorOf({ matchingRequirement: "x".repeat(81) })).toMatch(
      /matchingRequirement must be at most 80 characters/,
    );
  });

  test("categories are deduped case-insensitively and capped", () => {
    expect(params({ categories: ["Tourism", "tourism", " Events "] }).categories).toEqual([
      "Tourism",
      "Events",
    ]);
    expect(params({ categories: [] }).categories).toEqual([]);
    expect(errorOf({ categories: ["a", "b", "c", "d", "e", "f"] })).toMatch(/at most 5 labels/);
    expect(errorOf({ categories: "tourism" })).toMatch(/array of strings/);
    expect(errorOf({ categories: ["tourism,events"] })).toMatch(/must not contain a comma/);
  });

  test("amount filters must be real numbers, and min must not exceed max", () => {
    expect(params({ awardMinAmount: 10000, awardMaxAmount: 50000 }).awardMinAmount).toBe(10000);
    expect(params({ awardMinAmount: 0 }).awardMinAmount).toBe(0);
    expect(errorOf({ awardMinAmount: -1 })).toMatch(/zero or a positive number/);
    expect(errorOf({ awardMaxAmount: Number.NaN })).toMatch(/zero or a positive number/);
    expect(errorOf({ awardMaxAmount: "100" })).toMatch(/zero or a positive number/);
    expect(errorOf({ awardMinAmount: 10, awardMaxAmount: 5 })).toMatch(
      /must not be greater than awardMaxAmount/,
    );
  });

  test("limit is clamped and reported; offset must be a non-negative integer", () => {
    expect(params({ limit: 10 }).limit).toBe(10);
    expect(params({ limit: 10 }).limitCapped).toBe(false);
    const clamped = params({ limit: STATE_GRANT_MAX_LIMIT + 50 });
    expect(clamped.limit).toBe(STATE_GRANT_MAX_LIMIT);
    expect(clamped.limitCapped).toBe(true);
    expect(errorOf({ limit: 0 })).toMatch(/positive integer/);
    expect(errorOf({ limit: 2.5 })).toMatch(/positive integer/);
    expect(errorOf({ offset: -1 })).toMatch(/zero or a positive integer/);
    expect(params({ offset: 25 }).offset).toBe(25);
  });

  test("an unknown field is ignored, never guessed at", () => {
    expect(params({ sortBy: "whatever", forecast: true }).status).toBeNull();
  });

  test("isSupportedStateCode knows exactly the 50 states + DC", () => {
    expect(isSupportedStateCode("VA")).toBe(true);
    expect(isSupportedStateCode("DC")).toBe(true);
    expect(isSupportedStateCode("PR")).toBe(false);
    expect(isSupportedStateCode("va")).toBe(false);
  });
});

describe("read-time status", () => {
  test("stateGrantToday is the US Eastern calendar day", () => {
    // 03:30 UTC on the 20th is still the 19th in Eastern time.
    expect(stateGrantToday(new Date("2026-09-20T03:30:00Z"))).toBe("2026-09-19");
    expect(stateGrantToday(new Date("2026-09-20T14:00:00Z"))).toBe("2026-09-20");
  });

  test("an open row whose deadline has passed is served closed; nothing else moves", () => {
    const today = "2026-09-19";
    expect(effectiveStateGrantStatus({ status: "open", closeDate: "2026-09-18" }, today)).toBe("closed");
    // The deadline DAY itself is still open.
    expect(effectiveStateGrantStatus({ status: "open", closeDate: "2026-09-19" }, today)).toBe("open");
    expect(effectiveStateGrantStatus({ status: "open", closeDate: "2026-10-01" }, today)).toBe("open");
    expect(effectiveStateGrantStatus({ status: "open", closeDate: null }, today)).toBe("open");
    for (const status of ["upcoming", "rolling", "closed", "unverified"] as StateGrantStatus[]) {
      expect(effectiveStateGrantStatus({ status, closeDate: "2000-01-01" }, today)).toBe(status);
    }
  });
});

describe("display rules", () => {
  test("hostOf strips the scheme and www, and never invents one", () => {
    expect(hostOf("https://www.vatc.org/grants/")).toBe("vatc.org");
    expect(hostOf("not a url")).toBe(NOT_SPECIFIED);
  });

  test("the source label is the publishing body plus its own host", () => {
    expect(
      stateGrantSourceLabel({
        stateCode: "VA",
        stateName: "Virginia",
        sourceAgency: "Virginia Tourism Corporation",
        agency: "Virginia Tourism Corporation",
        sourceOfficialUrl: "https://www.vatc.org/grants/",
        sourceUrl: "https://www.vatc.org/grants/mmlp/",
      }),
    ).toBe("Virginia Tourism Corporation — vatc.org");
    // Nothing to name it with: the state's own name, never a fabricated agency.
    expect(
      stateGrantSourceLabel({
        stateCode: "VA",
        stateName: "Virginia",
        sourceAgency: null,
        agency: NOT_SPECIFIED,
        sourceOfficialUrl: null,
        sourceUrl: "https://www.vatc.org/grants/",
      }),
    ).toBe("Virginia — vatc.org");
  });

  test("the deadline line never presents an estimate as a posted closing date", () => {
    expect(
      stateGrantDeadlineDisplay({ status: "open", closeDate: "2026-12-31", estimatedCloseDate: null }),
    ).toEqual({ label: "Closing date", value: "2026-12-31" });
    expect(
      stateGrantDeadlineDisplay({ status: "upcoming", closeDate: "2026-12-31", estimatedCloseDate: null }),
    ).toEqual({ label: "Closing date", value: "2026-12-31" });
    expect(
      stateGrantDeadlineDisplay({ status: "closed", closeDate: "2026-03-19", estimatedCloseDate: null }),
    ).toEqual({ label: "Closed", value: "2026-03-19" });
    const rolling = stateGrantDeadlineDisplay({
      status: "rolling",
      closeDate: null,
      estimatedCloseDate: null,
    });
    expect(rolling.value).toContain("year-round");
    const estimate = stateGrantDeadlineDisplay({
      status: "unverified",
      closeDate: null,
      estimatedCloseDate: "2026-10-29",
    });
    expect(estimate.label).toBe("Estimated deadline");
    expect(estimate.value).toContain(STATE_GRANT_ESTIMATE_NOTE);
    const none = stateGrantDeadlineDisplay({
      status: "unverified",
      closeDate: null,
      estimatedCloseDate: null,
    });
    expect(none.value).toContain("No confirmable dates");
  });

  test("count sentences are honest per status", () => {
    expect(describeStateGrantCount("open", 1, true)).toBe("1 record open for applications");
    expect(describeStateGrantCount("open", 4, true)).toBe("4 records open for applications");
    expect(describeStateGrantCount("upcoming", 1, true)).toContain("upcoming cycle");
    expect(describeStateGrantCount("rolling", 2, true)).toContain("rolling programs");
    expect(describeStateGrantCount("closed", 3, true)).toBe("3 closed records");
    expect(describeStateGrantCount("unverified", 2, true)).toContain("no confirmable dates");
    expect(describeStateGrantCount(null, 7, true)).toBe("7 stored records");
    expect(describeStateGrantCount(null, 7, false)).toBe("7+ stored records");
  });
});

describe("record view", () => {
  test("a stored row maps with its status, source and official links intact", () => {
    const view = toStateGrantRecordView(row(), "2026-09-19");
    expect(view.status).toBe("open");
    expect(view.statusLabel).toBe(STATE_GRANT_STATUS_LABELS.open);
    expect(view.sourceKey).toBe("va-vtc-grants");
    expect(view.sourceName).toBe("Virginia Tourism Corporation grants");
    expect(view.sourceLabel).toBe("Virginia Tourism Corporation — vatc.org");
    expect(view.sourceUrl).toBe("https://www.vatc.org/grants/");
    expect(view.url).toBe("https://www.vatc.org/grants/mmlp/");
    expect(view.categories).toEqual(["Tourism"]);
    expect(view.awardMinAmount).toBe(10000);
    expect(view.awardMaxAmount).toBe(20000);
  });

  test("an absent value is Not specified — never a blank or a guess", () => {
    const view = toStateGrantRecordView(
      row({
        agency: null,
        summary: "   ",
        sourceName: null,
        eligibleApplicants: "",
        eligibleGeography: "  ",
        categories: [],
        awardRange: "",
        awardMinAmount: null,
        awardMaxAmount: null,
        matchingRequirement: null,
      }),
      "2026-09-19",
    );
    expect(view.agency).toBe(NOT_SPECIFIED);
    expect(view.summary).toBe(NOT_SPECIFIED);
    expect(view.sourceName).toBe(NOT_SPECIFIED);
    expect(view.eligibleApplicants).toBe(NOT_SPECIFIED);
    expect(view.eligibleGeography).toBe(NOT_SPECIFIED);
    expect(view.awardRange).toBe(NOT_SPECIFIED);
    expect(view.matchingRequirement).toBe(NOT_SPECIFIED);
    expect(view.categories).toEqual([]);
    expect(view.awardMinAmount).toBeNull();
    expect(view.deadline.value).toBe("2026-12-31");
  });

  test("the view re-checks the deadline against today: a stale open row reads closed", () => {
    const view = toStateGrantRecordView(row(), "2027-01-01");
    expect(view.status).toBe("closed");
    expect(view.deadline).toEqual({ label: "Closed", value: "2026-12-31" });
  });

  test("an unverified row keeps its estimate OUT of the close date", () => {
    const view = toStateGrantRecordView(
      row({ status: "unverified", closeDate: null, estimatedCloseDate: "2026-10-29" }),
      "2026-09-19",
    );
    expect(view.closeDate).toBeNull();
    expect(view.estimatedCloseDate).toBe("2026-10-29");
    expect(view.deadline.value).toContain(STATE_GRANT_ESTIMATE_NOTE);
  });

  test("a rolling row can never be rendered with a closing date", () => {
    const view = toStateGrantRecordView(row({ status: "rolling", closeDate: null }), "2026-09-19");
    expect(view.closeDate).toBeNull();
    expect(view.deadline.value).toContain("year-round");
  });

  test("the record shape has no `forecast` field or status anywhere", () => {
    const view = toStateGrantRecordView(row(), "2026-09-19") as Record<string, unknown>;
    expect(Object.keys(view)).not.toContain("forecast");
    expect(JSON.stringify(view).toLowerCase()).not.toContain("forecast");
  });
});
