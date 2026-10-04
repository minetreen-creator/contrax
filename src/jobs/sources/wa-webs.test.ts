/**
 * Washington WEBS bid calendar (`wa_webs`) connector pins. Zero network, no
 * database: the fixtures are the list pages captured 2026-10-04 (gzipped; see
 * fixtures/wa-webs/README.md); `now` is injected.
 */
import { describe, expect, test } from "bun:test";
import { readdirSync, readFileSync } from "node:fs";
import { gunzipSync } from "node:zlib";
import { deriveInsertLocationColumns } from "~/lib/location-state";
import { SOURCE_CLASSES } from "~/lib/source-class";
import { TAIL_SOURCES } from "../runner";
import {
  parseWaCloseDate,
  parseWaPages,
  waFormFields,
  waNextPageTarget,
  waOrganizations,
  waRowIds,
  WA_WEBS_FALLBACK_AGENCY,
} from "./wa-webs";

const DIR = new URL("./fixtures/wa-webs/", import.meta.url);
const load = (name: string) => gunzipSync(readFileSync(new URL(name, DIR))).toString("utf8");
const PAGES = [0, 1, 2, 3, 4, 5].map((i) => load(`open-page${i}-2026-10-04.html.gz`));
const ORGS = waOrganizations(PAGES[0]);
const AGENCIES = (() => {
  const names = new Map(ORGS);
  const map = new Map<string, string[]>();
  for (const f of readdirSync(DIR).filter((f) => f.startsWith("org-")).sort()) {
    const name = names.get(f.split("-")[1])!;
    for (const id of waRowIds(load(f))) map.set(id, [...(map.get(id) ?? []), name]);
  }
  return map;
})();
const CAPTURED = Date.parse("2026-10-04T19:00:00Z");

describe("wa_webs — parse (captured pages)", () => {
  test("127 listed on 6 pages; the 2 selective bids are skipped", () => {
    const ids = PAGES.flatMap(waRowIds);
    expect(ids.length).toBe(127);
    expect(new Set(ids).size).toBe(127);
    const { rows, skipped } = parseWaPages(PAGES, AGENCIES, CAPTURED);
    expect(skipped).toEqual({ selective: 2 });
    expect(rows.length).toBe(125);
    for (const r of rows) {
      expect(r.external_id).toMatch(/^wa-webs:\d+$/);
      expect(r.solicitation_number!.length).toBeGreaterThan(0);
      expect(r.location).toBe("Washington");
      expect(r.agency).not.toBe(WA_WEBS_FALLBACK_AGENCY);
      expect(r.description).not.toMatch(/[<>]/);
      expect(Date.parse(r.due_date!)).toBeGreaterThan(CAPTURED);
      expect(r.source_url).toMatch(/^https:\/\/pr-webs-vendor\.des\.wa\.gov\/Search_BidDetails\.aspx\?ID=\d+$/);
      const cols = deriveInsertLocationColumns({ location: r.location, agency: r.agency, title: r.title, description: r.description, sourceName: "wa_webs" });
      expect(cols.source_jurisdiction).toBe("WA");
      expect(cols.normalized_state).toBe("WA");
    }
  });

  test("a row reads as the board shows it", () => {
    const r = parseWaPages(PAGES, AGENCIES, CAPTURED).rows.find((x) => x.external_id === "wa-webs:57441")!;
    expect(r.title).toBe("WSDOT SWR HQ HVAC controls upgrade");
    expect(r.solicitation_number).toBe("SWR2603");
    expect(r.agency).toBe("Transportation, Dept of");
    expect(r.due_date).toBe("2026-10-06T06:59:00.000Z"); // 10/05/26 11:59 PM PDT
    expect(r.description.startsWith("The purpose of this solicitation")).toBe(true);
    expect(r.description).toContain("replace the existing Honeywell LON-based building automation system");
    expect(r.description).toContain("Pre-bid conference: 08/26/26 10:00.");
    expect(r.description).toContain("Deadline for questions: 08/27/26.");
    expect(r.description).toContain("Last amended 09/22/26.");
    expect(r.source_url).toBe("https://pr-webs-vendor.des.wa.gov/Search_BidDetails.aspx?ID=57441");
  });

  test("every bid maps to exactly one organization from the filter passes", () => {
    expect(ORGS.length).toBe(42);
    const ids = PAGES.flatMap(waRowIds);
    for (const id of ids) expect(AGENCIES.get(id)?.length).toBe(1);
    expect(AGENCIES.size).toBe(ids.length);
  });

  test("a bid no organization lists keeps an honest placeholder agency", () => {
    const r = parseWaPages(PAGES, new Map(), CAPTURED).rows[0];
    expect(r.agency).toBe(WA_WEBS_FALLBACK_AGENCY);
  });

  test("passed close dates are skipped as closed", () => {
    const { rows, skipped } = parseWaPages(PAGES, AGENCIES, Date.parse("2026-10-06T12:00:00Z"));
    expect(skipped.closed).toBeGreaterThan(0);
    expect(rows.length + skipped.closed + skipped.selective).toBe(127);
  });

  test("close dates are read as 11:59 PM Pacific", () => {
    expect(parseWaCloseDate("10/05/26")).toBe(Date.parse("2026-10-05T23:59:00-07:00"));
    expect(parseWaCloseDate("12/01/26")).toBe(Date.parse("2026-12-01T23:59:00-08:00"));
    expect(parseWaCloseDate("13/01/26")).toBeNaN();
    expect(parseWaCloseDate("soon")).toBeNaN();
  });

  test("pager: next target on each page, none on the last", () => {
    expect(waNextPageTarget(PAGES[0])).toBe("DataGrid1$_ctl29$_ctl1");
    expect(waNextPageTarget(PAGES[4])).not.toBeNull();
    expect(waNextPageTarget(PAGES[5])).toBeNull();
  });

  test("form fields carry the view state and no event target", () => {
    const fields = waFormFields(PAGES[0]);
    expect(fields.filter(([k]) => k === "__VIEWSTATE").length).toBe(1);
    expect(fields.some(([k]) => k === "__EVENTVALIDATION")).toBe(true);
    expect(fields.some(([k]) => k === "__EVENTTARGET")).toBe(false);
  });

  test("registered as a Washington state source", () => {
    expect(TAIL_SOURCES.some((s) => s.name === "wa_webs")).toBe(true);
    expect(SOURCE_CLASSES.wa_webs?.scopeState).toBe("WA");
  });
});
