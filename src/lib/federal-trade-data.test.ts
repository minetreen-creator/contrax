import { describe, expect, test } from "bun:test";
import {
  addMonths,
  agencyRequestBody,
  FEDERAL_TRADE_NAICS,
  fiscalYearLabel,
  fiscalYearRange,
  formatDollars,
  geographyRequestBody,
  lastCompleteFiscalYear,
  parseAgencies,
  parseGeography,
  pickRecompetes,
  recompeteRequestBody,
  recompetesHref,
  RECOMPETE_AMOUNT_BANDS,
  walkComplete,
  setAsideShare,
  toRecompete,
} from "~/lib/federal-trade-data";
import { SEO_TRADES } from "~/lib/seo-trades";

const row = (end: string, extra: Record<string, unknown> = {}) => ({
  "Award ID": "W91247-24-C-0001",
  "Recipient Name": "Acme Cleaning LLC",
  "Recipient UEI": "ABC123",
  "Award Amount": 480_000.4,
  "Start Date": "2024-03-01",
  "End Date": end,
  "Awarding Agency": "Department of Defense",
  "Awarding Sub Agency": "Department of the Army",
  Description: "JANITORIAL SERVICES, FORT LEE",
  "Place of Performance State Code": "va",
  NAICS: { code: "561720", description: "JANITORIAL SERVICES" },
  generated_internal_id: `CONT_AWD_${end}`,
  ...extra,
});

describe("trade NAICS map", () => {
  test("every SEO trade has codes; construction uses its own list", () => {
    for (const t of SEO_TRADES) expect(FEDERAL_TRADE_NAICS[t.slug]?.length).toBeGreaterThan(0);
    expect(FEDERAL_TRADE_NAICS.janitorial).toEqual(["561720"]);
    expect(FEDERAL_TRADE_NAICS.construction).toContain("236220");
    for (const codes of Object.values(FEDERAL_TRADE_NAICS)) for (const c of codes) expect(c).toMatch(/^\d{6}$/);
  });
});

describe("dates", () => {
  test("addMonths clamps to the end of short months", () => {
    expect(addMonths("2026-10-13", 18)).toBe("2028-04-13");
    expect(addMonths("2026-01-31", 1)).toBe("2026-02-28");
    expect(addMonths("2026-10-13", -48)).toBe("2022-10-13");
  });

  test("a fiscal year counts as complete from the January after it ends", () => {
    expect(lastCompleteFiscalYear("2026-10-13")).toBe(2025);
    expect(lastCompleteFiscalYear("2026-12-31")).toBe(2025);
    expect(lastCompleteFiscalYear("2027-01-01")).toBe(2026);
    expect(fiscalYearRange(2025)).toEqual({ start_date: "2024-10-01", end_date: "2025-09-30" });
    expect(fiscalYearLabel(2025)).toBe("October 2024 to September 2025");
  });
});

describe("contracts ending soon", () => {
  test("request walks definitive contracts by end date, latest first", () => {
    const b = recompeteRequestBody(["561720"], 3, "2026-10-13");
    expect(b.filters.award_type_codes).toEqual(["A", "B", "C", "D"]);
    expect(b.filters.naics_codes).toEqual(["561720"]);
    expect(b.filters.time_period).toEqual([{ start_date: "2022-10-13", end_date: "2026-10-13" }]);
    expect(b.sort).toBe("End Date");
    expect(b.order).toBe("desc");
    expect(b.fields).toContain("End Date");
    expect(b.page).toBe(3);
  });

  test("walks are split into whole-dollar contract-size bands with no gaps from $25,000 up", () => {
    expect(RECOMPETE_AMOUNT_BANDS[0].lower_bound).toBe(25_000);
    for (let i = 0; i < RECOMPETE_AMOUNT_BANDS.length; i++) {
      const b = RECOMPETE_AMOUNT_BANDS[i];
      expect(Number.isInteger(b.lower_bound)).toBe(true);
      if (b.upper_bound !== undefined) expect(Number.isInteger(b.upper_bound)).toBe(true);
      if (i > 0) expect(b.lower_bound).toBe(RECOMPETE_AMOUNT_BANDS[i - 1].upper_bound!);
    }
    expect(RECOMPETE_AMOUNT_BANDS[RECOMPETE_AMOUNT_BANDS.length - 1].upper_bound).toBeUndefined();
    const b = recompeteRequestBody(["236220"], 1, "2026-10-13", RECOMPETE_AMOUNT_BANDS[1]);
    expect(b.filters.award_amounts).toEqual([{ lower_bound: 100_000, upper_bound: 1_000_000 }]);
  });

  test("a walk that ran into the 10,000-result cap is not complete", () => {
    expect(walkComplete(true, true, 7)).toBe(true);
    expect(walkComplete(false, false, 12)).toBe(true);
    expect(walkComplete(false, false, 100)).toBe(false);
  });

  test("a row parses with object NAICS and uppercased state", () => {
    const c = toRecompete(row("2027-06-30"), "janitorial");
    expect(c).toMatchObject({
      trade_slug: "janitorial",
      amount: 480_000,
      end_date: "2027-06-30",
      pop_state: "VA",
      naics_code: "561720",
      naics_description: "JANITORIAL SERVICES",
    });
  });

  test("rows without a holder, end date or under $25,000 are dropped", () => {
    expect(toRecompete(row("2027-06-30", { "Recipient Name": " " }), "j")).toBeNull();
    expect(toRecompete(row("2027-06-30", { "End Date": null }), "j")).toBeNull();
    expect(toRecompete(row("2027-06-30", { "Award Amount": 24_999 }), "j")).toBeNull();
  });

  test("a page keeps the window and stops at dates before today", () => {
    const page = [row("2029-01-01"), row("2028-01-15"), row("2026-10-13"), row("2026-10-12")];
    const r = pickRecompetes(page, "janitorial", "2026-10-13", "2028-04-13");
    expect(r.kept.map((k) => k.end_date)).toEqual(["2028-01-15", "2026-10-13"]);
    expect(r.done).toBe(true);
    expect(pickRecompetes([row("2029-01-01")], "j", "2026-10-13", "2028-04-13")).toEqual({ kept: [], done: false });
    expect(pickRecompetes([], "j", "2026-10-13", "2028-04-13").done).toBe(true);
  });

  test("deep link", () => {
    expect(recompetesHref("janitorial", "VA")).toBe("/recompetes?trade=janitorial&months=12&state=VA");
  });
});

describe("spending figures", () => {
  test("geography request: by place of performance, set-aside filter only when asked", () => {
    const all = geographyRequestBody(["238220"], 2025, false);
    expect(all.scope).toBe("place_of_performance");
    expect(all.geo_layer).toBe("state");
    expect(all.filters.time_period).toEqual([{ start_date: "2024-10-01", end_date: "2025-09-30" }]);
    expect("set_aside_type_codes" in all.filters).toBe(false);
    const sb = geographyRequestBody(["238220"], 2025, true) as { filters: Record<string, unknown> };
    expect(sb.filters.set_aside_type_codes).toContain("SDVOSBC");
  });

  test("geography and agency results parse defensively", () => {
    const m = parseGeography([
      { shape_code: "VA", aggregated_amount: 1_200_000 },
      { shape_code: "XX1", aggregated_amount: 5 },
      { shape_code: "md", aggregated_amount: "300" },
    ]);
    expect([...m.entries()]).toEqual([["VA", 1_200_000], ["MD", 300]]);
    expect(parseGeography(null).size).toBe(0);
    expect(
      parseAgencies([
        { name: "Department of Defense", amount: 900 },
        { name: "", amount: 5 },
        { name: "GSA", amount: -10 },
        { name: "VA", amount: 100 },
      ]),
    ).toEqual([{ name: "Department of Defense", amount: 900 }, { name: "VA", amount: 100 }]);
    expect(agencyRequestBody(["561720"], 2025, "VA").filters.place_of_performance_locations).toEqual([{ country: "USA", state: "VA" }]);
  });

  test("set-aside share and dollar formatting", () => {
    expect(setAsideShare({ total_amount: 1_000_000, set_aside_amount: 420_000 })).toBe(42);
    expect(setAsideShare({ total_amount: 100, set_aside_amount: 150 })).toBe(100);
    expect(setAsideShare({ total_amount: 0, set_aside_amount: 0 })).toBeNull();
    expect(formatDollars(12_345_678)).toBe("$12.3 million");
    expect(formatDollars(2_100_000_000)).toBe("$2.1 billion");
    expect(formatDollars(48_000)).toBe("$48,000");
  });
});

// Owner 2026-11-16 ("b"): much federal janitorial work is held by nonprofits under a program that
// reserves it by law, so "contracts ending" overstated what a cleaning company can go and win.
describe("contracts awarded without open bidding", () => {
  test("the marking walk asks only for the not-competed codes; the main walk does not filter", async () => {
    const { recompeteRequestBody, NOT_COMPETED_CODES } = await import("./federal-trade-data");
    const main = recompeteRequestBody(["561720"], 1, "2026-11-16");
    expect("extent_competed_type_codes" in main.filters).toBe(false);
    const marked = recompeteRequestBody(["561720"], 1, "2026-11-16", { lower_bound: 25_000 }, true);
    expect((marked.filters as { extent_competed_type_codes?: string[] }).extent_competed_type_codes).toEqual([...NOT_COMPETED_CODES]);
    expect(NOT_COMPETED_CODES).toEqual(["B", "C", "G", "NDO"]);
    expect(marked.filters.naics_codes).toEqual(main.filters.naics_codes);
  });

  test("the note states the count, the dollars and what is left, and stays silent when unknown", async () => {
    const { notCompetedNote } = await import("./federal-trade-data");
    expect(notCompetedNote({ n: 82, notCompeted: 0, notCompetedTotal: 0, competitionKnown: true })).toBeNull();
    expect(notCompetedNote({ n: 82, notCompeted: 30, notCompetedTotal: 5e7, competitionKnown: false })).toBeNull();
    expect(notCompetedNote({ n: 82 })).toBeNull();
    const note = notCompetedNote({ n: 82, notCompeted: 30, notCompetedTotal: 60_000_000, competitionKnown: true })!;
    expect(note).toContain("30 of these 82 contracts");
    expect(note).toContain("awarded without open bidding");
    expect(note).toContain("That leaves 52 that were competed.");
    const all = notCompetedNote({ n: 4, notCompeted: 4, notCompetedTotal: 1e6, competitionKnown: true })!;
    expect(all.startsWith("All 4 of these contracts were")).toBe(true);
    expect(all).not.toContain("That leaves");
  });

  test("the sync marks rows, keeps an earlier mark when a walk fails, and the report counts them", () => {
    const { readFileSync } = require("node:fs") as typeof import("node:fs");
    const server = readFileSync("src/lib/federal-trade-data.server.ts", "utf8");
    expect(server).toContain("ADD COLUMN IF NOT EXISTS not_competed BOOLEAN");
    expect(server).toContain("notCompetedKeys.has(k.award_key) ? true : marked ? false : null");
    expect(server).toContain("COALESCE(EXCLUDED.not_competed, recompete_contracts.not_competed)");
    const report = readFileSync("src/lib/pipeline-report-data.server.ts", "utf8");
    expect(report).toContain("COUNT(*) FILTER (WHERE not_competed)");
    for (const page of ["src/routes/sample-report.tsx", "src/routes/contracts-ending/$state.$trade.tsx"]) {
      expect(readFileSync(page, "utf8")).toContain("notCompetedNote(");
    }
  });
});
