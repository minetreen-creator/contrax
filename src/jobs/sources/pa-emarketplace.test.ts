/**
 * Pennsylvania eMarketplace (`pa_dgs_emarketplace`) connector pins. Zero
 * network, no database: the fixture is the verbatim ALL-rows search page
 * captured 2026-10-01 (gzipped; see fixtures/pa-emarketplace/README.md);
 * `now` is injected.
 */
import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { gunzipSync } from "node:zlib";
import { deriveInsertLocationColumns, SOURCE_HOME_JURISDICTIONS } from "~/lib/location-state";
import { isStateLocalSource, sourceBadgeLabel } from "~/lib/cert-matching";
import { expandTrade, MAX_EXPANDED_TERMS } from "~/lib/trade-registry";
import { TAIL_SOURCES } from "../runner";
import {
  isPaEmktSearchPage,
  paEmktAllRowsBody,
  paEmktDetailUrl,
  paEmktDueToIso,
  paEmktHiddenFields,
  paEmktLocation,
  parsePaEmktSearch,
} from "./pa-emarketplace";

const HTML = gunzipSync(
  readFileSync(new URL("./fixtures/pa-emarketplace/search-all-2026-10-01.html.gz", import.meta.url)),
).toString("utf8");
const CAPTURED = Date.parse("2026-10-01T15:00:00Z");

describe("pa_dgs_emarketplace — parse (captured page)", () => {
  test("reads all 181 grid rows; current ones become Pennsylvania bids", () => {
    expect(isPaEmktSearchPage(HTML)).toBe(true);
    const { rows, parsed, skipped } = parsePaEmktSearch(HTML, CAPTURED);
    expect(parsed.length).toBe(181);
    expect(rows.length + Object.values(skipped).reduce((a, b) => a + b, 0)).toBe(181);
    expect(rows.length).toBe(181);
    for (const r of rows) {
      expect(r.external_id.startsWith("paemkt-")).toBe(true);
      expect(r.source_url.startsWith("https://www.emarketplace.state.pa.us/Solicitations.aspx?SID=")).toBe(true);
      expect(r.source_url).not.toMatch(/\s/);
      expect(r.location.endsWith("Pennsylvania")).toBe(true);
      expect(r.agency.length).toBeGreaterThan(0);
      expect(r.description).not.toContain(r.agency);
      const cols = deriveInsertLocationColumns({ location: r.location, agency: r.agency, title: r.title, description: r.description, sourceName: "pa_dgs_emarketplace" });
      expect(cols.source_jurisdiction).toBe("PA");
      expect(cols.normalized_state).toBe("PA");
    }
    expect(new Set(rows.map((r) => r.external_id)).size).toBe(rows.length);
  });

  test("the Corrections printer IFB maps field by field", () => {
    const { rows } = parsePaEmktSearch(HTML, CAPTURED);
    const row = rows.find((r) => r.solicitation_number === "6100066713")!;
    expect(row.title).toBe("1110-10908 Roland XG-640 Printer/Cutter"); // original casing, not the re-cased cell text
    expect(row.agency).toBe("Department of Corrections");
    expect(row.location).toBe("Huntingdon County, Pennsylvania");
    expect(row.due_date).toBe("2026-10-07T19:00:00.000Z"); // 3:00 PM EDT
    expect(row.notice_type).toBe("IFB");
    expect(row.source_url).toBe("https://www.emarketplace.state.pa.us/Solicitations.aspx?SID=6100066713");
  });

  test("standing programs (due 12/31/2099 or 12/31/9999) stay open-ended", () => {
    const { rows } = parsePaEmktSearch(HTML, CAPTURED);
    const costars = rows.filter((r) => r.notice_type === "COSTARS");
    expect(costars.length).toBeGreaterThan(0);
    for (const r of costars) expect(r.due_date).toBeNull();
  });

  test("solicitation numbers with spaces are encoded in the link", () => {
    const { rows } = parsePaEmktSearch(HTML, CAPTURED);
    const row = rows.find((r) => r.solicitation_number === "OOGM FS26-6")!;
    expect(row.source_url).toBe("https://www.emarketplace.state.pa.us/Solicitations.aspx?SID=OOGM%20FS26-6");
  });

  test("Commonwealth boilerplate never creates a trucking match", () => {
    const { rows } = parsePaEmktSearch(HTML, CAPTURED);
    const terms = expandTrade("trucking").terms.slice(0, MAX_EXPANDED_TERMS);
    for (const r of rows) {
      const text = `${r.title} ${r.description} ${r.category}`.toLowerCase();
      const own = `${r.title} ${r.category}`.toLowerCase();
      expect(terms.some((t) => text.includes(t))).toBe(terms.some((t) => own.includes(t)));
    }
  });

  test("solicitations already due are skipped", () => {
    const { skipped } = parsePaEmktSearch(HTML, Date.parse("2026-10-08T00:00:00Z"));
    expect(skipped.closed).toBeGreaterThan(0);
  });

  test("a page without the results grid is rejected", () => {
    expect(isPaEmktSearchPage("<html><title>Error</title></html>")).toBe(false);
  });
});

describe("pa_dgs_emarketplace — helpers", () => {
  test("due times are Eastern; the 2099/9999 sentinels are null", () => {
    expect(paEmktDueToIso("10/7/2026 3:00:00 PM")).toBe("2026-10-07T19:00:00.000Z");
    expect(paEmktDueToIso("12/3/2026 11:00:00 AM")).toBe("2026-12-03T16:00:00.000Z"); // EST
    expect(paEmktDueToIso("7/15/2027")).toBe("2027-07-16T03:59:00.000Z");
    expect(paEmktDueToIso("12/31/9999 12:00:00 AM")).toBeNull();
    expect(paEmktDueToIso("12/31/2099 11:59:00 PM")).toBeNull();
    expect(paEmktDueToIso("")).toBeNull();
  });

  test("locations", () => {
    expect(paEmktLocation("Statewide")).toBe("Pennsylvania");
    expect(paEmktLocation("Multiple")).toBe("Pennsylvania");
    expect(paEmktLocation("Dauphin")).toBe("Dauphin County, Pennsylvania");
    expect(paEmktDetailUrl("6100066713")).toBe("https://www.emarketplace.state.pa.us/Solicitations.aspx?SID=6100066713");
  });

  test("the postback carries the page's form state and asks for ALL current rows", () => {
    const hidden = paEmktHiddenFields(HTML);
    expect(hidden.__VIEWSTATE?.length ?? 0).toBeGreaterThan(0);
    const body = paEmktAllRowsBody(hidden);
    expect(body.get("__EVENTTARGET")).toBe("ctl00$MainBody$ddlRows");
    expect(body.get("ctl00$MainBody$ddlRows")).toBe("32767");
    expect(body.get("ctl00$MainBody$rdoArch")).toBe("0");
    expect(body.get("__VIEWSTATE")).toBe(hidden.__VIEWSTATE);
  });
});

describe("pa_dgs_emarketplace — registration", () => {
  test("registered as a tail sync source, Pennsylvania home jurisdiction, state badge", () => {
    expect(TAIL_SOURCES.some((s) => s.name === "pa_dgs_emarketplace")).toBe(true);
    expect(SOURCE_HOME_JURISDICTIONS["pa_dgs_emarketplace"]).toBe("PA");
    expect(isStateLocalSource(["pa_dgs_emarketplace"])).toBe(true);
    expect(sourceBadgeLabel("pa_dgs_emarketplace")).toBe("State (PA)");
  });
});
