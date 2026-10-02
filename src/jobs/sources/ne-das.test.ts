/**
 * Nebraska State Purchasing Bureau (`ne_das`) connector pins. Zero network,
 * no database: the fixture is the verbatim bid opportunities page captured
 * 2026-10-02 (gzipped; see fixtures/ne-das/README.md); `now` is injected.
 */
import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { gunzipSync } from "node:zlib";
import { deriveInsertLocationColumns, SOURCE_HOME_JURISDICTIONS } from "~/lib/location-state";
import { isStateLocalSource, sourceBadgeLabel } from "~/lib/cert-matching";
import { TAIL_SOURCES } from "../runner";
import { neDateToIso, parseNePage, readNeOpportunities } from "./ne-das";

const HTML = gunzipSync(readFileSync(new URL("./fixtures/ne-das/bid-opportunities-2026-10-02.html.gz", import.meta.url))).toString("utf8");
const CAPTURED = Date.parse("2026-10-02T03:54:00Z");

describe("ne_das — parse (captured page)", () => {
  test("reads only the Current Bid Opportunities table: 9 rows, 4 open Nebraska bids", () => {
    expect(readNeOpportunities(HTML)!.length).toBe(9);
    const { rows, skipped } = parseNePage(HTML, CAPTURED);
    expect(skipped).toEqual({ closed: 3, open_ended: 2 });
    expect(rows.length).toBe(4);
    for (const r of rows) {
      expect(r.external_id).toMatch(/^nedas-[0-9A-Za-z-]+$/);
      expect(r.location).toBe("Nebraska");
      expect(r.source_url.startsWith("https://das.nebraska.gov/materiel/purchasing/")).toBe(true);
      const cols = deriveInsertLocationColumns({ location: r.location, agency: r.agency, title: r.title, description: r.description, sourceName: "ne_das" });
      expect(cols.source_jurisdiction).toBe("NE");
      expect(cols.normalized_state).toBe("NE");
    }
  });

  test("the janitorial RFP maps field by field", () => {
    const row = parseNePage(HTML, CAPTURED).rows.find((r) => r.external_id === "nedas-127693-O5")!;
    expect(row.title).toBe("LRC Janitorial Services");
    expect(row.agency).toBe("State Purchasing Bureau");
    expect(row.notice_type).toBe("Request for Proposal");
    expect(row.solicitation_number).toBe("127693 O5");
    expect(row.due_date).toBe("2026-10-13T05:00:00.000Z"); // 12:00 AM CDT on the opening date
    expect(row.description).toContain("Category: 94795 - Janitorial Services.");
    expect(row.source_url).toBe("https://das.nebraska.gov/materiel/purchasing/127693%20O5/127693%20O5.html");
  });

  test("dates", () => {
    expect(neDateToIso("10/13/26")).toBe("2026-10-13T05:00:00.000Z");
    expect(neDateToIso("12/01/2026")).toBe("2026-12-01T06:00:00.000Z");
    expect(neDateToIso("Continuous")).toBeNull();
  });
});

describe("ne_das — registration", () => {
  test("registered as a tail sync source, Nebraska home jurisdiction, state badge", () => {
    expect(TAIL_SOURCES.some((s) => s.name === "ne_das")).toBe(true);
    expect(SOURCE_HOME_JURISDICTIONS["ne_das"]).toBe("NE");
    expect(isStateLocalSource(["ne_das"])).toBe(true);
    expect(sourceBadgeLabel("ne_das")).toBe("State (NE)");
  });
});
