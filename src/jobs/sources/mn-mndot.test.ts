/**
 * MnDOT lettings (`mn_mndot`) connector pins. Zero network, no database: the
 * fixture holds the verbatim advertisement grids captured 2026-10-05 (gzipped;
 * see fixtures/mn-mndot/README.md); `now` is injected.
 */
import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { gunzipSync } from "node:zlib";
import { deriveInsertLocationColumns } from "~/lib/location-state";
import { SOURCE_CLASSES } from "~/lib/source-class";
import { TAIL_SOURCES } from "../runner";
import { mnDotDueMs, mnDotFormBody, mnDotLettingDates, mnDotTitle, parseMnDot, parseMnDotGrid } from "./mn-mndot";

const GRIDS: Record<string, string> = JSON.parse(
  gunzipSync(readFileSync(new URL("./fixtures/mn-mndot/advertised-2026-10-05.json.gz", import.meta.url))).toString("utf8"),
);
const PROJECTS = Object.entries(GRIDS).flatMap(([date, html]) => parseMnDotGrid(html, date));
const CAPTURED = Date.parse("2026-10-05T20:00:00Z");

describe("mn_mndot — parse (captured grids)", () => {
  test("five lettings, 13 projects, all accepted", () => {
    expect(Object.keys(GRIDS).length).toBe(5);
    expect(PROJECTS.length).toBe(13);
    const { rows, skipped } = parseMnDot(PROJECTS, CAPTURED);
    expect(skipped).toEqual({});
    expect(rows.length).toBe(13);
    for (const r of rows) {
      expect(r.external_id).toMatch(/^mnmndot-\d+$/);
      expect(r.agency).toBe("Minnesota Department of Transportation (MnDOT)");
      expect(r.location).toBe("Minnesota");
      expect(r.category).toBe("Construction");
      expect(r.title.length).toBeLessThanOrEqual(141);
      expect(r.source_url).toMatch(/^https:\/\/transport\.dot\.state\.mn\.us\/PreLetting\/propItem\.aspx\?ProposalId=\d+$/);
      const cols = deriveInsertLocationColumns({ location: r.location, agency: r.agency, title: r.title, description: r.description, sourceName: "mn_mndot" });
      expect(cols.source_jurisdiction).toBe("MN");
      expect(cols.normalized_state).toBe("MN");
    }
  });

  test("a row reads as the grid lists it", () => {
    const r = parseMnDot(PROJECTS, CAPTURED).rows.find((x) => x.external_id === "mnmndot-260121")!;
    expect(r.title).toBe("In Olmsted County on TH 14 at Broadway Ave. Grading, Concrete & Bituminous Surfacing, ADA Improvements, Signals, Lighting, and TMS 0.463…");
    expect(r.solicitation_number).toBe("5502-109");
    // Letting 10/28/2026, no time listed → 11:59 PM CDT.
    expect(r.due_date).toBe("2026-10-29T04:59:00.000Z");
    expect(r.description).toContain("Olmsted County");
    expect(r.description).toContain("DBE goal 8.50%");
  });

  test("a passed letting is never accepted; a repeat is skipped", () => {
    expect(parseMnDot(PROJECTS.slice(0, 1), Date.parse("2026-12-01T00:00:00Z")).skipped).toEqual({ closed: 1 });
    expect(parseMnDot([PROJECTS[0], PROJECTS[0]], CAPTURED).skipped).toEqual({ duplicate: 1 });
  });
});

describe("mn_mndot — helpers", () => {
  test("dates, form and title", () => {
    expect(mnDotDueMs("11/10/2026")).toBe(Date.parse("2026-11-11T05:59:00Z")); // CST after Nov 1
    expect(mnDotDueMs("soon")).toBeNaN();
    const page = `<select name="ctl00$MainContent$drpAdForCurLetting" id="MainContent_drpAdForCurLetting"><option selected="selected" value="10/13/2026">10/13/2026</option><option value="10/21/2026">10/21/2026</option></select><input type="hidden" name="__VIEWSTATE" id="__VIEWSTATE" value="abc" />`;
    expect(mnDotLettingDates(page)).toEqual(["10/13/2026", "10/21/2026"]);
    const body = new URLSearchParams(mnDotFormBody(page, "10/21/2026"));
    expect(body.get("__VIEWSTATE")).toBe("abc");
    expect(body.get("ctl00$MainContent$drpAdForCurLetting")).toBe("10/21/2026");
    expect(body.get("ctl00$MainContent$drpDistrict")).toBe("ALL");
    expect(mnDotTitle("3403-84 (TH 12=010) STATE FUNDS In Kandiyohi on TH 12 at CSAH 55. Grading and Drainage.")).toBe("In Kandiyohi on TH 12 at CSAH 55. Grading and Drainage.");
  });

  test("registration", () => {
    expect(TAIL_SOURCES.some((s) => s.name === "mn_mndot")).toBe(true);
    expect(SOURCE_CLASSES.mn_mndot).toEqual({ class: "state", scopeState: "MN", searchScope: "state-portal", recordType: "opportunity" });
  });
});
