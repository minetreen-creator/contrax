/**
 * Michigan SIGMA VSS (`mi_sigma`) connector pins. Zero network, no database:
 * the fixture is the verbatim open-solicitations grid response captured
 * 2026-10-01 (see fixtures/mi-sigma/README.md); `now` is injected. The shared
 * VSS request/parse rules are pinned in co-vss.test.ts.
 */
import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { deriveInsertLocationColumns, SOURCE_HOME_JURISDICTIONS } from "~/lib/location-state";
import { isStateLocalSource, sourceBadgeLabel } from "~/lib/cert-matching";
import { TAIL_SOURCES } from "../runner";
import { vssGrid } from "./advantage-vss";
import { MISIGMA_URL, parseMiSigmaGrid } from "./mi-sigma";

const RESPONSE = JSON.parse(
  readFileSync(new URL("./fixtures/mi-sigma/open-solicitations-2026-10-01.json", import.meta.url), "utf8"),
);
const CAPTURED = Date.parse("2026-10-01T16:00:00Z");

describe("mi_sigma — parse (captured grid)", () => {
  test("reads all 119 open rows; biddable ones become Michigan bids", () => {
    const grid = vssGrid(RESPONSE)!;
    expect(grid.row_data!.length).toBe(119);
    const { rows, skipped } = parseMiSigmaGrid(grid, CAPTURED);
    expect(skipped.not_biddable_type).toBe(6); // 5 notices of intent to award + 1 direct solicitation
    expect(rows.length).toBe(113);
    for (const r of rows) {
      expect(r.location).toBe("Michigan");
      expect(r.external_id.startsWith("misigma-")).toBe(true);
      expect(r.source_url).toBe(MISIGMA_URL);
      expect(r.description).toContain("Michigan SIGMA");
      expect(r.description).not.toContain(r.agency);
      const cols = deriveInsertLocationColumns({ location: r.location, agency: r.agency, title: r.title, description: r.description, sourceName: "mi_sigma" });
      expect(cols.source_jurisdiction).toBe("MI");
      expect(cols.normalized_state).toBe("MI");
    }
    expect(new Set(rows.map((r) => r.external_id)).size).toBe(rows.length);
  });

  test("the Bay-Arenac ISD renovation RFP maps field by field", () => {
    const { rows } = parseMiSigmaGrid(vssGrid(RESPONSE)!, CAPTURED);
    const row = rows.find((r) => r.solicitation_number === "RFP-BAY-260000002591-1")!;
    expect(row.external_id).toBe("misigma-RFP-BAY-260000002591");
    expect(row.title).toBe("Dining Room Addition & Interior Renovations");
    expect(row.agency).toBe("Bay Arenac ISD");
    expect(row.due_date).toBe("2026-10-01T17:00:00.000Z");
    expect(row.notice_type).toBe("Request for Proposals (RFP)");
  });

  test("notices of intent to award are never ingested as bids", () => {
    const { rows } = parseMiSigmaGrid(vssGrid(RESPONSE)!, CAPTURED);
    expect(rows.some((r) => /intent to award/i.test(r.notice_type ?? ""))).toBe(false);
  });
});

describe("mi_sigma — registration", () => {
  test("registered as a tail sync source, Michigan home jurisdiction, state badge", () => {
    expect(TAIL_SOURCES.some((s) => s.name === "mi_sigma")).toBe(true);
    expect(SOURCE_HOME_JURISDICTIONS["mi_sigma"]).toBe("MI");
    expect(isStateLocalSource(["mi_sigma"])).toBe(true);
    expect(sourceBadgeLabel("mi_sigma")).toBe("State (MI)");
  });
});
