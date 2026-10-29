import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { TAIL_SOURCES } from "../runner";
import { SOURCE_CLASSES } from "~/lib/source-class";
import { SOURCE_HOME_JURISDICTIONS, deriveInsertLocationColumns } from "~/lib/location-state";
import { miamiDadeDateToIso, miamiDadeDetailUrl, miamiDadeRow, parseMiamiDadeList } from "./fl-miami-dade";

const fixture = readFileSync(new URL("./fixtures/fl-miami-dade/list-2026-10-29.json", import.meta.url), "utf8");
const now = Date.parse("2026-10-29T14:00:00Z");

describe("Miami-Dade County construction solicitations", () => {
  test("feed: 22 solicitations with number, type, title and dates", () => {
    const sols = parseMiamiDadeList(fixture);
    expect(sols).toHaveLength(22);
    expect(sols[1]).toEqual({
      solicitationNumber: "RPQ No PDC-W25012",
      solicitationType: "Bids & Contracts",
      title: "MDSO Headquarters Building Roofing and Waterproofing",
      openingDate: "10/29/2026",
      postedDate: "09/21/2026",
    });
    expect(() => parseMiamiDadeList("<html>")).toThrow();
    expect(() => parseMiamiDadeList('{"a":1}')).toThrow();
  });

  test("opening day ends at 23:59 Miami time, DST-aware", () => {
    expect(miamiDadeDateToIso("10/29/2026")).toBe("2026-10-30T03:59:00.000Z"); // EDT
    expect(miamiDadeDateToIso("12/02/2026")).toBe("2026-12-03T04:59:00.000Z"); // EST
    expect(miamiDadeDateToIso("")).toBeNull();
    expect(miamiDadeDateToIso("13/01/2026")).toBeNull();
  });

  test("rows: all 22 open on capture day, placed in Miami-Dade, linked to the notice", () => {
    const rows = parseMiamiDadeList(fixture).map((s) => miamiDadeRow(s, now));
    expect(rows.filter((r) => "skip" in r)).toHaveLength(0);
    const row = rows[1];
    if ("skip" in row) throw new Error("expected a row");
    expect(row.external_id).toBe("miamidade-RPQ No PDC-W25012");
    expect(row.agency).toBe("Miami-Dade County");
    expect(row.location).toBe("Miami-Dade County, FL");
    expect(row.source_url).toBe(miamiDadeDetailUrl("RPQ No PDC-W25012"));
    expect(row.source_url).toBe("https://www.miamidade.gov/apps/ISD/stratproc/Home/SolicitationDetails?solNumber=RPQ%20No%20PDC-W25012");
    expect(row.due_date).toBe("2026-10-30T03:59:00.000Z");
    expect(deriveInsertLocationColumns({ ...row, sourceName: "fl_miami_dade" }).normalized_state).toBe("FL");
    const ae = rows.find((r) => !("skip" in r) && r.notice_type === "A&E");
    expect(ae && !("skip" in ae) ? ae.description : "").toContain("architecture and engineering (A&E)");
  });

  test("past openings and blank rows are skipped", () => {
    const sol = { solicitationNumber: "X-1", solicitationType: "Bids & Contracts", title: "Paving", openingDate: "10/01/2026", postedDate: "09/01/2026" };
    expect(miamiDadeRow(sol, now)).toEqual({ skip: "closed" });
    expect(miamiDadeRow({ ...sol, openingDate: "TBD" }, now)).toEqual({ skip: "no_deadline" });
    expect(miamiDadeRow({ ...sol, title: " " }, now)).toEqual({ skip: "missing_fields" });
  });

  test("scheduled, classified as a Florida county board", () => {
    expect(TAIL_SOURCES.some((t) => t.name === "fl_miami_dade")).toBe(true);
    expect(SOURCE_CLASSES["fl_miami_dade"]).toEqual({
      class: "local",
      city: "Miami-Dade County",
      scopeState: "FL",
      searchScope: "city-open-data",
      recordType: "opportunity",
    });
    expect(SOURCE_HOME_JURISDICTIONS["fl_miami_dade"]).toBe("FL");
  });
});
