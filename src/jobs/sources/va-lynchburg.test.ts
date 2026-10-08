/**
 * City of Lynchburg, Virginia — its OWN CivicEngage / CivicPlus bid board
 * (`va_lynchburg`), read by the shared reader `civicengage-bids.ts`.
 *
 * DETERMINISTIC, ZERO NETWORK, NO DATABASE, NO `mock.module`. Every byte read
 * here is a VERBATIM capture of `https://www.lynchburgva.gov/bids.aspx` taken
 * 2026-10-08 (four bare GETs, all four row fingerprints identical; fetch 1 and 2
 * are committed, plus the `?showAllBids=true&Status=all` trap response) — see
 * `fixtures/lynchburg/README.md` for provenance, byte sizes and sha256s. The
 * parse is a pure function and the defensive `closed` guard takes an INJECTED
 * reference instant, so no assertion depends on the wall clock.
 */
import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { isStateLocalSource, NON_STATE_LOCAL_SOURCES, sourceBadgeLabel } from "~/lib/cert-matching";
import { deriveInsertLocationColumns, SOURCE_HOME_JURISDICTIONS } from "~/lib/location-state";
import { SOURCE_CLASSES } from "~/lib/source-class";
import { TAIL_SOURCES } from "../runner";
import {
  fetchVaLynchburgBids,
  parseVaLynchburgBoard,
  VA_LYNCHBURG_AGENCY,
  VA_LYNCHBURG_CAPTURED_OPEN_ROWS_2026_10_08,
  VA_LYNCHBURG_COPY,
  VA_LYNCHBURG_DUE_DATE_ZONE_UNVERIFIED,
  VA_LYNCHBURG_ENDPOINT,
  VA_LYNCHBURG_ID_PREFIX,
  VA_LYNCHBURG_LOCATION,
  VA_LYNCHBURG_SOURCE,
  vaLynchburgCountLine,
} from "./va-lynchburg";

const DIR = new URL("./fixtures/lynchburg/", import.meta.url);
const B = "lynchburg";
const fixture = (name: string) => readFileSync(new URL(name, DIR), "utf8");
const F1 = fixture(`${B}-open-2026-10-08-fetch1.html`);
const F2 = fixture(`${B}-open-2026-10-08-fetch2.html`);
const TRAP = fixture(`${B}-query-param-all-2026-10-08.html`);
/** Reference instant INSIDE the capture day but before any close time in ANY real
 *  zone, so the `closed` guard drops nothing regardless of the ambient TZ. */
const REF_NOW = Date.parse("2026-10-08T00:00:00Z");
const TZ_IS_UTC = !process.env.TZ || /^utc|^etc\/utc|^zulu$/i.test(process.env.TZ);

/** The board's own 3 open rows, verbatim from the saved bytes. Two groups are
 *  represented (`Invitation for Bids` × 2, `Request for Proposals` × 1), and the
 *  RFP closes an hour later than the IFBs — the reason nothing here assumes one
 *  close time for the board. */
const EXPECTED = [
  { bidID: "245", title: "COMMUNITY MARKET AND ARMORY HVAC RENOVATION", category: "Construction", group: "Invitation for Bids", utc: "2026-10-29T15:00:00.000Z" },
  { bidID: "246", title: "LYNCHBURG PUBLIC LIBRARY FURNITURE", category: "Other", group: "Invitation for Bids", utc: "2026-10-22T15:00:00.000Z" },
  { bidID: "247", title: "COMPREHENSIVE OPERATIONAL ANALYSIS OF THE CITY'S PUBLIC TRANSIT SYSTEM", category: "Other", group: "Request for Proposals", utc: "2026-11-12T16:00:00.000Z" },
];

describe("va_lynchburg — the captured board parses to the rows the board listed", () => {
  test("fetch 1 yields the 3 captured open rows, with no skips", () => {
    const res = parseVaLynchburgBoard(F1, REF_NOW);
    expect(res.rows.length).toBe(VA_LYNCHBURG_CAPTURED_OPEN_ROWS_2026_10_08);
    expect(res.rows.length).toBe(3);
    expect(res.parsed.length).toBe(3);
    expect(res.skipped).toEqual({});
    expect(res.skippedRows).toEqual([]);
  });
  test("the stability pair (fetch 1 vs fetch 2) gives an IDENTICAL parsed fingerprint", () => {
    const fp = (html: string) =>
      JSON.stringify(parseVaLynchburgBoard(html, REF_NOW).rows.map((r) => [r.external_id, r.title, r.due_date, r.category]));
    expect(fp(F1)).toBe(fp(F2));
    expect(F1).not.toBe(F2);
  });
  test("every captured row matches the board row-for-row (id · title · category · group · close date)", () => {
    const { rows } = parseVaLynchburgBoard(F1, REF_NOW);
    const byId = new Map(rows.map((r) => [r.external_id, r]));
    expect([...byId.keys()]).toEqual(EXPECTED.map((e) => `${B}-${e.bidID}`));
    for (const e of EXPECTED) {
      const row = byId.get(`${B}-${e.bidID}`);
      expect(row).toBeDefined();
      expect(row!.title).toBe(e.title);
      expect(row!.category).toBe(e.category);
      expect(row!.due_date!.slice(0, 10)).toBe(e.utc.slice(0, 10));
      if (TZ_IS_UTC) expect(row!.due_date).toBe(e.utc);
    }
    // The group header is structural evidence, not a trade stamp: the RFP really
    // is in its own group.
    const parsed = parseVaLynchburgBoard(F1, REF_NOW).parsed;
    for (const e of EXPECTED) expect(parsed.find((p) => p.bidID === e.bidID)!.group).toBe(e.group);
  });
  test("agency / location are the board's own literals, never text-derived", () => {
    for (const row of parseVaLynchburgBoard(F1, REF_NOW).rows) {
      expect(row.agency).toBe(VA_LYNCHBURG_AGENCY);
      expect(row.agency).toBe("City of Lynchburg");
      expect(row.location).toBe(VA_LYNCHBURG_LOCATION);
      expect(row.location).toBe("Lynchburg, VA");
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
    for (const row of parseVaLynchburgBoard(F1, REF_NOW).rows) {
      expect(row.external_id.startsWith(`${VA_LYNCHBURG_ID_PREFIX}-`)).toBe(true);
      expect(row.external_id).toMatch(/^lynchburg-\d+$/);
      expect(row.source_url).toBe(`${VA_LYNCHBURG_ENDPOINT}?bidID=${row.external_id.slice(B.length + 1)}`);
      expect(row.source_url!.startsWith("https://www.lynchburgva.gov/bids.aspx?bidID=")).toBe(true);
    }
  });
  test("no description carries the board's `Read on` affordance or a raw entity", () => {
    for (const row of parseVaLynchburgBoard(F1, REF_NOW).rows) {
      expect(row.description).not.toMatch(/Read\s*on/i);
      expect(`${row.title} ${row.description}`).not.toMatch(/&(?:nbsp|ldquo|rdquo|rsquo|mdash|amp);/);
    }
  });
});

describe("va_lynchburg — the query-param trap fails safe on the real trap response", () => {
  test("`?showAllBids=true&Status=all` (HTTP 404 capture) → ZERO rows + `{shape_change: 1}`", () => {
    const res = parseVaLynchburgBoard(TRAP, REF_NOW);
    expect(res.rows).toEqual([]);
    expect(res.parsed).toEqual([]);
    expect(res.skipped).toEqual({ shape_change: 1 });
  });
  test("the board's zone is UNVERIFIED, and the copy suppresses a countdown rather than guess", () => {
    expect(VA_LYNCHBURG_DUE_DATE_ZONE_UNVERIFIED).toBe(true);
    expect(VA_LYNCHBURG_COPY.timeZoneNote).toContain("not settled");
    expect(VA_LYNCHBURG_COPY.timeZoneNote).toContain("does not show a countdown");
  });
});

describe("va_lynchburg — copy + count line (no coverage claim, count quoted not hardcoded)", () => {
  test("the publisher line names the board's own publisher and the badge is the place", () => {
    expect(VA_LYNCHBURG_COPY.publisherLine).toContain("City of Lynchburg");
    expect(VA_LYNCHBURG_COPY.badge).toBe("Lynchburg");
    expect(VA_LYNCHBURG_COPY.noClaimsLine).toContain("no claim about which trades appear");
  });
  test("the count line quotes a REAL count, stamped ET", () => {
    const line = vaLynchburgCountLine(3, "2026-10-08 12:00");
    expect(line).toBe(
      "City of Lynchburg's bid board listed 3 open solicitations · last checked by Contrax 2026-10-08 12:00 ET.",
    );
  });
  test("the 2026-10-08 capture carries no delivery / courier / freight row (no trade claim)", () => {
    const cats = parseVaLynchburgBoard(F1, REF_NOW).rows.map((r) => r.category);
    expect(cats).not.toContain("Transportation");
    expect(cats).not.toContain("Janitorial");
  });
});

describe("va_lynchburg — registration (tail source · class map · VA home · LOCAL badge)", () => {
  test("the runner carries va_lynchburg as a tail source with this connector's fetch", () => {
    const entry = TAIL_SOURCES.find((s) => s.name === VA_LYNCHBURG_SOURCE);
    expect(entry).toBeDefined();
    expect(entry!.fetchFn).toBe(fetchVaLynchburgBids);
  });
  test("the class map marks it LOCAL with the Lynchburg badge and a VA scope", () => {
    const rec = SOURCE_CLASSES[VA_LYNCHBURG_SOURCE];
    expect(rec.class).toBe("local");
    expect(rec.city).toBe("Lynchburg");
    expect(rec.scopeState).toBe("VA");
    expect(rec.searchScope).toBe("city-open-data");
    expect(rec.recordType).toBe("opportunity");
  });
  test("the home jurisdiction is VA by construction (not text-derived)", () => {
    expect(SOURCE_HOME_JURISDICTIONS[VA_LYNCHBURG_SOURCE]).toBe("VA");
    const cols = deriveInsertLocationColumns({
      location: "Lynchburg, VA",
      agency: "City of Lynchburg",
      title: "LYNCHBURG PUBLIC LIBRARY FURNITURE",
      description: "Bids are due October 22, 2026 no later than 3:00 PM.",
      sourceName: VA_LYNCHBURG_SOURCE,
    });
    expect(cols.source_jurisdiction).toBe("VA");
    expect(cols.location_conflict).toBe(false);
  });
  test("a new local source needs no cert-matching change and is NOT relabelled Federal", () => {
    expect(NON_STATE_LOCAL_SOURCES.has(VA_LYNCHBURG_SOURCE)).toBe(false);
    expect(isStateLocalSource([VA_LYNCHBURG_SOURCE])).toBe(true);
    expect(sourceBadgeLabel(VA_LYNCHBURG_SOURCE)).toBe("Lynchburg");
  });
});
