import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { gunzipSync } from "node:zlib";
import { parseNcWayneCountyBoard, waynePublishedDeadline } from "./nc-wayne-county";
import { TAIL_SOURCES } from "../runner";
import { SOURCE_HOME_JURISDICTIONS } from "~/lib/location-state";
import { SOURCE_CLASSES } from "~/lib/source-class";
import { AGENCY_BY_SLUG, findPlace } from "~/lib/local-agencies";
import { isCountdownSuppressed } from "~/lib/deadline-label";
const board = gunzipSync(readFileSync(new URL("./fixtures/nc-wayne-county/bids-2026-10-15.html.gz", import.meta.url))).toString();
describe("Wayne County official board", () => {
  test("captures both open notices with stable county identity and official links", () => {
    const result = parseNcWayneCountyBoard(board, Date.parse("2026-10-15T12:00:00Z"));
    expect(result.rows.map(r => r.external_id)).toEqual(["nc-waynecounty-200", "nc-waynecounty-199"]);
    expect(result.rows.map(r => r.due_date)).toEqual(["2026-11-05T19:00:00.000Z", "2026-10-15T18:00:00.000Z"]);
    for (const row of result.rows) {
      expect(row.agency).toBe("Wayne County");
      expect(row.location).toBe("Wayne County, NC");
      expect(row.source_url).toMatch(/^https:\/\/www\.waynegov\.com\/Bids\.aspx\?bidID=\d+$/);
      expect(row.set_aside).toBeNull();
    }
  });
  test("expired notices drop; changed page shape never appears to be coverage", () => {
    expect(parseNcWayneCountyBoard(board, Date.parse("2026-10-16T12:00:00Z")).rows.map(r => r.external_id)).toEqual(["nc-waynecounty-200"]);
    const invalid = parseNcWayneCountyBoard("Access denied", 0);
    expect(invalid.rows).toEqual([]);
    expect(invalid.skipped.shape_change).toBe(1);
  });
  test("published clock survives; unknown and impossible dates remain unknown", () => {
    expect(waynePublishedDeadline("11/5/2026 2:00 PM")).toBe("2026-11-05T19:00:00.000Z");
    expect(waynePublishedDeadline("11/5/2026 12:00 AM")).toBe("2026-11-05T05:00:00.000Z");
    for (const text of ["Upon Contract", "2/30/2026 2:00 PM", "11/5/2026 13:00 PM"]) expect(waynePublishedDeadline(text)).toBeNull();
    expect(isCountdownSuppressed("nc_wayne_county")).toBe(true);
  });
  test("registered for sync, NC provenance, and public local directory", () => {
    expect(TAIL_SOURCES.some(s => s.name === "nc_wayne_county")).toBe(true);
    expect(SOURCE_HOME_JURISDICTIONS.nc_wayne_county).toBe("NC");
    expect(SOURCE_CLASSES.nc_wayne_county.class).toBe("local");
    expect(AGENCY_BY_SLUG["wayne-county-nc"].source).toBe("nc_wayne_county");
    expect(findPlace("north-carolina", "wayne-county")?.agencies.some(a => a.source === "nc_wayne_county")).toBe(true);
  });
});
