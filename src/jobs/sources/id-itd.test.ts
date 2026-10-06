/**
 * Idaho Transportation Department lettings (`id_itd`) connector pins. Zero
 * network, no database: the fixture is the verbatim contractor bidding page
 * captured 2026-10-06 (gzipped; see fixtures/id-itd/README.md); `now` is
 * injected.
 */
import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { gunzipSync } from "node:zlib";
import { deriveInsertLocationColumns } from "~/lib/location-state";
import { SOURCE_CLASSES } from "~/lib/source-class";
import { TAIL_SOURCES } from "../runner";
import { buildItdRows, itdDueMs, parseItdPage } from "./id-itd";

const HTML = gunzipSync(readFileSync(new URL("./fixtures/id-itd/contractor-bidding-2026-10-06.html.gz", import.meta.url))).toString("utf8");
const PROJECTS = parseItdPage(HTML);
const CAPTURED = Date.parse("2026-10-06T03:00:00Z");

describe("id_itd — parse (captured page)", () => {
  test("10 advertised projects (SIA/IRP empty), all accepted", () => {
    expect(PROJECTS.length).toBe(10);
    const { rows, skipped } = buildItdRows(PROJECTS, CAPTURED);
    expect(skipped).toEqual({});
    expect(rows.length).toBe(10);
    for (const r of rows) {
      expect(r.external_id).toMatch(/^iditd-[\d-]+$/);
      expect(r.agency).toBe("Idaho Transportation Department (ITD)");
      expect(r.title).not.toMatch(/^Call \d/);
      expect(r.category).toBe("Construction");
      expect(r.source_url).toMatch(/^https:\/\/apps\.itd\.idaho\.gov\/apps\/contractors\/NTC[\d%]+\.pdf$/);
      const cols = deriveInsertLocationColumns({ location: r.location, agency: r.agency, title: r.title, description: r.description, sourceName: "id_itd" });
      expect(cols.source_jurisdiction).toBe("ID");
      expect(cols.normalized_state).toBe("ID");
    }
  });

  test("a row reads as the page lists it", () => {
    const rows = buildItdRows(PROJECTS, CAPTURED).rows;
    const r = rows.find((x) => x.external_id === "iditd-23880")!;
    expect(r.title).toBe("SPIRIT LAKE CUTOFF CURVES");
    expect(r.due_date).toBe("2026-10-28T05:59:00.000Z"); // Oct 27, 11:59 PM MDT
    expect(r.description).toContain("LHTAC");
    const pair = rows.find((x) => x.external_id === "iditd-20243-20438")!;
    expect(pair.source_url).toBe("https://apps.itd.idaho.gov/apps/contractors/NTC20243%2020438.pdf");
  });

  test("a passed bid opening is never accepted", () => {
    expect(buildItdRows(PROJECTS.slice(0, 1), Date.parse("2026-10-08T00:00:00Z")).skipped).toEqual({ closed: 1 });
  });

  test("helpers and registration", () => {
    expect(itdDueMs("November 10, 2026")).toBe(Date.parse("2026-11-11T06:59:00Z")); // MST
    expect(itdDueMs("soon")).toBeNaN();
    expect(TAIL_SOURCES.some((s) => s.name === "id_itd")).toBe(true);
    expect(SOURCE_CLASSES.id_itd.scopeState).toBe("ID");
  });
});
