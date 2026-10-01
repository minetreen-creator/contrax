/**
 * South Carolina Business Opportunities (`sc_scbo`) connector pins. Zero
 * network, no database: the fixtures are SCBO's online edition overview and
 * its kept category pages, captured 2026-10-01 (see fixtures/sc-scbo/README.md);
 * `now` is injected.
 */
import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { gunzipSync } from "node:zlib";
import { deriveInsertLocationColumns, SOURCE_HOME_JURISDICTIONS } from "~/lib/location-state";
import { isStateLocalSource, sourceBadgeLabel } from "~/lib/cert-matching";
import { TAIL_SOURCES } from "../runner";
import { parseScboCategory, readScboCategory, readScboOverview, SCBO_KEPT_CATEGORIES, scboDateToIso } from "./sc-scbo";

const gz = (name: string) => gunzipSync(readFileSync(new URL(`./fixtures/sc-scbo/${name}`, import.meta.url))).toString("utf8");
const OVERVIEW = readScboOverview(gz("online-edition-2026-10-01.html.gz"));
const PAGES = JSON.parse(gz("categories-2026-10-01.json.gz")) as Record<string, string>;
const CAPTURED = Date.parse("2026-10-01T22:30:00Z");

function parseAll(now: number) {
  const out = { rows: [] as ReturnType<typeof parseScboCategory>["rows"], skipped: {} as Record<string, number>, ads: 0 };
  for (const [id, html] of Object.entries(PAGES)) {
    const r = parseScboCategory(id, html, now);
    out.rows.push(...r.rows);
    out.ads += r.ads.length;
    for (const [k, n] of Object.entries(r.skipped)) out.skipped[k] = (out.skipped[k] ?? 0) + n;
  }
  return out;
}

describe("sc_scbo — overview", () => {
  test("lists all 15 categories with counts; every kept page parses to exactly its count", () => {
    expect(OVERVIEW.length).toBe(15);
    expect(OVERVIEW.find((c) => c.id === "3")).toEqual({ id: "3", url: "https://scbo.sc.gov/online-edition?c=3-2026-10-01", count: 122 });
    for (const c of OVERVIEW.filter((c) => c.id in SCBO_KEPT_CATEGORIES && c.count > 0)) {
      expect(`${c.id}:${readScboCategory(PAGES[c.id]!).length}`).toBe(`${c.id}:${c.count}`);
    }
  });

  test("sole source, for-sale and notice categories are not kept", () => {
    for (const id of ["121", "14", "15"]) expect(id in SCBO_KEPT_CATEGORIES).toBe(false);
  });
});

describe("sc_scbo — parse (captured pages)", () => {
  test("451 ads; open ones become South Carolina bids", () => {
    const { rows, skipped, ads } = parseAll(CAPTURED);
    expect(ads).toBe(451);
    expect(skipped).toEqual({ closed: 30 });
    expect(rows.length).toBe(421);
    for (const r of rows) {
      expect(r.external_id).toMatch(/^scbo-\d+$/);
      expect(r.source_url).toBe(`https://scbo.sc.gov/printad?a=${r.external_id.slice(5)}`);
      expect(r.location).toBe("South Carolina");
      expect(r.description.toLowerCase()).not.toContain(r.agency.toLowerCase());
      expect(r.description).not.toMatch(/\w@\w|\(\d{3}\) \d{3}-\d{4}/); // no buyer emails or phones
      const cols = deriveInsertLocationColumns({ location: r.location, agency: r.agency, title: r.title, description: r.description, sourceName: "sc_scbo" });
      expect(cols.source_jurisdiction).toBe("SC");
      expect(cols.normalized_state).toBe("SC");
    }
    expect(new Set(rows.map((r) => r.external_id)).size).toBe(rows.length);
  });

  test("a construction ad maps field by field", () => {
    const row = parseAll(CAPTURED).rows.find((r) => r.external_id === "scbo-69240")!;
    expect(row.title).toBe("Georgetown - Samworth WMA Dirleton House Renovations");
    expect(row.agency).toBe("State Fiscal Accountability Authority");
    expect(row.solicitation_number).toBe("P24-6114-CB");
    expect(row.due_date).toBe("2026-10-29T18:00:00.000Z"); // 2:00pm EDT
    expect(row.estimated_value).toBe("$350,000 to $450,000");
    expect(row.notice_type).toBe("Construction");
    expect(row.description).toContain("Project location: Samworth WMA.");
    expect(row.description).toContain("Delivery method: Design-Bid-Build.");
  });

  test("the buyer's name in the ad text is replaced, without a doubled article", () => {
    const row = parseAll(CAPTURED).rows.find((r) => r.external_id === "scbo-69154")!;
    expect(row.agency).toBe("James Island Public Service District");
    expect(row.description.startsWith("The buyer (JIPSD)")).toBe(false);
    expect(row.description).not.toMatch(/the the buyer/i);
  });

  test("dates: Eastern time, noon and midnight, date-only, garbage", () => {
    expect(scboDateToIso("October 29, 2026 - 2:00pm")).toBe("2026-10-29T18:00:00.000Z");
    expect(scboDateToIso("December 3, 2026 - 12:00pm")).toBe("2026-12-03T17:00:00.000Z");
    expect(scboDateToIso("December 3, 2026 - 12:30am")).toBe("2026-12-03T05:30:00.000Z");
    expect(scboDateToIso("December 3, 2026")).toBe("2026-12-03T05:00:00.000Z");
    expect(scboDateToIso("TBD")).toBeNull();
  });
});

describe("sc_scbo — registration", () => {
  test("registered as a tail sync source, South Carolina home jurisdiction, state badge", () => {
    expect(TAIL_SOURCES.some((s) => s.name === "sc_scbo")).toBe(true);
    expect(SOURCE_HOME_JURISDICTIONS["sc_scbo"]).toBe("SC");
    expect(isStateLocalSource(["sc_scbo"])).toBe(true);
    expect(sourceBadgeLabel("sc_scbo")).toBe("State (SC)");
  });
});
