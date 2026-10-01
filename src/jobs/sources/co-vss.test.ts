/**
 * Colorado VSS (`co_vss`) connector pins. Zero network, no database: the
 * fixture is the verbatim open-solicitations grid response captured
 * 2026-10-01 (see fixtures/co-vss/README.md); `now` is injected.
 */
import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { deriveInsertLocationColumns, SOURCE_HOME_JURISDICTIONS } from "~/lib/location-state";
import { isStateLocalSource, sourceBadgeLabel } from "~/lib/cert-matching";
import { expandTrade, MAX_EXPANDED_TERMS } from "~/lib/trade-registry";
import { TAIL_SOURCES } from "../runner";
import {
  COVSS_URL,
  coVssGrid,
  coVssOpenBody,
  coVssSessionInfo,
  coVssShowLinesBody,
  parseCoVssDocRef,
  parseCoVssGrid,
} from "./co-vss";

const RESPONSE = JSON.parse(
  readFileSync(new URL("./fixtures/co-vss/open-solicitations-2026-10-01.json", import.meta.url), "utf8"),
);
const CAPTURED = Date.parse("2026-10-01T16:00:00Z");

describe("co_vss — parse (captured grid)", () => {
  test("reads all 56 open rows; 44 biddable ones become Colorado bids", () => {
    const grid = coVssGrid(RESPONSE)!;
    expect(grid.row_data!.length).toBe(56);
    expect(grid.total_count_suffix).toBe("");
    const { rows, skipped } = parseCoVssGrid(grid, CAPTURED);
    expect(rows.length).toBe(44);
    expect(skipped.not_biddable_type).toBe(12); // 11 contractor settlements + 1 sole source
    for (const r of rows) {
      expect(r.location).toBe("Colorado");
      expect(r.external_id.startsWith("covss-")).toBe(true);
      expect(r.source_url).toBe(COVSS_URL);
      expect(r.description).toContain(r.solicitation_number!);
      expect(r.description).not.toContain(r.agency);
      expect(r.due_date).not.toBeNull();
      const cols = deriveInsertLocationColumns({ location: r.location, agency: r.agency, title: r.title, description: r.description, sourceName: "co_vss" });
      expect(cols.source_jurisdiction).toBe("CO");
      expect(cols.normalized_state).toBe("CO");
    }
    expect(new Set(rows.map((r) => r.external_id)).size).toBe(rows.length);
  });

  test("the CDHS PRTF RFP maps field by field", () => {
    const { rows } = parseCoVssGrid(coVssGrid(RESPONSE)!, CAPTURED);
    const row = rows.find((r) => r.solicitation_number === "RFP-IHFA-2027000022-3")!;
    expect(row.external_id).toBe("covss-RFP-IHFA-2027000022"); // version dropped: amendments refresh the row
    expect(row.title).toBe("PRTF High Acuity Beds");
    expect(row.agency).toBe("CDHS - Office of Children Youth and Family");
    expect(row.due_date).toBe("2026-10-01T19:00:00.000Z"); // 1:00 PM MDT
    expect(row.notice_type).toBe("Request for Proposals (RFP)");
  });

  test("an agency name never creates a trade match (State Patrol ≠ security guard)", () => {
    const { rows } = parseCoVssGrid(coVssGrid(RESPONSE)!, CAPTURED);
    const terms = expandTrade("security guard").terms.slice(0, MAX_EXPANDED_TERMS);
    for (const r of rows) {
      const text = `${r.title} ${r.description} ${r.category}`.toLowerCase();
      const own = `${r.title} ${r.category}`.toLowerCase();
      expect(terms.some((t) => text.includes(t))).toBe(terms.some((t) => own.includes(t)));
    }
  });

  test("solicitations already closed are skipped", () => {
    const { skipped } = parseCoVssGrid(coVssGrid(RESPONSE)!, Date.parse("2026-10-02T00:00:00Z"));
    expect(skipped.closed).toBeGreaterThan(0);
  });

  test("a response without the grid is rejected", () => {
    expect(coVssGrid({ data: {} })).toBeNull();
    expect(coVssGrid(null)).toBeNull();
  });
});

describe("co_vss — helpers", () => {
  test("document references", () => {
    expect(parseCoVssDocRef("[DQ1,CAAA,2027000114,1][DQ1-CAAA-2027000114-1]")).toEqual({
      code: "DQ1",
      dept: "CAAA",
      id: "2027000114",
      version: "1",
      display: "DQ1-CAAA-2027000114-1",
    });
    expect(parseCoVssDocRef("RFP-IHFA-2027000022-3")).toBeNull();
  });

  test("session_info is read from the home page", () => {
    const html = '<script>x={"session_info":{"session_id":"3fc5","page_id":"542","csrf_token":"QsZ5"},"global_state_data":{}}</script>';
    expect(coVssSessionInfo(html)).toEqual({ session_id: "3fc5", page_id: "542", csrf_token: "QsZ5" });
    expect(coVssSessionInfo("<html></html>")).toBeNull();
  });

  test("the action bodies carry the session and ask for 500 open rows", () => {
    const open = coVssOpenBody({ session_id: "s", csrf_token: "c", page_id: "p" });
    expect(open.action.targetQualifiedName).toBe("vss.page.VVSSX10019");
    expect(open.session_info).toEqual({ session_id: "s", csrf_token: "c" });
    const more = coVssShowLinesBody({ checksum: { VIEW: 1 }, viewState: { v: 1 }, session_info: { session_id: "s2" } });
    expect(more.action.actionCode).toBe("show_lines");
    expect(more.action.genericParam_1).toBe("500");
    expect(more.data.ds_query_data.T1SO_SRCH_QRY.SHOW_TXT).toBe("3");
    expect(more.session_info).toEqual({ session_id: "s2" });
    expect(more.checksum).toEqual({ VIEW: 1 });
  });
});

describe("co_vss — registration", () => {
  test("registered as a tail sync source, Colorado home jurisdiction, state badge", () => {
    expect(TAIL_SOURCES.some((s) => s.name === "co_vss")).toBe(true);
    expect(SOURCE_HOME_JURISDICTIONS["co_vss"]).toBe("CO");
    expect(isStateLocalSource(["co_vss"])).toBe(true);
    expect(sourceBadgeLabel("co_vss")).toBe("State (CO)");
  });
});
