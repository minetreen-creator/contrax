import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { gunzipSync } from "node:zlib";
import { GDOT_LETTING_COLUMNS, GDOT_LETTING_SOURCE, gdotForecastRecord, georgiaFiscalYear, parseGdotLetting } from "./gdot-letting";

// Owner 2026-11-08 ("Add as 'Upcoming'"): GDOT's public Project Letting by Month dashboard, captured
// 2026-11-08 12:20 UTC in headless Chrome (anonymous, no sign-in), page "Processed on: Nov-08-2026".
const html = gunzipSync(readFileSync(new URL("./fixtures/gdot/letting-by-month-2026-11-08.html.gz", import.meta.url))).toString("utf8");
const CAPTURED = "2026-11-08T12:20:00Z";

describe("Georgia DOT planned lettings", () => {
  const parsed = parseGdotLetting(html, CAPTURED);

  test("six months, each adding up to GDOT's own Month Total", () => {
    expect(parsed.processedOn).toBe("2026-11-08");
    expect(parsed.months).toEqual([
      { letMonth: "2026-11", letLabel: "Nov 2026", projects: 22, total: 79_200_000 },
      { letMonth: "2026-12", letLabel: "Dec 2026", projects: 35, total: 197_500_000 },
      { letMonth: "2027-01", letLabel: "Jan 2027", projects: 31, total: 184_100_000 },
      { letMonth: "2027-02", letLabel: "Feb 2027", projects: 36, total: 123_440_000 },
      { letMonth: "2027-03", letLabel: "Mar 2027", projects: 26, total: 192_000_000 },
      { letMonth: "2027-04", letLabel: "Apr 2027", projects: 26, total: 180_700_000 },
    ]);
    expect(parsed.projects.length).toBe(176);
  });

  test("rows read by column, as the page prints them", () => {
    expect(parsed.projects[0]).toEqual({
      projectId: "0016573", letMonth: "2026-11", letLabel: "Nov 2026",
      description: "CR 147/MURPHY MILL ROAD @ MURPHYS MILL POND", county: "Sumter", workType: "Bridges",
      letBy: "DOT", sponsor: "GDOT", estimatedCost: 2_000_000,
    });
    expect(parsed.projects.find((p) => p.projectId === "M006532")?.description).toBe("BRIDGE PRESERVATION @ 6 LOCS IN COWETA; FAYETTE & TROUP");
    expect(parsed.projects.find((p) => p.projectId === "122060-")?.estimatedCost).toBe(60_000_000);
  });

  test("a forecast row, never a bid: planned month, Georgia fiscal year, honest wording", () => {
    const r = gdotForecastRecord(parsed.projects[0], parsed.processedOn);
    expect(r.source).toBe(GDOT_LETTING_SOURCE);
    expect(r.external_id).toBe("0016573");
    expect(r.fiscal_year).toBe(2027);
    expect(r.fiscal_quarter).toBe("Nov 2026");
    expect(r.description).toContain("This is a forecast, not a bid notice");
    expect(r.payload).toMatchObject({ kind: "dot-letting", state: "GA", county: "Sumter", letBy: "GDOT", estimatedCost: 2_000_000 });
    const local = parsed.projects.find((p) => p.letBy === "LOC");
    if (local) expect(gdotForecastRecord(local, parsed.processedOn).payload.letBy).toBe("Local government");
  });

  test("Georgia's fiscal year starts July 1", () => {
    expect(georgiaFiscalYear("2026-06")).toBe(2026);
    expect(georgiaFiscalYear("2026-07")).toBe(2027);
    expect(georgiaFiscalYear("2027-04")).toBe(2027);
  });

  test("refuses a stale, reshaped or inconsistent page instead of half-reading it", () => {
    expect(() => parseGdotLetting(html, "2026-12-01T12:00:00Z")).toThrow(/Stale forecast/);
    expect(() => parseGdotLetting("<html>Maintenance</html>", CAPTURED)).toThrow(/Page shape changed/);
    expect(() => parseGdotLetting(html.replace(">Total Estimated Cost<", ">Cost<"), CAPTURED)).toThrow(/columns/);
    expect(() => parseGdotLetting(html.replace(">$79,200,000<", ">$79,300,000<"), CAPTURED)).toThrow(/add up/);
    expect(GDOT_LETTING_COLUMNS.length).toBe(7);
  });
});
