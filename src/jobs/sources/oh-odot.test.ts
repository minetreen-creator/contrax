/**
 * Ohio DOT lettings (`oh_odot`) connector pins. Zero network, no database: the
 * fixture is ODOT's planholders summary captured 2026-10-01 (gzipped; see
 * fixtures/oh-odot/README.md); `now` is injected.
 */
import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { gunzipSync } from "node:zlib";
import { deriveInsertLocationColumns, SOURCE_HOME_JURISDICTIONS } from "~/lib/location-state";
import { isStateLocalSource, sourceBadgeLabel } from "~/lib/cert-matching";
import { TAIL_SOURCES } from "../runner";
import {
  ODOT_CONTRACTS_URL,
  ODOT_COUNTIES,
  odotAreaLabel,
  odotLettingToIso,
  odotLocation,
  parseOdotBidList,
  readOdotBidList,
} from "./oh-odot";

const TEXT = gunzipSync(readFileSync(new URL("./fixtures/oh-odot/bidlist-2026-10-01.txt.gz", import.meta.url))).toString("utf8");
const CAPTURED = Date.parse("2026-10-01T16:00:00Z");

describe("oh_odot — parse (captured file)", () => {
  test("groups 458 planholder lines into 117 projects; upcoming ones become Ohio bids", () => {
    const projects = readOdotBidList(TEXT);
    expect(projects.length).toBe(117);
    const { rows, skipped } = parseOdotBidList(TEXT, CAPTURED);
    expect(rows.length).toBe(81);
    expect(skipped.closed).toBe(36); // includes the 10/1 letting, which opened that morning
    for (const r of rows) {
      expect(r.external_id).toBe(`odot-${r.solicitation_number}`);
      expect(r.agency).toBe("Ohio Department of Transportation");
      expect(r.source_url).toBe(ODOT_CONTRACTS_URL);
      expect(r.location.endsWith("Ohio")).toBe(true);
      const cols = deriveInsertLocationColumns({ location: r.location, agency: r.agency, title: r.title, description: r.description, sourceName: "oh_odot" });
      expect(cols.source_jurisdiction).toBe("OH");
      expect(cols.normalized_state).toBe("OH");
    }
    expect(new Set(rows.map((r) => r.external_id)).size).toBe(rows.length);
  });

  test("project 260398 maps field by field", () => {
    const { rows } = parseOdotBidList(TEXT, CAPTURED);
    const row = rows.find((r) => r.solicitation_number === "260398")!;
    expect(row.title).toBe("Major Widening — ODOT project 260398, Hamilton County");
    expect(row.location).toBe("Hamilton County, Ohio");
    expect(row.due_date).toBe("2026-10-08T04:00:00.000Z"); // 12:00 AM EDT on the letting date
    expect(row.notice_type).toBe("Construction letting");
  });

  test("district-wide projects (D03) read as a district in Ohio", () => {
    const { rows } = parseOdotBidList(TEXT, Date.parse("2026-09-01T00:00:00Z"));
    const row = rows.find((r) => r.solicitation_number === "260422")!;
    expect(row.title).toBe("Bridge Repair — ODOT project 260422, District 3");
    expect(row.location).toBe("Ohio");
  });

  test("planholder companies, phones and addresses are never ingested", () => {
    const { rows } = parseOdotBidList(TEXT, CAPTURED);
    for (const r of rows) {
      const text = `${r.title} ${r.description} ${r.agency} ${r.location}`;
      expect(text).not.toMatch(/\d{3}[-.]\d{3}[-.]\d{4}/);
      expect(text).not.toContain("LAKE ERIE CONSTRUCTION");
    }
  });

  test("an empty or unrelated file yields no projects", () => {
    expect(readOdotBidList("<html>error</html>")).toEqual([]);
  });
});

describe("oh_odot — helpers", () => {
  test("letting dates are 12:00 AM Eastern", () => {
    expect(odotLettingToIso("10/29/2026")).toBe("2026-10-29T04:00:00.000Z");
    expect(odotLettingToIso("12/3/2026")).toBe("2026-12-03T05:00:00.000Z"); // EST
    expect(odotLettingToIso("13/1/2026")).toBeNull();
  });

  test("all 88 Ohio counties are mapped; districts and unknown codes fall back", () => {
    expect(Object.keys(ODOT_COUNTIES).length).toBe(88);
    expect(odotLocation("CUY")).toBe("Cuyahoga County, Ohio");
    expect(odotLocation("D07")).toBe("Ohio");
    // Delaware and Washington counties would resolve to the states of those names
    expect(odotLocation("DEL")).toBe("Ohio");
    expect(odotLocation("WAS")).toBe("Ohio");
    expect(odotAreaLabel("D12")).toBe("District 12");
    expect(odotAreaLabel("XYZ")).toBe("XYZ");
  });

  test("every county code in the captured file is known", () => {
    for (const p of readOdotBidList(TEXT)) {
      expect(p.area in ODOT_COUNTIES || /^D\d{2}$/.test(p.area)).toBe(true);
    }
  });
});

describe("oh_odot — registration", () => {
  test("registered as a tail sync source, Ohio home jurisdiction, state badge", () => {
    expect(TAIL_SOURCES.some((s) => s.name === "oh_odot")).toBe(true);
    expect(SOURCE_HOME_JURISDICTIONS["oh_odot"]).toBe("OH");
    expect(isStateLocalSource(["oh_odot"])).toBe(true);
    expect(sourceBadgeLabel("oh_odot")).toBe("State (OH)");
  });
});
