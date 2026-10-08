/**
 * City of Suffolk, Virginia — its OWN CivicEngage / CivicPlus bid board
 * (`va_suffolk`), read by the shared reader `civicengage-bids.ts`.
 *
 * DETERMINISTIC, ZERO NETWORK, NO DATABASE, NO `mock.module`. Every byte read
 * here is a VERBATIM capture of `https://www.suffolkva.us/bids.aspx` taken
 * 2026-10-08 (four bare GETs, all four row fingerprints identical; fetch 1 and 2
 * are committed, plus the `?showAllBids=true&Status=all` trap response) — see
 * `fixtures/suffolk/README.md` for provenance, byte sizes and sha256s. The parse
 * is a pure function and the defensive `closed` guard takes an INJECTED reference
 * instant, so no assertion depends on the wall clock.
 */
import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { isStateLocalSource, NON_STATE_LOCAL_SOURCES, sourceBadgeLabel } from "~/lib/cert-matching";
import { deriveInsertLocationColumns, SOURCE_HOME_JURISDICTIONS } from "~/lib/location-state";
import { SOURCE_CLASSES } from "~/lib/source-class";
import { TAIL_SOURCES } from "../runner";
import {
  fetchVaSuffolkBids,
  parseVaSuffolkBoard,
  VA_SUFFOLK_AGENCY,
  VA_SUFFOLK_CAPTURED_OPEN_ROWS_2026_10_08,
  VA_SUFFOLK_COPY,
  VA_SUFFOLK_DUE_DATE_ZONE_UNVERIFIED,
  VA_SUFFOLK_ENDPOINT,
  VA_SUFFOLK_ID_PREFIX,
  VA_SUFFOLK_LOCATION,
  VA_SUFFOLK_SOURCE,
  vaSuffolkCountLine,
} from "./va-suffolk";

const DIR = new URL("./fixtures/suffolk/", import.meta.url);
const B = "suffolk";
const fixture = (name: string) => readFileSync(new URL(name, DIR), "utf8");
const F1 = fixture(`${B}-open-2026-10-08-fetch1.html`);
const F2 = fixture(`${B}-open-2026-10-08-fetch2.html`);
const TRAP = fixture(`${B}-query-param-all-2026-10-08.html`);
/** Reference instant INSIDE the capture day but before any close time in ANY real
 *  zone (a 15:00 wall clock on 2026-10-08 is later than 00:00Z everywhere), so
 *  the `closed` guard drops nothing regardless of the ambient TZ. */
const REF_NOW = Date.parse("2026-10-08T00:00:00Z");
const TZ_IS_UTC = !process.env.TZ || /^utc|^etc\/utc|^zulu$/i.test(process.env.TZ);

/** The board's own 8 open rows, verbatim from the saved bytes. */
const EXPECTED = [
  { bidID: "1657", title: "Concrete Pipe", category: "Other", utc: "2026-11-05T15:00:00.000Z" },
  { bidID: "1654", title: "Landscaping Services for Cemeteries", category: "Other", utc: "2026-10-08T15:00:00.000Z" },
  { bidID: "1653", title: "Legislative Services", category: "Other", utc: "2026-10-13T15:00:00.000Z" },
  { bidID: "1652", title: "Pavement Asset Inventory and Pavement Management Solutions", category: "Construction", utc: "2026-10-15T15:00:00.000Z" },
  { bidID: "1656", title: "Repairs to Phoenix Bank Building Plaza", category: "Supplies & Equipment", utc: "2026-10-26T15:00:00.000Z" },
  { bidID: "1655", title: "Suffolk Downtown Traffic Signal Preemption System Enhancements", category: "Supplies & Equipment", utc: "2026-10-29T15:00:00.000Z" },
  { bidID: "1650", title: "Traffic Signal Construction Services", category: "Construction", utc: "2026-10-14T15:00:00.000Z" },
  { bidID: "1651", title: "Whaleyville Police Training Facility Renovation", category: "Construction", utc: "2026-10-09T15:00:00.000Z" },
];

describe("va_suffolk — the captured board parses to the rows the board listed", () => {
  test("fetch 1 yields the 8 captured open rows, with no skips", () => {
    const res = parseVaSuffolkBoard(F1, REF_NOW);
    expect(res.rows.length).toBe(VA_SUFFOLK_CAPTURED_OPEN_ROWS_2026_10_08);
    expect(res.rows.length).toBe(8);
    expect(res.parsed.length).toBe(8);
    expect(res.skipped).toEqual({});
    expect(res.skippedRows).toEqual([]);
  });
  test("the stability pair (fetch 1 vs fetch 2) gives an IDENTICAL parsed fingerprint", () => {
    const fp = (html: string) =>
      JSON.stringify(parseVaSuffolkBoard(html, REF_NOW).rows.map((r) => [r.external_id, r.title, r.due_date, r.category]));
    expect(fp(F1)).toBe(fp(F2));
    expect(F1).not.toBe(F2);
  });
  test("every captured row matches the board row-for-row (id · title · category · close date)", () => {
    const { rows } = parseVaSuffolkBoard(F1, REF_NOW);
    const byId = new Map(rows.map((r) => [r.external_id, r]));
    expect([...byId.keys()]).toEqual(EXPECTED.map((e) => `${B}-${e.bidID}`));
    for (const e of EXPECTED) {
      const row = byId.get(`${B}-${e.bidID}`);
      expect(row).toBeDefined();
      expect(row!.title).toBe(e.title);
      expect(row!.category).toBe(e.category);
      expect(row!.due_date).not.toBeNull();
      expect(row!.due_date!.slice(0, 10)).toBe(e.utc.slice(0, 10));
      if (TZ_IS_UTC) expect(row!.due_date).toBe(e.utc);
    }
  });
  test("agency / location are the board's own literals, never text-derived", () => {
    for (const row of parseVaSuffolkBoard(F1, REF_NOW).rows) {
      expect(row.agency).toBe(VA_SUFFOLK_AGENCY);
      expect(row.agency).toBe("City of Suffolk");
      expect(row.location).toBe(VA_SUFFOLK_LOCATION);
      expect(row.location).toBe("Suffolk, VA");
      expect(row.estimated_value).toBe("Not specified");
      // Nothing the board does not publish is invented.
      expect(row.set_aside).toBeNull();
      expect(row.naics_code).toBeNull();
      expect(row.psc).toBeNull();
      expect(row.notice_type).toBeNull();
      expect(row.solicitation_number).toBeNull();
    }
  });
  test("ids are prefixed per board and every link is the absolute per-bid page", () => {
    for (const row of parseVaSuffolkBoard(F1, REF_NOW).rows) {
      expect(row.external_id.startsWith(`${VA_SUFFOLK_ID_PREFIX}-`)).toBe(true);
      expect(row.external_id).toMatch(/^suffolk-\d+$/);
      expect(row.source_url).toBe(`${VA_SUFFOLK_ENDPOINT}?bidID=${row.external_id.slice(B.length + 1)}`);
      expect(row.source_url!.startsWith("https://www.suffolkva.us/bids.aspx?bidID=")).toBe(true);
    }
  });
  test("no description carries the board's `Read on` affordance or a raw entity", () => {
    for (const row of parseVaSuffolkBoard(F1, REF_NOW).rows) {
      expect(row.description).not.toMatch(/Read\s*on/i);
      expect(`${row.title} ${row.description}`).not.toMatch(/&(?:nbsp|ldquo|rdquo|rsquo|mdash|amp);/);
    }
  });
});

describe("va_suffolk — the query-param trap fails safe on the real trap response", () => {
  test("`?showAllBids=true&Status=all` (HTTP 404 capture) → ZERO rows + `{shape_change: 1}`", () => {
    const res = parseVaSuffolkBoard(TRAP, REF_NOW);
    expect(res.rows).toEqual([]);
    expect(res.parsed).toEqual([]);
    expect(res.skipped).toEqual({ shape_change: 1 });
  });
  test("the board's zone is UNVERIFIED, and the copy suppresses a countdown rather than guess", () => {
    expect(VA_SUFFOLK_DUE_DATE_ZONE_UNVERIFIED).toBe(true);
    expect(VA_SUFFOLK_COPY.timeZoneNote).toContain("not settled");
    expect(VA_SUFFOLK_COPY.timeZoneNote).toContain("does not show a countdown");
  });
});

describe("va_suffolk — copy + count line (no coverage claim, count quoted not hardcoded)", () => {
  test("the publisher line names the board's own publisher and the badge is the place", () => {
    expect(VA_SUFFOLK_COPY.publisherLine).toContain("City of Suffolk");
    expect(VA_SUFFOLK_COPY.badge).toBe("Suffolk");
    expect(VA_SUFFOLK_COPY.noClaimsLine).toContain("no claim about which trades appear");
  });
  test("the count line quotes a REAL count, stamped ET", () => {
    const line = vaSuffolkCountLine(8, "2026-10-08 12:00");
    expect(line).toBe(
      "City of Suffolk's bid board listed 8 open solicitations · last checked by Contrax 2026-10-08 12:00 ET.",
    );
  });
  test("the 2026-10-08 capture carries no delivery / courier / freight row (no trade claim)", () => {
    const cats = parseVaSuffolkBoard(F1, REF_NOW).rows.map((r) => r.category);
    expect(cats).not.toContain("Transportation");
    expect(cats).not.toContain("Janitorial");
  });
});

describe("va_suffolk — registration (tail source · class map · VA home · LOCAL badge)", () => {
  test("the runner carries va_suffolk as a tail source with this connector's fetch", () => {
    const entry = TAIL_SOURCES.find((s) => s.name === VA_SUFFOLK_SOURCE);
    expect(entry).toBeDefined();
    expect(entry!.fetchFn).toBe(fetchVaSuffolkBids);
  });
  test("the class map marks it LOCAL with the Suffolk badge and a VA scope", () => {
    const rec = SOURCE_CLASSES[VA_SUFFOLK_SOURCE];
    expect(rec.class).toBe("local");
    expect(rec.city).toBe("Suffolk");
    expect(rec.scopeState).toBe("VA");
    expect(rec.searchScope).toBe("city-open-data");
    expect(rec.recordType).toBe("opportunity");
  });
  test("the home jurisdiction is VA by construction (not text-derived)", () => {
    expect(SOURCE_HOME_JURISDICTIONS[VA_SUFFOLK_SOURCE]).toBe("VA");
    const cols = deriveInsertLocationColumns({
      location: "Suffolk, VA",
      agency: "City of Suffolk",
      title: "Legislative Services",
      description: "Proposals are due October 13, 2026 no later than 3:00 PM.",
      sourceName: VA_SUFFOLK_SOURCE,
    });
    expect(cols.source_jurisdiction).toBe("VA");
    expect(cols.location_conflict).toBe(false);
  });
  test("a new local source needs no cert-matching change and is NOT relabelled Federal", () => {
    expect(NON_STATE_LOCAL_SOURCES.has(VA_SUFFOLK_SOURCE)).toBe(false);
    expect(isStateLocalSource([VA_SUFFOLK_SOURCE])).toBe(true);
    expect(sourceBadgeLabel(VA_SUFFOLK_SOURCE)).toBe("Suffolk");
  });
});
