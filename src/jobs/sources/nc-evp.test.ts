/**
 * North Carolina eVP (`nc_evp`) connector pins. Zero network, no database: the
 * fixture is the live open-solicitation list captured 2026-10-11, trimmed to
 * the fields the reader uses (see fixtures/nc-evp/README.md); `now` is injected.
 */
import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { gunzipSync } from "node:zlib";
import { deriveInsertLocationColumns, SOURCE_HOME_JURISDICTIONS } from "~/lib/location-state";
import { isStateLocalSource, sourceBadgeLabel } from "~/lib/cert-matching";
import { TAIL_SOURCES } from "../runner";
import { ncEvpWallTimeToIso, parseNcEvp, readNcEvpListConfig, type NcEvpRecord } from "./nc-evp";

const RECORDS: NcEvpRecord[] = JSON.parse(
  gunzipSync(readFileSync(new URL("./fixtures/nc-evp/open-solicitations-2026-10-11.json.gz", import.meta.url))).toString("utf8"),
).Records;
const CAPTURED = Date.parse("2026-10-11T12:00:00Z");

describe("nc_evp — captured list", () => {
  test("260 open listings, 260 accepted, no skips, unique ids", () => {
    const { rows, skipped } = parseNcEvp(RECORDS, CAPTURED);
    expect(RECORDS.length).toBe(260);
    expect(rows.length).toBe(260);
    expect(skipped).toEqual({});
    expect(new Set(rows.map((r) => r.external_id)).size).toBe(260);
  });

  test("a listing maps field by field", () => {
    const row = parseNcEvp(RECORDS, CAPTURED).rows.find((r) => r.external_id === "nc-evp:b1dc9094-1cc4-f111-aaae-001dd803db57")!;
    expect(row.title).toBe("Invitation for Bid #: 54-DM-40126");
    expect(row.description).toBe("Aluminum Structures");
    expect(row.agency).toBe("DEPARTMENT OF TRANSPORTATION");
    expect(row.solicitation_number).toBe("54-DM-40126");
    expect(row.location).toBe("North Carolina");
    expect(row.due_date).toBe("2026-10-23T18:00:00.000Z"); // 2:00 PM EDT
    expect(row.source_url).toBe("https://evp.nc.gov/solicitations/details/?id=b1dc9094-1cc4-f111-aaae-001dd803db57");
    expect(row.estimated_value).toBe("");
    expect(row.set_aside).toBeNull();
    expect(row.naics_code).toBeNull();
  });

  test("ids match the 2026-09-30 snapshot import's key, so its rows are refreshed", () => {
    for (const row of parseNcEvp(RECORDS, CAPTURED).rows) {
      expect(row.external_id).toMatch(/^nc-evp:[0-9a-f-]{36}$/);
      expect(row.source_url.endsWith(row.external_id.slice("nc-evp:".length))).toBe(true);
    }
  });

  test("listings whose opening time has passed are closed", () => {
    const later = Date.parse("2026-11-15T00:00:00Z");
    const { rows, skipped } = parseNcEvp(RECORDS, later);
    expect(skipped.closed).toBeGreaterThan(0);
    expect(rows.length + skipped.closed!).toBe(260);
    expect(rows.every((r) => Date.parse(r.due_date!) > later)).toBe(true);
  });

  test("every row lands in North Carolina", () => {
    for (const row of parseNcEvp(RECORDS, CAPTURED).rows) {
      const cols = deriveInsertLocationColumns({
        location: row.location,
        agency: row.agency,
        title: row.title,
        description: row.description,
        sourceName: "nc_evp",
      });
      expect(cols.normalized_state).toBe("NC");
    }
  });
});

describe("nc_evp — helpers", () => {
  test("Eastern wall time: EDT before Nov 1 2026, EST after; garbage is null", () => {
    expect(ncEvpWallTimeToIso("/Date(1792674000000)/")).toBe("2026-10-22T17:00:00.000Z"); // 10/22 1:00 PM EDT
    expect(ncEvpWallTimeToIso("/Date(1793628000000)/")).toBe("2026-11-02T19:00:00.000Z"); // 11/2 2:00 PM EST
    expect(ncEvpWallTimeToIso("10/22/2026")).toBeNull();
    expect(ncEvpWallTimeToIso(null)).toBeNull();
  });

  test("a non-open, unnamed or undated listing is skipped, not invented", () => {
    const open = { Value: 790550000 };
    const dept = { Id: "x", Name: "DEPT" };
    const { rows, skipped } = parseNcEvp(
      [
        { Attributes: [{ Name: "evp_name", Value: "No id" }] },
        { Id: "a", Attributes: [{ Name: "statuscode", Value: { Value: 2 } }, { Name: "evp_name", Value: "Canceled" }] },
        { Id: "b", Attributes: [{ Name: "statuscode", Value: open }, { Name: "owningbusinessunit", Value: dept }] },
        { Id: "c", Attributes: [{ Name: "statuscode", Value: open }, { Name: "evp_name", Value: "No date" }, { Name: "owningbusinessunit", Value: dept }] },
      ],
      CAPTURED,
    );
    expect(rows.length).toBe(0);
    expect(skipped).toEqual({ missing_id: 1, not_open: 1, missing_fields: 1, missing_due: 1 });
  });

  test("the list config is read from the page", () => {
    const layouts = Buffer.from(JSON.stringify([{ Base64SecureConfiguration: "SECURE", SortExpression: "evp_posteddate DESC" }])).toString("base64");
    const html = `<div class="entitylist" data-view-layouts="${layouts}" data-get-url="/_services/entity-grid-data.json/863ea987-6d3e-ed11-9daf-001dd805ec0b"></div>`;
    expect(readNcEvpListConfig(html)).toEqual({
      secureConfig: "SECURE",
      sortExpression: "evp_posteddate DESC",
      dataPath: "/_services/entity-grid-data.json/863ea987-6d3e-ed11-9daf-001dd805ec0b",
    });
    expect(readNcEvpListConfig("<html>changed</html>")).toBeNull();
  });
});

describe("nc_evp — registration", () => {
  test("registered as a tail sync source, North Carolina home jurisdiction, state badge", () => {
    expect(TAIL_SOURCES.some((s) => s.name === "nc_evp")).toBe(true);
    expect(SOURCE_HOME_JURISDICTIONS["nc_evp"]).toBe("NC");
    expect(isStateLocalSource(["nc_evp"])).toBe(true);
    expect(sourceBadgeLabel("nc_evp")).toBe("State (NC)");
  });
});
