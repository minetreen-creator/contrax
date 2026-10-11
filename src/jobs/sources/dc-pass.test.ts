/**
 * District of Columbia PASS solicitations (`dc_pass`) connector pins. Zero
 * network, no database: the fixture is the DC Open Data layer's open-solicitation
 * response captured 2026-10-11 (gzipped; see fixtures/dc-pass/README.md).
 */
import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { gunzipSync } from "node:zlib";
import { deriveInsertLocationColumns, SOURCE_HOME_JURISDICTIONS } from "~/lib/location-state";
import { isStateLocalSource, sourceBadgeLabel } from "~/lib/cert-matching";
import { TAIL_SOURCES } from "../runner";
import { DC_PASS_PAGE_URL, dcClean, parseDcPass, type DcPassAttributes } from "./dc-pass";

const ITEMS: DcPassAttributes[] = JSON.parse(
  gunzipSync(readFileSync(new URL("./fixtures/dc-pass/open-solicitations-2026-10-11.json.gz", import.meta.url))).toString("utf8"),
).features.map((f: { attributes: DcPassAttributes }) => f.attributes);
const CAPTURED = Date.parse("2026-10-11T12:00:00Z");

describe("dc_pass — captured layer", () => {
  test("32 rows are 21 solicitations (one row per commodity code), all accepted", () => {
    const { rows, skipped } = parseDcPass(ITEMS, CAPTURED);
    expect(ITEMS.length).toBe(32);
    expect(rows.length).toBe(21);
    expect(skipped).toEqual({});
    expect(new Set(rows.map((r) => r.external_id)).size).toBe(21);
  });

  test("a solicitation listed under several commodity codes keeps them all", () => {
    const row = parseDcPass(ITEMS, CAPTURED).rows.find((r) => r.external_id === "dcpass-Doc850460")!;
    expect(row.description).toContain("Commodities: TRANSCRIPTION SERVICES, LEGAL");
    expect(row.description).toContain("; TRANSCRIPTION SERVICES, MEDICA");
  });

  test("a solicitation maps field by field", () => {
    const row = parseDcPass(ITEMS, CAPTURED).rows.find((r) => r.external_id === "dcpass-DCKA-2026-Q-0170")!;
    expect(row.title).toBe("Rehabilitation/Reconstruction of 27th Street Bridge over Broad Branch Stream");
    expect(row.agency).toBe("District Department of Transportation");
    expect(row.due_date).toBe("2026-10-26T18:00:00.000Z"); // 2:00 PM EDT
    expect(row.location).toBe("District of Columbia");
    expect(row.solicitation_number).toBe("DCKA-2026-Q-0170");
    expect(row.source_url).toBe(DC_PASS_PAGE_URL);
    expect(row.description).toContain("Commodity: Architectural Services, Professional.");
    expect(row.description).toContain("('OCP')");
    expect(row.set_aside).toBeNull();
    expect(row.naics_code).toBeNull();
  });

  test("an agency missing AGENCY_NAME falls back to PASS's own agency text", () => {
    const row = parseDcPass(ITEMS, CAPTURED).rows.find((r) => r.external_id === "dcpass-Doc849856")!;
    expect(row.agency).toBe("DEPART OF YOUTH REHABILITATION SERVICES");
    expect(row.description).toContain("Market: Set Aside (District of Columbia CBE set-aside).");
    expect(row.description).toContain("Work site: 8400 River Road, Laurel, MD 20724.");
  });

  test("closed solicitations are skipped", () => {
    const { rows, skipped } = parseDcPass(ITEMS, Date.parse("2026-10-13T00:00:00Z"));
    expect(skipped.closed).toBeGreaterThan(0);
    expect(rows.length + skipped.closed!).toBe(21);
  });

  test("every row lands in DC", () => {
    for (const row of parseDcPass(ITEMS, CAPTURED).rows) {
      const cols = deriveInsertLocationColumns({
        location: row.location,
        agency: row.agency,
        title: row.title,
        description: row.description,
        sourceName: "dc_pass",
      });
      expect(cols.normalized_state).toBe("DC");
    }
  });
});

describe("dc_pass — helpers", () => {
  test("U+001A (a lost curly quote) becomes an apostrophe; whitespace collapses", () => {
    expect(dcClean("DDOT\u001as  long-range\nplan")).toBe("DDOT's long-range plan");
    expect(dcClean(null)).toBe("");
  });

  test("not open / unnumbered / undated rows are skipped, not invented", () => {
    const future = CAPTURED + 86_400_000;
    const { rows, skipped } = parseDcPass(
      [
        { SOLICITATIONTITLE: "No number", EVENTDISPLAYSTATUS: "OPEN", CLOSEDATE: future },
        { SOLICITATIONNUMBER: "A", SOLICITATIONTITLE: "Closed event", EVENTDISPLAYSTATUS: "CLOSED", CLOSEDATE: future },
        { SOLICITATIONNUMBER: "B", SOLICITATIONTITLE: "No date", EVENTDISPLAYSTATUS: "OPEN" },
      ],
      CAPTURED,
    );
    expect(rows.length).toBe(0);
    expect(skipped).toEqual({ missing_id: 1, not_open: 1, missing_due: 1 });
  });
});

describe("dc_pass — registration", () => {
  test("registered as a tail sync source, DC home jurisdiction, state badge", () => {
    expect(TAIL_SOURCES.some((s) => s.name === "dc_pass")).toBe(true);
    expect(SOURCE_HOME_JURISDICTIONS["dc_pass"]).toBe("DC");
    expect(isStateLocalSource(["dc_pass"])).toBe(true);
    expect(sourceBadgeLabel("dc_pass")).toBe("State (DC)");
  });
});
