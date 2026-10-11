/**
 * Montgomery County, MD open-data solicitations (`md_montgomery`) connector
 * pins. Zero network, no database: the fixture is the dataset's Active rows
 * captured 2026-10-11 (see fixtures/md-montgomery/README.md).
 */
import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { deriveInsertLocationColumns, SOURCE_HOME_JURISDICTIONS } from "~/lib/location-state";
import { isStateLocalSource } from "~/lib/cert-matching";
import { TAIL_SOURCES } from "../runner";
import { MD_MONTGOMERY_PAGE_URL, mdMontgomeryCloseToIso, parseMdMontgomery, type MdMontgomeryItem } from "./md-montgomery";

const ITEMS: MdMontgomeryItem[] = JSON.parse(
  readFileSync(new URL("./fixtures/md-montgomery/active-2026-10-11.json", import.meta.url), "utf8"),
);
const CAPTURED = Date.parse("2026-10-11T12:00:00Z");

describe("md_montgomery — captured Active rows", () => {
  test("21 Active rows: 7 cancelled/postponed skipped, 14 accepted", () => {
    const { rows, skipped } = parseMdMontgomery(ITEMS, CAPTURED);
    expect(ITEMS.length).toBe(21);
    expect(skipped).toEqual({ cancelled: 7 });
    expect(rows.length).toBe(14);
    expect(new Set(rows.map((r) => r.external_id)).size).toBe(14);
  });

  test("a solicitation maps field by field", () => {
    const row = parseMdMontgomery(ITEMS, CAPTURED).rows.find((r) => r.external_id === "mdmontgomery-1197772")!;
    expect(row.title).toBe("Construction Services for North Bethesda Fire Station #43");
    expect(row.agency).toBe("Montgomery County, MD — Department of General Services");
    expect(row.solicitation_number).toBe("1197772");
    expect(row.notice_type).toBe("RFP");
    expect(row.location).toBe("Montgomery County, MD");
    expect(row.category).toBe("Construction");
    expect(row.due_date).toBe("2026-11-07T04:59:00.000Z"); // 11:59 PM EST on 11/6
    expect(row.description).toContain("the closing time is not published");
    expect(row.source_url).toBe(MD_MONTGOMERY_PAGE_URL);
    expect(row.set_aside).toBeNull();
  });

  test("closed solicitations are skipped", () => {
    const { rows, skipped } = parseMdMontgomery(ITEMS, Date.parse("2026-10-24T12:00:00Z"));
    expect(skipped.closed).toBeGreaterThan(0);
    expect(rows.length + skipped.closed!).toBe(14);
  });

  test("every row lands in Maryland", () => {
    for (const row of parseMdMontgomery(ITEMS, CAPTURED).rows) {
      const cols = deriveInsertLocationColumns({
        location: row.location,
        agency: row.agency,
        title: row.title,
        description: row.description,
        sourceName: "md_montgomery",
      });
      expect(cols.normalized_state).toBe("MD");
    }
  });
});

describe("md_montgomery — helpers", () => {
  test("date-only closing → 11:59 PM Eastern (EDT before Nov 1 2026, EST after)", () => {
    expect(mdMontgomeryCloseToIso("2026-10-23T00:00:00.000")).toBe("2026-10-24T03:59:00.000Z");
    expect(mdMontgomeryCloseToIso("2026-12-15T00:00:00.000")).toBe("2026-12-16T04:59:00.000Z");
    expect(mdMontgomeryCloseToIso(null)).toBeNull();
    expect(mdMontgomeryCloseToIso("TBD")).toBeNull();
  });

  test("not active / unnumbered / undated rows are skipped, not invented", () => {
    const { rows, skipped } = parseMdMontgomery(
      [
        { status: "Active", description: "No number", closingdate: "2026-12-01T00:00:00.000" },
        { status: "Closed", number: "1", description: "Closed", closingdate: "2026-12-01T00:00:00.000" },
        { status: "Active", number: "2", description: "No date" },
      ],
      CAPTURED,
    );
    expect(rows.length).toBe(0);
    expect(skipped).toEqual({ missing_id: 1, not_open: 1, missing_due: 1 });
  });
});

describe("md_montgomery — registration", () => {
  test("registered as a tail sync source with a Maryland home jurisdiction", () => {
    expect(TAIL_SOURCES.some((s) => s.name === "md_montgomery")).toBe(true);
    expect(SOURCE_HOME_JURISDICTIONS["md_montgomery"]).toBe("MD");
    expect(isStateLocalSource(["md_montgomery"])).toBe(true);
  });
});
