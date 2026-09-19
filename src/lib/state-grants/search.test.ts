/**
 * Contrax Grants — STATE GRANT SEARCH: unit tests for the PURE module.
 *
 * Deterministic, no database, no network (owner guardrail 2026-09-19: ordinary
 * CI must never depend on a live external source). Everything here is a pure
 * function: the request contract, the read-time freshness rule, the display
 * labels and the record mapping the API returns.
 */
import { describe, expect, test } from "bun:test";
import { NOT_SPECIFIED } from "~/lib/state-grants/connector";
import {
  FORECAST_ESTIMATE_NOTE,
  STATE_GRANT_DEFAULT_LIMIT,
  STATE_GRANT_MAX_LIMIT,
  STATE_GRANT_SEARCH_MAX_TERM,
  describeStateGrantCount,
  easternDayString,
  effectiveStateGrantStatus,
  hostOf,
  parseStateGrantSearchRequest,
  stateGrantDeadlineDisplay,
  stateGrantSourceLabel,
  toStateGrantRecordView,
} from "~/lib/state-grants/search";

describe("parseStateGrantSearchRequest", () => {
  test("a missing/empty body is a valid default search", () => {
    for (const body of [undefined, null, {}]) {
      const parsed = parseStateGrantSearchRequest(body);
      expect(parsed.ok).toBe(true);
      if (!parsed.ok) throw new Error("unreachable");
      expect(parsed.params).toEqual({
        stateCodes: [],
        status: null,
        term: null,
        limit: STATE_GRANT_DEFAULT_LIMIT,
        offset: 0,
        limitCapped: false,
      });
    }
  });

  test("a non-object body is rejected", () => {
    for (const body of ["VA", 7, true, ["VA"], "{}"]) {
      const parsed = parseStateGrantSearchRequest(body);
      expect(parsed.ok).toBe(false);
    }
  });

  test("stateCodes must be an array of supported codes; duplicates collapse", () => {
    const ok = parseStateGrantSearchRequest({ stateCodes: ["va", "VA", " dc "] });
    expect(ok.ok).toBe(true);
    if (!ok.ok) throw new Error("unreachable");
    expect(ok.params.stateCodes).toEqual(["VA", "DC"]);

    for (const stateCodes of ["VA", [1], [""], ["XX"], ["ZZ"], ["Virginia"], [null]]) {
      const parsed = parseStateGrantSearchRequest({ stateCodes });
      expect(parsed.ok).toBe(false);
      if (parsed.ok) continue;
      expect(parsed.error.length).toBeGreaterThan(0);
    }
    // An empty array is "no filter", not an error.
    const empty = parseStateGrantSearchRequest({ stateCodes: [] });
    expect(empty.ok).toBe(true);
    if (empty.ok) expect(empty.params.stateCodes).toEqual([]);
  });

  test("status is a closed list; blank means any", () => {
    for (const status of ["open", "forecast", "closed"]) {
      const parsed = parseStateGrantSearchRequest({ status });
      expect(parsed.ok).toBe(true);
      if (parsed.ok) expect(parsed.params.status).toBe(status);
    }
    for (const status of ["", null, undefined]) {
      const parsed = parseStateGrantSearchRequest({ status });
      expect(parsed.ok).toBe(true);
      if (parsed.ok) expect(parsed.params.status).toBeNull();
    }
    for (const status of ["Open", "OPEN", "posted", "expired", 3, {}]) {
      const parsed = parseStateGrantSearchRequest({ status });
      expect(parsed.ok).toBe(false);
    }
  });

  test("term is sanitised and bounded; control characters are stripped", () => {
    const parsed = parseStateGrantSearchRequest({ term: "  tourism\u0007  " });
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) throw new Error("unreachable");
    expect(parsed.params.term).toBe("tourism");

    const blank = parseStateGrantSearchRequest({ term: "   " });
    expect(blank.ok).toBe(true);
    if (blank.ok) expect(blank.params.term).toBeNull();

    // '%' and '_' are literal characters here (the store escapes them), so they
    // survive sanitisation and can never act as wildcards.
    const wildcard = parseStateGrantSearchRequest({ term: "%_" });
    expect(wildcard.ok).toBe(true);
    if (wildcard.ok) expect(wildcard.params.term).toBe("%_");

    for (const term of [42, {}, [], true]) {
      expect(parseStateGrantSearchRequest({ term }).ok).toBe(false);
    }
    const tooLong = parseStateGrantSearchRequest({ term: "x".repeat(STATE_GRANT_SEARCH_MAX_TERM + 1) });
    expect(tooLong.ok).toBe(false);
    const atLimit = parseStateGrantSearchRequest({ term: "x".repeat(STATE_GRANT_SEARCH_MAX_TERM) });
    expect(atLimit.ok).toBe(true);
  });

  test("limit is clamped (and reported), offset must be non-negative", () => {
    const over = parseStateGrantSearchRequest({ limit: 5000 });
    expect(over.ok).toBe(true);
    if (!over.ok) throw new Error("unreachable");
    expect(over.params.limit).toBe(STATE_GRANT_MAX_LIMIT);
    expect(over.params.limitCapped).toBe(true);

    const atCap = parseStateGrantSearchRequest({ limit: STATE_GRANT_MAX_LIMIT });
    expect(atCap.ok).toBe(true);
    if (atCap.ok) {
      expect(atCap.params.limit).toBe(STATE_GRANT_MAX_LIMIT);
      expect(atCap.params.limitCapped).toBe(false);
    }

    for (const limit of [0, -1, 1.5, "10", NaN, Infinity]) {
      expect(parseStateGrantSearchRequest({ limit }).ok).toBe(false);
    }
    const offset = parseStateGrantSearchRequest({ offset: 40 });
    expect(offset.ok).toBe(true);
    if (offset.ok) expect(offset.params.offset).toBe(40);
    for (const bad of [-1, 1.5, "3", NaN]) {
      expect(parseStateGrantSearchRequest({ offset: bad }).ok).toBe(false);
    }
  });
});

describe("read-time freshness", () => {
  test("easternDayString uses the US Eastern day boundary", () => {
    // 02:00Z on 09-19 is still 09-18 in ET (22:00 the previous evening).
    expect(easternDayString(new Date("2026-09-19T02:00:00Z"))).toBe("2026-09-18");
    expect(easternDayString(new Date("2026-09-19T12:00:00Z"))).toBe("2026-09-19");
    expect(easternDayString(new Date("2026-01-01T04:30:00Z"))).toBe("2025-12-31");
  });

  test("an open row whose deadline passed is served closed; nothing else moves", () => {
    expect(effectiveStateGrantStatus({ status: "open", closeDate: "2026-09-18" }, "2026-09-19")).toBe(
      "closed",
    );
    // The deadline DAY itself is still open (federal rule, reused).
    expect(effectiveStateGrantStatus({ status: "open", closeDate: "2026-09-19" }, "2026-09-19")).toBe(
      "open",
    );
    expect(effectiveStateGrantStatus({ status: "open", closeDate: "2026-09-20" }, "2026-09-19")).toBe(
      "open",
    );
    // An ongoing program has no deadline to expire.
    expect(effectiveStateGrantStatus({ status: "open", closeDate: null }, "2030-01-01")).toBe("open");
    // Forecasts and closed rows are never moved by the calendar: a forecast's
    // date is an estimate and only the source can close a cycle.
    expect(
      effectiveStateGrantStatus({ status: "forecast", closeDate: null }, "2030-01-01"),
    ).toBe("forecast");
    expect(effectiveStateGrantStatus({ status: "closed", closeDate: "2020-01-01" }, "2030-01-01")).toBe(
      "closed",
    );
  });
});

describe("display rules", () => {
  test("a forecast's date is always labelled an estimate and never a deadline", () => {
    const display = stateGrantDeadlineDisplay({
      status: "forecast",
      closeDate: null,
      estimatedCloseDate: "2026-10-29",
    });
    expect(display?.label).toBe("Estimated application deadline");
    expect(display?.value).toBe(`2026-10-29 (${FORECAST_ESTIMATE_NOTE})`);
    expect(display?.value).toContain("not a posted closing date");
    // A forecast the source published without dates shows no date at all.
    expect(
      stateGrantDeadlineDisplay({ status: "forecast", closeDate: null, estimatedCloseDate: null }),
    ).toBeNull();
  });

  test("open/closed rows show a closing date, or say it is not specified", () => {
    expect(
      stateGrantDeadlineDisplay({ status: "open", closeDate: "2026-12-31", estimatedCloseDate: null }),
    ).toEqual({ label: "Closing date", value: "2026-12-31" });
    const ongoing = stateGrantDeadlineDisplay({
      status: "open",
      closeDate: null,
      estimatedCloseDate: null,
    });
    expect(ongoing?.label).toBe("Deadline");
    expect(ongoing?.value).toContain("Not specified");
    expect(
      stateGrantDeadlineDisplay({ status: "closed", closeDate: null, estimatedCloseDate: null })?.value,
    ).toBe(NOT_SPECIFIED);
  });

  test("the source label is the publisher plus the official host", () => {
    expect(
      stateGrantSourceLabel({
        stateCode: "VA",
        stateName: "Virginia",
        agency: "Virginia Tourism Corporation",
        sourceUrl: "https://www.vatc.org/grants/",
      }),
    ).toBe("Virginia Tourism Corporation — vatc.org");
    // No published agency → the state's own name, never an invented department.
    expect(
      stateGrantSourceLabel({
        stateCode: "VA",
        stateName: "Virginia",
        agency: null,
        sourceUrl: "https://www.vatc.org/grants/",
      }),
    ).toBe("Virginia — vatc.org");
    expect(
      stateGrantSourceLabel({
        stateCode: "VA",
        stateName: "Virginia",
        agency: NOT_SPECIFIED,
        sourceUrl: "not a url",
      }),
    ).toBe(`Virginia — ${NOT_SPECIFIED}`);
    expect(hostOf("https://vatc.org/grants/")).toBe("vatc.org");
  });

  test("counts are described honestly for every status", () => {
    expect(describeStateGrantCount("open", 1, true)).toBe("1 record open for applications");
    expect(describeStateGrantCount("open", 2, true)).toBe("2 records open for applications");
    expect(describeStateGrantCount("forecast", 3, true)).toContain("forecast — not yet open");
    expect(describeStateGrantCount("closed", 4, true)).toBe("4 closed records");
    expect(describeStateGrantCount(null, 8, true)).toBe("8 stored records");
    expect(describeStateGrantCount(null, 1000, false)).toBe("1,000+ stored records");
  });
});

describe("toStateGrantRecordView", () => {
  const row = {
    id: "row-1",
    stateCode: "VA",
    externalId: "demo",
    title: "Demo Program",
    agency: "Virginia Tourism Corporation",
    summary: " ",
    status: "open" as const,
    postedDate: "2026-01-05",
    closeDate: "2026-12-31",
    estimatedCloseDate: null,
    url: "https://www.vatc.org/grants/demo/",
    sourceUrl: "https://www.vatc.org/grants/",
    sourceUpdatedAt: null,
    fetchedAt: "2026-09-19T12:00:03.000Z",
  };

  test("maps a stored row with the honest labels and the read-time status", () => {
    const view = toStateGrantRecordView(row, "Virginia", "2026-09-19");
    expect(view.stateName).toBe("Virginia");
    expect(view.status).toBe("open");
    expect(view.statusLabel).toContain("Open");
    expect(view.sourceLabel).toBe("Virginia Tourism Corporation — vatc.org");
    expect(view.deadline).toEqual({ label: "Closing date", value: "2026-12-31" });
    expect(view.summary).toBe(NOT_SPECIFIED);
    expect(view.sourceUpdatedAt).toBeNull();

    const later = toStateGrantRecordView(row, "Virginia", "2027-02-01");
    expect(later.status).toBe("closed");
    expect(later.statusLabel).toBe("Closed");
  });

  test("a forecast can never carry a real closing date through the mapping", () => {
    const view = toStateGrantRecordView(
      {
        ...row,
        status: "forecast",
        closeDate: "2026-12-31",
        estimatedCloseDate: "2026-12-31",
      },
      "Virginia",
      "2026-09-19",
    );
    expect(view.closeDate).toBeNull();
    expect(view.estimatedCloseDate).toBe("2026-12-31");
    expect(view.deadline?.label).toBe("Estimated application deadline");
    expect(view.deadline?.value).toContain(FORECAST_ESTIMATE_NOTE);
  });
});
