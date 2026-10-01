/**
 * Periscope S2G (BuySpeed) reader + the six state configs. Zero network, no
 * database: the fixtures are the public open-bid search pages captured
 * 2026-10-01 (gzipped; see fixtures/periscope/README.md); `now` is injected.
 */
import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { gunzipSync } from "node:zlib";
import { deriveInsertLocationColumns, SOURCE_HOME_JURISDICTIONS } from "~/lib/location-state";
import { isStateLocalSource, sourceBadgeLabel } from "~/lib/cert-matching";
import { TAIL_SOURCES } from "../runner";
import {
  bsoBidUrl,
  bsoDateToIso,
  bsoHeaders,
  bsoPageBody,
  bsoRowCount,
  isBsoSearchPage,
  parseBsoRows,
  readBsoRows,
} from "./periscope-bso";
import { PERISCOPE_STATE_CODES, PERISCOPE_STATES } from "./periscope-states";

const load = (name: string) =>
  gunzipSync(readFileSync(new URL(`./fixtures/periscope/${name}`, import.meta.url))).toString("utf8");
const PAGES: Record<string, string> = {
  ma_commbuys: load("open-www.commbuys.com-2026-10-01.html.gz"),
  nj_njstart: load("open-www.njstart.gov-2026-10-01.html.gz"),
  il_bidbuy: load("open-www.bidbuy.illinois.gov-2026-10-01.html.gz"),
  or_oregonbuys: load("open-oregonbuys.gov-2026-10-01.html.gz"),
  nv_nevadaepro: load("open-nevadaepro.com-2026-10-01.html.gz"),
  ar_arbuy: load("open-arbuy.arkansas.gov-2026-10-01.html.gz"),
};
const MA_PAGING_XML = load("page-www.commbuys.com-first0-2026-10-01.xml.gz");
const CAPTURED = Date.parse("2026-10-01T16:00:00Z");
const EXPECTED_COUNTS: Record<string, number> = {
  ma_commbuys: 935,
  nj_njstart: 24,
  il_bidbuy: 191,
  or_oregonbuys: 178,
  nv_nevadaepro: 31,
  ar_arbuy: 0,
};

describe("periscope — every captured marketplace page", () => {
  for (const [source, html] of Object.entries(PAGES)) {
    test(`${source}: the results table, columns by name, rows become ${PERISCOPE_STATES[source].stateName} bids`, () => {
      const config = PERISCOPE_STATES[source];
      expect(isBsoSearchPage(html)).toBe(true);
      expect(bsoRowCount(html)).toBe(EXPECTED_COUNTS[source]);
      const headers = bsoHeaders(html);
      expect(headers).toContain("Bid Solicitation #");
      expect(headers).toContain("Organization Name");
      expect(headers).toContain("Description");
      expect(headers).toContain("Bid Opening Date");
      expect(headers).toContain("Status");
      const rows = readBsoRows(html, headers);
      expect(rows.length).toBe(Math.min(25, EXPECTED_COUNTS[source]));
      const { rows: bids } = parseBsoRows(config, rows, CAPTURED);
      for (const b of bids) {
        expect(b.external_id).toBe(`${config.idPrefix}-${b.solicitation_number}`);
        expect(b.source_url).toBe(bsoBidUrl(config, b.solicitation_number!));
        expect(b.location).toBe(config.stateName);
        expect(b.description).not.toContain(b.agency);
        const cols = deriveInsertLocationColumns({ location: b.location, agency: b.agency, title: b.title, description: b.description, sourceName: source });
        expect(cols.source_jurisdiction).toBe(PERISCOPE_STATE_CODES[source]);
        expect(cols.normalized_state).toBe(PERISCOPE_STATE_CODES[source]);
      }
    });
  }
});

describe("periscope — parse rules", () => {
  const config = PERISCOPE_STATES.ma_commbuys;

  test("the first COMMBUYS bid maps field by field", () => {
    const html = PAGES.ma_commbuys;
    const { rows } = parseBsoRows(config, readBsoRows(html, bsoHeaders(html)), CAPTURED);
    const row = rows.find((r) => r.solicitation_number === "BD-27-1020-DCRCU-DC250-134076")!;
    expect(row.title).toBe("DCR 828 Project Shade - Holyoke Design and Permitting");
    expect(row.agency).toBe("Department of Conservation and Recreation");
    expect(row.due_date).toBe("2026-10-28T16:00:00.000Z"); // 12:00 PM EDT
    expect(row.source_url).toBe(
      "https://www.commbuys.com/bso/external/bidDetail.sda?docId=BD-27-1020-DCRCU-DC250-134076&external=true",
    );
  });

  test("the paging response reads with the page's headers", () => {
    const rows = readBsoRows(MA_PAGING_XML, bsoHeaders(PAGES.ma_commbuys));
    expect(rows.length).toBe(25);
    expect(rows.every((r) => r.number.startsWith("BD-"))).toBe(true);
  });

  test("New Jersey's extra column does not shift the cells", () => {
    const html = PAGES.nj_njstart;
    const headers = bsoHeaders(html);
    expect(headers).toContain("Bid Holder List");
    for (const r of readBsoRows(html, headers)) {
      expect(r.opening === "" || /^\d{1,2}\/\d{1,2}\/\d{4}/.test(r.opening)).toBe(true);
      expect(["Sent", "Opened", "Evaluated", "Approved"]).toContain(r.status);
    }
  });

  test("closed statuses, notices and past openings are skipped", () => {
    const base = { number: "X-1", organization: "Town of X", description: "Road salt", opening: "10/28/2026 12:00 PM", status: "Sent", alternateId: "" };
    const { rows, skipped } = parseBsoRows(
      config,
      [
        base,
        { ...base, number: "X-2", status: "Opened" },
        { ...base, number: "X-3", status: "Evaluated" },
        { ...base, number: "X-4", description: "Sole Source Notice: Intent to Contract for Software" },
        { ...base, number: "X-5", description: "Notice of Intent to Award - Elevator Service" },
        { ...base, number: "X-6", description: "Sourcewell Contract Notice: Verizon Connect" },
        { ...base, number: "X-7", opening: "9/1/2026 12:00 PM" },
      ],
      CAPTURED,
    );
    expect(rows.map((r) => r.solicitation_number)).toEqual(["X-1"]);
    expect(skipped).toEqual({ not_open: 2, notice_not_bid: 3, closed: 1 });
  });
});

describe("periscope — helpers", () => {
  test("opening dates use the state's zone, with US daylight time", () => {
    expect(bsoDateToIso("10/28/2026 12:00 PM", -5)).toBe("2026-10-28T16:00:00.000Z"); // EDT
    expect(bsoDateToIso("10/14/2026 2:00 PM", -6)).toBe("2026-10-14T19:00:00.000Z"); // CDT
    expect(bsoDateToIso("12/3/2026 2:00 PM", -8)).toBe("2026-12-03T22:00:00.000Z"); // PST
    expect(bsoDateToIso("12/3/2026", -5)).toBe("2026-12-04T04:59:00.000Z"); // date only → 11:59 PM EST
    expect(bsoDateToIso("", -5)).toBeNull();
  });

  test("the paging body carries both tokens and the open-bids filter", () => {
    const body = bsoPageBody(50, "csrf-1", "vs-1");
    expect(body.get("bidSearchResultsForm:bidResultId_first")).toBe("50");
    expect(body.get("bidSearchResultsForm:bidResultId_rows")).toBe("25");
    expect(body.get("_csrf")).toBe("csrf-1");
    expect(body.get("openBids")).toBe("true");
    expect(body.get("javax.faces.ViewState")).toBe("vs-1");
  });

  test("a page without the results table is rejected", () => {
    expect(isBsoSearchPage("<html><title>Maintenance</title></html>")).toBe(false);
  });
});

describe("periscope — registration", () => {
  test("all six marketplaces are tail sources with their home state and a state badge", () => {
    for (const [source, code] of Object.entries(PERISCOPE_STATE_CODES)) {
      expect(TAIL_SOURCES.some((s) => s.name === source)).toBe(true);
      expect(SOURCE_HOME_JURISDICTIONS[source]).toBe(code);
      expect(isStateLocalSource([source])).toBe(true);
      expect(sourceBadgeLabel(source)).toBe(`State (${code})`);
    }
  });
});
