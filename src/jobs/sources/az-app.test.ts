/**
 * Arizona Procurement Portal (`az_app`) connector pins. Zero network, no
 * database: the fixtures are the list pages captured 2026-10-04 (gzipped; see
 * fixtures/az-app/README.md); `now` is injected.
 */
import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { gunzipSync } from "node:zlib";
import { deriveInsertLocationColumns } from "~/lib/location-state";
import { SOURCE_CLASSES } from "~/lib/source-class";
import { TAIL_SOURCES } from "../runner";
import { azAgency, azFormFields, azRowIds, parseAzDate, parseAzPages } from "./az-app";

const load = (name: string) =>
  gunzipSync(readFileSync(new URL(`./fixtures/az-app/${name}`, import.meta.url))).toString("utf8");
const PAGES = [0, 1, 2].map((i) => load(`open-page${i}-2026-10-04.html.gz`));
const FIRST = load("unfiltered-first-get-2026-10-04.html.gz");
const CAPTURED = Date.parse("2026-10-04T13:00:00Z");

describe("az_app — parse (captured pages)", () => {
  test("39 listed on 3 pages; the 7 stale 2019 rows are skipped as closed", () => {
    const ids = PAGES.flatMap(azRowIds);
    expect(ids.length).toBe(39);
    expect(new Set(ids).size).toBe(39);
    const { rows, skipped } = parseAzPages(PAGES, CAPTURED);
    expect(rows.length).toBe(32);
    expect(skipped).toEqual({ closed: 6, awarded: 1 });
    for (const r of rows) {
      expect(r.external_id).toMatch(/^az-app:BPM\d+$/);
      expect(r.solicitation_number).toBe(r.external_id.slice("az-app:".length));
      expect(r.location).toBe("Arizona");
      expect(Date.parse(r.due_date!)).toBeGreaterThan(CAPTURED);
      expect(r.source_url).toMatch(/^https:\/\/app\.az\.gov\/page\.aspx\/en\/bpm\/process_manage_extranet\/\d+$/);
      const cols = deriveInsertLocationColumns({ location: r.location, agency: r.agency, title: r.title, description: r.description, sourceName: "az_app" });
      expect(cols.source_jurisdiction).toBe("AZ");
      expect(cols.normalized_state).toBe("AZ");
    }
    expect(new Set(rows.map((r) => r.external_id)).size).toBe(rows.length);
  });

  test("a row reads as the portal shows it", () => {
    const r = parseAzPages(PAGES, CAPTURED).rows.find((x) => x.solicitation_number === "BPM007809")!;
    expect(r.title).toBe("Wastewater Treatment Chemicals");
    expect(r.agency).toBe("Arizona State Parks Board");
    expect(r.due_date).toBe("2026-10-19T22:00:00.000Z"); // 3:00 PM UTC-7
    expect(r.description).toContain("Commodity: Water and wastewater treatment supply and disposal.");
    expect(r.source_url).toBe("https://app.az.gov/page.aspx/en/bpm/process_manage_extranet/13995");
  });

  test("ids and deadlines match the 2026-10-04 snapshot import", () => {
    const snap: { id: string; due_iso: string; awarded: boolean }[] = JSON.parse(
      readFileSync(new URL("../../../data/az-open-solicitations-2026-10-04.json", import.meta.url), "utf8"),
    );
    const rows = parseAzPages(PAGES, CAPTURED).rows;
    const eligible = snap.filter((s) => !s.awarded && Date.parse(s.due_iso) > CAPTURED);
    expect(rows.map((r) => r.solicitation_number).sort()).toEqual(eligible.map((s) => s.id).sort());
    for (const s of eligible) {
      expect(Date.parse(rows.find((r) => r.solicitation_number === s.id)!.due_date!)).toBe(Date.parse(s.due_iso));
    }
  });

  test("agency lists are deduplicated and joined", () => {
    expect(azAgency("<ul><li>City of Chandler</li><li>City of Chandler</li></ul>")).toBe("City of Chandler");
    expect(azAgency("<ul><li>A</li><li>B</li></ul>")).toBe("A; B");
    expect(azAgency("Lottery Commission")).toBe("Lottery Commission");
    const multi = parseAzPages(PAGES, CAPTURED).rows.find((x) => x.solicitation_number === "BPM007793")!;
    expect(multi.agency).toBe("Arizona Department of Administration; Department of Financial Institutions; Department of Insurance");
  });

  test("dates are read as UTC-7", () => {
    expect(parseAzDate("10/19/2026 3:00:00 PM")).toBe(Date.parse("2026-10-19T15:00:00-07:00"));
    expect(parseAzDate("1/1/2027 12:00:00 AM")).toBe(Date.parse("2027-01-01T00:00:00-07:00"));
    expect(parseAzDate("soon")).toBeNaN();
  });

  test("form fields include the CSRF token and the status filter control", () => {
    const fields = azFormFields(FIRST);
    expect(fields.filter(([k]) => k === "CSRFToken").length).toBe(1);
    expect(fields.some(([k]) => k === "body:x:selStatusCode_1")).toBe(true);
    expect(fields.some(([k]) => k === "__EVENTTARGET")).toBe(false);
  });

  test("registered as an Arizona state source", () => {
    expect(TAIL_SOURCES.some((s) => s.name === "az_app")).toBe(true);
    expect(SOURCE_CLASSES.az_app?.scopeState).toBe("AZ");
  });
});
