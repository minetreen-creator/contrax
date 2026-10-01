/**
 * Kentucky eProcurement VSS (`ky_vss`) connector pins. Zero network, no
 * database: the fixture is the verbatim open-solicitations grid response
 * captured 2026-10-01 (see fixtures/ky-vss/README.md); `now` is injected.
 * The shared VSS request/parse rules are pinned in co-vss.test.ts.
 */
import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { deriveInsertLocationColumns, SOURCE_HOME_JURISDICTIONS } from "~/lib/location-state";
import { isStateLocalSource, sourceBadgeLabel } from "~/lib/cert-matching";
import { TAIL_SOURCES } from "../runner";
import { vssGrid, type VssGrid } from "./advantage-vss";
import { KYVSS_URL, parseKyVssGrid } from "./ky-vss";

const RESPONSE = JSON.parse(
  readFileSync(new URL("./fixtures/ky-vss/open-solicitations-2026-10-01.json", import.meta.url), "utf8"),
);
const CAPTURED = Date.parse("2026-10-01T16:00:00Z");

describe("ky_vss — parse (captured grid)", () => {
  test("reads all 57 open rows; every one becomes a Kentucky bid", () => {
    const grid = vssGrid(RESPONSE)!;
    expect(grid.row_data!.length).toBe(57);
    const { rows } = parseKyVssGrid(grid, CAPTURED);
    expect(rows.length).toBe(57); // 28 RFB + 27 RFP + 1 RFI + 1 RFQ
    for (const r of rows) {
      expect(r.location).toBe("Kentucky");
      expect(r.external_id.startsWith("kyvss-")).toBe(true);
      expect(r.source_url).toBe(KYVSS_URL);
      expect(r.description).not.toContain(r.agency);
      const cols = deriveInsertLocationColumns({ location: r.location, agency: r.agency, title: r.title, description: r.description, sourceName: "ky_vss" });
      expect(cols.source_jurisdiction).toBe("KY");
      expect(cols.normalized_state).toBe("KY");
    }
  });

  test("the janitorial bid maps field by field", () => {
    const { rows } = parseKyVssGrid(vssGrid(RESPONSE)!, CAPTURED);
    const row = rows.find((r) => r.solicitation_number === "RFB-758-2700000093-3")!;
    expect(row.external_id).toBe("kyvss-RFB-758-2700000093");
    expect(row.title).toBe("Janitorial Services - Commonwealth Office of Technology");
    expect(row.agency).toBe("Office Of The Controller");
    expect(row.notice_type).toBe("Request for Bids (RFB)");
    expect(row.due_date).toBe("2026-10-02T17:30:00.000Z");
  });

  test("a P3 notice is not a solicitation and is skipped", () => {
    const grid = vssGrid(RESPONSE)! as VssGrid;
    const first = grid.row_data![0] as Record<string, unknown>;
    const codeKey = Object.keys(first).find((k) => first[k] === "RFB")!;
    const p3 = { ...grid, row_data: [{ ...first, [codeKey]: "P3" }] } as VssGrid;
    const { rows, skipped } = parseKyVssGrid(p3, CAPTURED);
    expect(rows.length).toBe(0);
    expect(skipped.not_biddable_type).toBe(1);
  });

  test("the app lives under /vssprod-ext/", () => {
    expect(KYVSS_URL).toBe("https://vss.ky.gov/vssprod-ext/Advantage4");
  });
});

describe("ky_vss — registration", () => {
  test("registered as a tail sync source, Kentucky home jurisdiction, state badge", () => {
    expect(TAIL_SOURCES.some((s) => s.name === "ky_vss")).toBe(true);
    expect(SOURCE_HOME_JURISDICTIONS["ky_vss"]).toBe("KY");
    expect(isStateLocalSource(["ky_vss"])).toBe(true);
    expect(sourceBadgeLabel("ky_vss")).toBe("State (KY)");
  });
});
