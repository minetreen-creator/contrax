/**
 * West Virginia wvOASIS VSS (`wv_oasis`) connector pins. Zero network, no
 * database: the fixture is the verbatim open-solicitations grid response
 * captured 2026-10-01 (see fixtures/wv-oasis/README.md); `now` is injected.
 * The shared VSS request/parse rules are pinned in co-vss.test.ts.
 */
import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { deriveInsertLocationColumns, SOURCE_HOME_JURISDICTIONS } from "~/lib/location-state";
import { isStateLocalSource, sourceBadgeLabel } from "~/lib/cert-matching";
import { TAIL_SOURCES } from "../runner";
import { vssGrid } from "./advantage-vss";
import { parseWvOasisGrid, WVOASIS_URL } from "./wv-oasis";

const RESPONSE = JSON.parse(
  readFileSync(new URL("./fixtures/wv-oasis/open-solicitations-2026-10-01.json", import.meta.url), "utf8"),
);
const CAPTURED = Date.parse("2026-10-01T16:00:00Z");

describe("wv_oasis — parse (captured grid)", () => {
  test("reads all 52 open rows; biddable ones become West Virginia bids", () => {
    const grid = vssGrid(RESPONSE)!;
    expect(grid.row_data!.length).toBe(52);
    const { rows, skipped } = parseWvOasisGrid(grid, CAPTURED);
    expect(skipped.not_biddable_type).toBe(9); // 7 agency + 2 central sole source determinations
    expect(rows.length).toBe(43);
    for (const r of rows) {
      expect(r.location).toBe("West Virginia");
      expect(r.external_id.startsWith("wvoasis-")).toBe(true);
      expect(r.source_url).toBe(WVOASIS_URL);
      expect(r.description).not.toContain(r.agency);
      const cols = deriveInsertLocationColumns({ location: r.location, agency: r.agency, title: r.title, description: r.description, sourceName: "wv_oasis" });
      expect(cols.source_jurisdiction).toBe("WV");
      expect(cols.normalized_state).toBe("WV"); // never plain "Virginia"
    }
  });

  test("the DEP well plugging quote maps field by field", () => {
    const { rows } = parseWvOasisGrid(vssGrid(RESPONSE)!, CAPTURED);
    const row = rows.find((r) => r.solicitation_number === "ARFQ-0313-DEP2700000015-3")!;
    expect(row.external_id).toBe("wvoasis-ARFQ-0313-DEP2700000015");
    expect(row.title).toBe("Lewis Co. Well Plugging Package - Group C");
    expect(row.agency).toBe("DEPARTMENT OF ENVIRONMENTAL PROTECTION");
    expect(row.notice_type).toBe("Agency Request for Quote (ARFQ)");
  });

  test("the app lives under /PRDVSS1X1ERP/", () => {
    expect(WVOASIS_URL).toBe("https://prd311.wvoasis.gov/PRDVSS1X1ERP/Advantage4");
  });
});

describe("wv_oasis — registration", () => {
  test("registered as a tail sync source, West Virginia home jurisdiction, state badge", () => {
    expect(TAIL_SOURCES.some((s) => s.name === "wv_oasis")).toBe(true);
    expect(SOURCE_HOME_JURISDICTIONS["wv_oasis"]).toBe("WV");
    expect(isStateLocalSource(["wv_oasis"])).toBe(true);
    expect(sourceBadgeLabel("wv_oasis")).toBe("State (WV)");
  });
});
