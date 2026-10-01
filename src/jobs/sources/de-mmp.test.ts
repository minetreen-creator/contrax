/**
 * Delaware Bid Solicitation Directory (`de_mmp`) connector pins. Zero network,
 * no database: the fixtures are the directory's open-bids grid, its agency
 * table and every bid's detail fragment, captured 2026-10-01 (see
 * fixtures/de-mmp/README.md); `now` is injected.
 */
import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { gunzipSync } from "node:zlib";
import { deriveInsertLocationColumns, SOURCE_HOME_JURISDICTIONS } from "~/lib/location-state";
import { isStateLocalSource, sourceBadgeLabel } from "~/lib/cert-matching";
import { TAIL_SOURCES } from "../runner";
import { deDateToIso, deDetailDeadline, parseDeMmpBids, readDeAgencies, type DeMmpList } from "./de-mmp";

const dir = (name: string) => new URL(`./fixtures/de-mmp/${name}`, import.meta.url);
const LIST = JSON.parse(readFileSync(dir("open-bids-2026-10-01.json"), "utf8")) as DeMmpList;
const AGENCIES = readDeAgencies(gunzipSync(readFileSync(dir("agencies-2026-10-01.html.gz"))).toString("utf8"));
const DETAILS = JSON.parse(gunzipSync(readFileSync(dir("bid-details-2026-10-01.json.gz"))).toString("utf8")) as Record<string, string>;
const DEADLINES = Object.fromEntries(Object.entries(DETAILS).map(([id, html]) => [id, deDetailDeadline(html)]));
const CAPTURED = Date.parse("2026-10-01T16:00:00Z");

describe("de_mmp — parse (captured directory)", () => {
  test("all 52 open bids become Delaware bids with the detail page's deadline", () => {
    expect(LIST.records).toBe(52);
    expect(Object.values(DEADLINES).every(Boolean)).toBe(true);
    const { rows, skipped } = parseDeMmpBids(LIST, AGENCIES, DEADLINES, CAPTURED);
    expect(skipped).toEqual({});
    expect(rows.length).toBe(52);
    for (const r of rows) {
      expect(r.external_id).toMatch(/^demmp-\d+$/);
      expect(r.source_url).toBe(`https://mmp.delaware.gov/Bids/Details/${r.external_id.slice(6)}`);
      expect(r.location).toBe("Delaware");
      expect(r.description).not.toContain(r.agency);
      expect(r.agency).not.toMatch(/^[A-Z0-9]{2,5}$/); // every code in the capture has a name
      const cols = deriveInsertLocationColumns({ location: r.location, agency: r.agency, title: r.title, description: r.description, sourceName: "de_mmp" });
      expect(cols.source_jurisdiction).toBe("DE");
      expect(cols.normalized_state).toBe("DE");
    }
    expect(new Set(rows.map((r) => r.external_id)).size).toBe(rows.length);
  });

  test("the child care survey maps field by field", () => {
    const row = parseDeMmpBids(LIST, AGENCIES, DEADLINES, CAPTURED).rows.find((r) => r.external_id === "demmp-9350")!;
    expect(row.title).toBe("Local Child Care Market Rate Survey and Cost of Care Analysis");
    expect(row.solicitation_number).toBe("HSS27012-MKTRTSVY");
    expect(row.agency).toBe("Department of Health & Social Services");
    expect(row.due_date).toBe("2026-11-20T18:00:00.000Z"); // 1:00 PM EST
    expect(row.description).toContain("UNSPSC classes: 8010, 8014");
  });

  test("without a detail page the deadline falls back to 12:00 AM Eastern on the list's date", () => {
    const row = parseDeMmpBids(LIST, AGENCIES, {}, CAPTURED).rows.find((r) => r.external_id === "demmp-9350")!;
    expect(row.due_date).toBe("2026-11-20T05:00:00.000Z");
    expect(deDateToIso("2026-10-21")).toBe("2026-10-21T04:00:00.000Z");
    expect(deDateToIso("10/21/2026")).toBeNull();
  });

  test("bids past their deadline are closed", () => {
    const { rows, skipped } = parseDeMmpBids(LIST, AGENCIES, DEADLINES, Date.parse("2026-10-21T18:00:00Z"));
    expect(skipped.closed).toBeGreaterThan(0);
    expect(rows.length + skipped.closed!).toBe(52);
    for (const r of rows) expect(Date.parse(r.due_date)).toBeGreaterThanOrEqual(Date.parse("2026-10-21T18:00:00Z"));
  });

  test("agency names read naturally; an unknown acronym stays as printed", () => {
    expect(AGENCIES["AGR"]).toBe("Department of Agriculture");
    expect(AGENCIES["CHR"]).toBe("Christina School District");
    const list: DeMmpList = { records: 1, rows: [{ Id: 1, Title: "Test", ContractNumber: "X1", DeadlineDate: "2027-01-05", AgencyCode: "ZZZ" }] };
    expect(parseDeMmpBids(list, AGENCIES, {}, CAPTURED).rows[0]!.agency).toBe("ZZZ");
  });
});

describe("de_mmp — registration", () => {
  test("registered as a tail sync source, Delaware home jurisdiction, state badge", () => {
    expect(TAIL_SOURCES.some((s) => s.name === "de_mmp")).toBe(true);
    expect(SOURCE_HOME_JURISDICTIONS["de_mmp"]).toBe("DE");
    expect(isStateLocalSource(["de_mmp"])).toBe(true);
    expect(sourceBadgeLabel("de_mmp")).toBe("State (DE)");
  });
});
