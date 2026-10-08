/**
 * City of Charlottesville, Virginia — its OWN CivicEngage / CivicPlus bid board
 * (`va_charlottesville`), read by the shared reader `civicengage-bids.ts`.
 *
 * DETERMINISTIC, ZERO NETWORK, NO DATABASE, NO `mock.module`. Every byte read
 * here is a VERBATIM capture of `https://www.charlottesville.gov/bids.aspx` taken
 * 2026-10-08 (four bare GETs, all four row fingerprints identical; fetch 1 and 2
 * are committed, plus the `?showAllBids=true&Status=all` trap response) — see
 * `fixtures/charlottesville/README.md` for provenance, byte sizes and sha256s.
 * The parse is a pure function and the defensive `closed` guard takes an INJECTED
 * reference instant, so no assertion depends on the wall clock.
 *
 * ONE open row is emphatically NOT coverage: nothing here (or in the connector's
 * copy) claims a trade appears on this board. A SEPARATE Bonfire tenant
 * (`charlottesville.bonfirehub.com`) also exists and is EMPTY — it is not this
 * source and is not read here.
 */
import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { isStateLocalSource, NON_STATE_LOCAL_SOURCES, sourceBadgeLabel } from "~/lib/cert-matching";
import { deriveInsertLocationColumns, SOURCE_HOME_JURISDICTIONS } from "~/lib/location-state";
import { SOURCE_CLASSES } from "~/lib/source-class";
import { TAIL_SOURCES } from "../runner";
import {
  fetchVaCharlottesvilleBids,
  parseVaCharlottesvilleBoard,
  VA_CHARLOTTESVILLE_AGENCY,
  VA_CHARLOTTESVILLE_CAPTURED_OPEN_ROWS_2026_10_08,
  VA_CHARLOTTESVILLE_COPY,
  VA_CHARLOTTESVILLE_DUE_DATE_ZONE_UNVERIFIED,
  VA_CHARLOTTESVILLE_ENDPOINT,
  VA_CHARLOTTESVILLE_ID_PREFIX,
  VA_CHARLOTTESVILLE_LOCATION,
  VA_CHARLOTTESVILLE_SOURCE,
  vaCharlottesvilleCountLine,
} from "./va-charlottesville";

const DIR = new URL("./fixtures/charlottesville/", import.meta.url);
const B = "charlottesville";
const fixture = (name: string) => readFileSync(new URL(name, DIR), "utf8");
const F1 = fixture(`${B}-open-2026-10-08-fetch1.html`);
const F2 = fixture(`${B}-open-2026-10-08-fetch2.html`);
const TRAP = fixture(`${B}-query-param-all-2026-10-08.html`);
/** Reference instant INSIDE the capture day but before any close time in ANY real
 *  zone, so the `closed` guard drops nothing regardless of the ambient TZ. */
const REF_NOW = Date.parse("2026-10-08T00:00:00Z");
const TZ_IS_UTC = !process.env.TZ || /^utc|^etc\/utc|^zulu$/i.test(process.env.TZ);

/** The board's own single open row, verbatim from the saved bytes. */
const EXPECTED = [
  {
    bidID: "504",
    title: "High-Quality Carbon Offsets for Charlottesville Gas",
    category: "Construction",
    group: "REQUEST FOR INFORMATION",
    utc: "2026-10-30T17:00:00.000Z",
  },
];

describe("va_charlottesville — the captured board parses to the rows the board listed", () => {
  test("fetch 1 yields the captured open row, with no skips", () => {
    const res = parseVaCharlottesvilleBoard(F1, REF_NOW);
    expect(res.rows.length).toBe(VA_CHARLOTTESVILLE_CAPTURED_OPEN_ROWS_2026_10_08);
    expect(res.rows.length).toBe(1);
    expect(res.parsed.length).toBe(1);
    expect(res.skipped).toEqual({});
    expect(res.skippedRows).toEqual([]);
  });
  test("the stability pair (fetch 1 vs fetch 2) gives an IDENTICAL parsed fingerprint", () => {
    const fp = (html: string) =>
      JSON.stringify(
        parseVaCharlottesvilleBoard(html, REF_NOW).rows.map((r) => [r.external_id, r.title, r.due_date, r.category]),
      );
    expect(fp(F1)).toBe(fp(F2));
    expect(F1).not.toBe(F2);
  });
  test("the row matches the board row-for-row (id · title · category · group · close date)", () => {
    const { rows, parsed } = parseVaCharlottesvilleBoard(F1, REF_NOW);
    const byId = new Map(rows.map((r) => [r.external_id, r]));
    expect([...byId.keys()]).toEqual(EXPECTED.map((e) => `${B}-${e.bidID}`));
    for (const e of EXPECTED) {
      const row = byId.get(`${B}-${e.bidID}`)!;
      expect(row.title).toBe(e.title);
      expect(row.category).toBe(e.category);
      expect(row.due_date!.slice(0, 10)).toBe(e.utc.slice(0, 10));
      if (TZ_IS_UTC) expect(row.due_date).toBe(e.utc);
      expect(parsed.find((p) => p.bidID === e.bidID)!.group).toBe(e.group);
      expect(parsed.find((p) => p.bidID === e.bidID)!.bidNo).toBe("RFI #27-01");
    }
  });
  test("agency / location are the board's own literals, never text-derived", () => {
    for (const row of parseVaCharlottesvilleBoard(F1, REF_NOW).rows) {
      expect(row.agency).toBe(VA_CHARLOTTESVILLE_AGENCY);
      expect(row.agency).toBe("City of Charlottesville");
      expect(row.location).toBe(VA_CHARLOTTESVILLE_LOCATION);
      expect(row.location).toBe("Charlottesville, VA");
      expect(row.estimated_value).toBe("Not specified");
      // Nothing the board does not publish is invented.
      expect(row.set_aside).toBeNull();
      expect(row.naics_code).toBeNull();
      expect(row.psc).toBeNull();
      expect(row.notice_type).toBeNull();
      expect(row.solicitation_number).toBeNull();
    }
  });
  test("ids are prefixed per board and the link is the absolute per-bid page", () => {
    for (const row of parseVaCharlottesvilleBoard(F1, REF_NOW).rows) {
      expect(row.external_id.startsWith(`${VA_CHARLOTTESVILLE_ID_PREFIX}-`)).toBe(true);
      expect(row.external_id).toMatch(/^charlottesville-\d+$/);
      expect(row.source_url).toBe(`${VA_CHARLOTTESVILLE_ENDPOINT}?bidID=${row.external_id.slice(B.length + 1)}`);
      expect(row.source_url!.startsWith("https://www.charlottesville.gov/bids.aspx?bidID=")).toBe(true);
    }
  });
  test("no description carries the board's `Read on` affordance or a raw entity", () => {
    for (const row of parseVaCharlottesvilleBoard(F1, REF_NOW).rows) {
      expect(row.description).not.toMatch(/Read\s*on/i);
      expect(`${row.title} ${row.description}`).not.toMatch(/&(?:nbsp|ldquo|rdquo|rsquo|mdash|amp);/);
      expect(row.description).toContain("\u201c"); // &ldquo; really was decoded
    }
  });
});

describe("va_charlottesville — the query-param trap fails safe on the real trap response", () => {
  test("`?showAllBids=true&Status=all` (HTTP 404 capture) → ZERO rows + `{shape_change: 1}`", () => {
    const res = parseVaCharlottesvilleBoard(TRAP, REF_NOW);
    expect(res.rows).toEqual([]);
    expect(res.parsed).toEqual([]);
    expect(res.skipped).toEqual({ shape_change: 1 });
  });
  test("the board's zone is UNVERIFIED, and the copy suppresses a countdown rather than guess", () => {
    expect(VA_CHARLOTTESVILLE_DUE_DATE_ZONE_UNVERIFIED).toBe(true);
    expect(VA_CHARLOTTESVILLE_COPY.timeZoneNote).toContain("not settled");
    expect(VA_CHARLOTTESVILLE_COPY.timeZoneNote).toContain("does not show a countdown");
  });
});

describe("va_charlottesville — copy + count line (no coverage claim, count quoted not hardcoded)", () => {
  test("the publisher line names the board's own publisher and the badge is the place", () => {
    expect(VA_CHARLOTTESVILLE_COPY.publisherLine).toContain("City of Charlottesville");
    expect(VA_CHARLOTTESVILLE_COPY.badge).toBe("Charlottesville");
    expect(VA_CHARLOTTESVILLE_COPY.noClaimsLine).toContain("no claim about which trades appear");
  });
  test("the count line quotes a REAL count (one row is not coverage), stamped ET", () => {
    const line = vaCharlottesvilleCountLine(1, "2026-10-08 12:00");
    expect(line).toBe(
      "City of Charlottesville's bid board listed 1 open solicitations · last checked by Contrax 2026-10-08 12:00 ET.",
    );
  });
  test("the 2026-10-08 capture carries no delivery / courier / freight row (no trade claim)", () => {
    const cats = parseVaCharlottesvilleBoard(F1, REF_NOW).rows.map((r) => r.category);
    expect(cats).not.toContain("Transportation");
    expect(cats).not.toContain("Janitorial");
  });
});

describe("va_charlottesville — registration (tail source · class map · VA home · LOCAL badge)", () => {
  test("the runner carries va_charlottesville as a tail source with this connector's fetch", () => {
    const entry = TAIL_SOURCES.find((s) => s.name === VA_CHARLOTTESVILLE_SOURCE);
    expect(entry).toBeDefined();
    expect(entry!.fetchFn).toBe(fetchVaCharlottesvilleBids);
  });
  test("the class map marks it LOCAL with the Charlottesville badge and a VA scope", () => {
    const rec = SOURCE_CLASSES[VA_CHARLOTTESVILLE_SOURCE];
    expect(rec.class).toBe("local");
    expect(rec.city).toBe("Charlottesville");
    expect(rec.scopeState).toBe("VA");
    expect(rec.searchScope).toBe("city-open-data");
    expect(rec.recordType).toBe("opportunity");
  });
  test("the home jurisdiction is VA by construction (not text-derived)", () => {
    expect(SOURCE_HOME_JURISDICTIONS[VA_CHARLOTTESVILLE_SOURCE]).toBe("VA");
    const cols = deriveInsertLocationColumns({
      location: "Charlottesville, VA",
      agency: "City of Charlottesville",
      title: "High-Quality Carbon Offsets for Charlottesville Gas",
      description: "Responses are due October 30, 2026 no later than 5:00 PM.",
      sourceName: VA_CHARLOTTESVILLE_SOURCE,
    });
    expect(cols.source_jurisdiction).toBe("VA");
    expect(cols.location_conflict).toBe(false);
  });
  test("a new local source needs no cert-matching change and is NOT relabelled Federal", () => {
    expect(NON_STATE_LOCAL_SOURCES.has(VA_CHARLOTTESVILLE_SOURCE)).toBe(false);
    expect(isStateLocalSource([VA_CHARLOTTESVILLE_SOURCE])).toBe(true);
    expect(sourceBadgeLabel(VA_CHARLOTTESVILLE_SOURCE)).toBe("Charlottesville");
  });
});
