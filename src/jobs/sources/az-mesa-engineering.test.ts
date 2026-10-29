import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { TAIL_SOURCES } from "../runner";
import { SOURCE_CLASSES } from "~/lib/source-class";
import { SOURCE_HOME_JURISDICTIONS, deriveInsertLocationColumns } from "~/lib/location-state";
import { MESA_PAGE_URL, mesaDateToIso, mesaRow, parseMesaProjects } from "./az-mesa-engineering";

const html = readFileSync(new URL("./fixtures/az-mesa/construction-bids-2026-10-29.html", import.meta.url), "utf8");
const now = Date.parse("2026-10-29T16:00:00Z");

describe("City of Mesa Engineering construction bids", () => {
  test("page: every project under Opportunities, with opening, number and bid ad", () => {
    const ps = parseMesaProjects(html);
    expect(ps).toHaveLength(9);
    expect(ps[0]).toEqual({
      title: "Desert Well - Equipping and Desert Wells 26",
      projectNumbers: "CP0836WE11 and CP0836WE12",
      opening: "November 12, 2026",
      hasResults: false,
      adUrl: "https://www.mesaaz.gov/files/assets/public/v/1/business-development/engineering/constructionbid/cp0836we11_cp0836we12-advertisement-for-bid_sealed.pdf",
    });
    // An addendum that moves the bid date wins over the heading.
    expect(ps.find((p) => p.projectNumbers === "CP0982")?.opening).toBe("July 23, 2026");
    expect(parseMesaProjects("<html><h2>Other</h2></html>")).toEqual([]);
  });

  test("opening day ends at 23:59 Arizona time (UTC-7, no DST)", () => {
    expect(mesaDateToIso("November 12, 2026")).toBe("2026-11-13T06:59:00.000Z");
    expect(mesaDateToIso("July 23, 2026")).toBe("2026-07-24T06:59:00.000Z");
    expect(mesaDateToIso("soon")).toBeNull();
  });

  test("rows: only the project not yet opened; results-posted projects skipped", () => {
    const rows = parseMesaProjects(html).map((p) => mesaRow(p, now));
    const open = rows.filter((r) => !("skip" in r));
    expect(open).toHaveLength(1);
    expect(rows.filter((r) => "skip" in r && r.skip === "opened")).toHaveLength(8);
    const row = open[0];
    if ("skip" in row) throw new Error("expected a row");
    expect(row.external_id).toBe("mesaeng-cp0836we11-and-cp0836we12");
    expect(row.agency).toBe("City of Mesa");
    expect(row.location).toBe("Mesa, AZ");
    expect(row.due_date).toBe("2026-11-13T06:59:00.000Z");
    expect(row.source_url).toContain("advertisement-for-bid");
    expect(deriveInsertLocationColumns({ ...row, sourceName: "az_mesa_engineering" }).normalized_state).toBe("AZ");
    const noAd = mesaRow({ title: "Paving", projectNumbers: null, opening: "December 1, 2026", hasResults: false, adUrl: null }, now);
    expect("skip" in noAd ? null : noAd.source_url).toBe(MESA_PAGE_URL);
    expect(mesaRow({ title: "Paving", projectNumbers: "X", opening: "October 1, 2026", hasResults: false, adUrl: null }, now)).toEqual({ skip: "closed" });
  });

  test("scheduled, classified as a Mesa board", () => {
    expect(TAIL_SOURCES.some((t) => t.name === "az_mesa_engineering")).toBe(true);
    expect(SOURCE_CLASSES["az_mesa_engineering"]).toEqual({ class: "local", city: "Mesa", scopeState: "AZ", searchScope: "city-open-data", recordType: "opportunity" });
    expect(SOURCE_HOME_JURISDICTIONS["az_mesa_engineering"]).toBe("AZ");
  });
});
