/**
 * County of Loudoun, Virginia — its OWN CivicEngage / CivicPlus bid board
 * (`va_loudoun`), read by the shared reader `civicengage-bids.ts`.
 *
 * DETERMINISTIC, ZERO NETWORK, NO DATABASE, NO `mock.module`. Every byte read
 * here is a VERBATIM capture of `https://www.loudoun.gov/bids.aspx` taken
 * 2026-10-08 (four bare GETs, all four row fingerprints identical; fetch 1 and 2
 * are committed, plus the `?showAllBids=true&Status=all` trap response) — see
 * `fixtures/loudoun/README.md` for provenance, byte sizes and sha256s. The parse
 * is a pure function and the defensive `closed` guard takes an INJECTED reference
 * instant, so no assertion depends on the wall clock.
 *
 * What this file pins: the captured row count on BOTH stability fetches, the
 * per-row identity captured from the board (id · title · category · close date),
 * the per-board id prefix and absolute `source_url`, the literal `agency` /
 * `location` (never text-derived), NULL for every field the board does not
 * publish, the trap response failing safe, the exported zone flag, the honest
 * copy, and the registration (runner tail source · class map · home
 * jurisdiction · badge) that nothing else in CI covers.
 */
import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { isStateLocalSource, NON_STATE_LOCAL_SOURCES, sourceBadgeLabel } from "~/lib/cert-matching";
import { deriveInsertLocationColumns, SOURCE_HOME_JURISDICTIONS } from "~/lib/location-state";
import { SOURCE_CLASSES } from "~/lib/source-class";
import { TAIL_SOURCES } from "../runner";
import {
  fetchVaLoudounBids,
  parseVaLoudounBoard,
  VA_LOUDOUN_AGENCY,
  VA_LOUDOUN_CAPTURED_OPEN_ROWS_2026_10_08,
  VA_LOUDOUN_COPY,
  VA_LOUDOUN_DUE_DATE_ZONE_UNVERIFIED,
  VA_LOUDOUN_ENDPOINT,
  VA_LOUDOUN_ID_PREFIX,
  VA_LOUDOUN_LOCATION,
  VA_LOUDOUN_SOURCE,
  vaLoudounCountLine,
} from "./va-loudoun";

const DIR = new URL("./fixtures/loudoun/", import.meta.url);
const B = "loudoun";
const fixture = (name: string) => readFileSync(new URL(name, DIR), "utf8");
const F1 = fixture(`${B}-open-2026-10-08-fetch1.html`);
const F2 = fixture(`${B}-open-2026-10-08-fetch2.html`);
const TRAP = fixture(`${B}-query-param-all-2026-10-08.html`);
/** Reference instant INSIDE the capture day but before any close time in ANY real
 *  zone (a 15:00/16:00 wall clock on 2026-10-08 is later than 00:00Z everywhere),
 *  so the `closed` guard drops nothing regardless of the ambient TZ. */
const REF_NOW = Date.parse("2026-10-08T00:00:00Z");
const TZ_IS_UTC = !process.env.TZ || /^utc|^etc\/utc|^zulu$/i.test(process.env.TZ);

/** The board's own 10 open rows, verbatim from the saved bytes. */
const EXPECTED = [
  { bidID: "1107", title: "CEI Services for Route 15 N Widening: Battlefield Pkwy to Montresor Road, RFQ 714025", category: "Construction", utc: "2026-10-13T16:00:00.000Z" },
  { bidID: "937", title: "Concession Food Services (Supplemental), RFQ 648812", category: "Other", utc: null },
  { bidID: "1110", title: "Construction of the Westpark Improvements, RFQ 692007", category: "Construction", utc: "2026-10-29T16:00:00.000Z" },
  { bidID: "844", title: "Early Intervention Services for Infants and Toddlers, RFQ 576784", category: "Other", utc: null },
  { bidID: "861", title: "Library Material Suppliers, RFQ 601790", category: "Supplies & Equipment", utc: "2029-06-30T16:00:00.000Z" },
  { bidID: "1111", title: "MD1745 Stormwater Pond Retrofit, RFQ 715024", category: "Other", utc: "2026-10-30T16:00:00.000Z" },
  { bidID: "1108", title: "Purch of Stream Mit Cred for Evergreen Mills Rd/Watson Rd/Reservoir Rd Inter Improvements - Reissue", category: "Other", utc: "2026-10-08T16:00:00.000Z" },
  { bidID: "1109", title: "Roadway & Civil Design Services for Route 15 Widening - Montresor Rd to Lucketts Bypass, RFQ 714030", category: "Construction", utc: "2026-10-22T16:00:00.000Z" },
  { bidID: "994", title: "Specialized Programs and Camp Instructors, RFQ 668834", category: "Other", utc: null },
  { bidID: "715", title: "Veterinary Pharmaceuticals and Supplies, RFQ 350782", category: "Other", utc: null },
];

describe("va_loudoun — the captured board parses to the rows the board listed", () => {
  test("fetch 1 yields the 10 captured open rows, with no skips", () => {
    const res = parseVaLoudounBoard(F1, REF_NOW);
    expect(res.rows.length).toBe(VA_LOUDOUN_CAPTURED_OPEN_ROWS_2026_10_08);
    expect(res.rows.length).toBe(10);
    expect(res.parsed.length).toBe(10);
    expect(res.skipped).toEqual({});
    expect(res.skippedRows).toEqual([]);
  });
  test("the stability pair (fetch 1 vs fetch 2) gives an IDENTICAL parsed fingerprint", () => {
    const fp = (html: string) =>
      JSON.stringify(parseVaLoudounBoard(html, REF_NOW).rows.map((r) => [r.external_id, r.title, r.due_date, r.category]));
    expect(fp(F1)).toBe(fp(F2));
    expect(F1).not.toBe(F2);
  });
  test("every captured row matches the board row-for-row (id · title · category · close date)", () => {
    const { rows } = parseVaLoudounBoard(F1, REF_NOW);
    const byId = new Map(rows.map((r) => [r.external_id, r]));
    expect([...byId.keys()]).toEqual(EXPECTED.map((e) => `${B}-${e.bidID}`));
    for (const e of EXPECTED) {
      const row = byId.get(`${B}-${e.bidID}`);
      expect(row).toBeDefined();
      expect(row!.title).toBe(e.title);
      expect(row!.category).toBe(e.category);
      if (e.utc === null) {
        expect(row!.due_date).toBeNull(); // the open-ended state, still emitted
      } else {
        expect(row!.due_date!.slice(0, 10)).toBe(e.utc.slice(0, 10));
        if (TZ_IS_UTC) expect(row!.due_date).toBe(e.utc);
      }
    }
  });
  test("agency / location are the board's own literals, never text-derived", () => {
    for (const row of parseVaLoudounBoard(F1, REF_NOW).rows) {
      expect(row.agency).toBe(VA_LOUDOUN_AGENCY);
      expect(row.agency).toBe("County of Loudoun");
      expect(row.location).toBe(VA_LOUDOUN_LOCATION);
      expect(row.location).toBe("Loudoun County, VA");
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
    for (const row of parseVaLoudounBoard(F1, REF_NOW).rows) {
      expect(row.external_id.startsWith(`${VA_LOUDOUN_ID_PREFIX}-`)).toBe(true);
      expect(row.external_id).toMatch(/^loudoun-\d+$/);
      expect(row.source_url).toBe(`${VA_LOUDOUN_ENDPOINT}?bidID=${row.external_id.slice(B.length + 1)}`);
      expect(row.source_url!.startsWith("https://www.loudoun.gov/bids.aspx?bidID=")).toBe(true);
    }
  });
  test("no description carries the board's `Read on` affordance or a raw entity", () => {
    for (const row of parseVaLoudounBoard(F1, REF_NOW).rows) {
      expect(row.description).not.toMatch(/Read\s*on/i);
      expect(`${row.title} ${row.description}`).not.toMatch(/&(?:nbsp|ldquo|rdquo|rsquo|mdash|amp);/);
    }
  });
});

describe("va_loudoun — the query-param trap fails safe on the real trap response", () => {
  test("`?showAllBids=true&Status=all` (HTTP 404 capture) → ZERO rows + `{shape_change: 1}`", () => {
    const res = parseVaLoudounBoard(TRAP, REF_NOW);
    expect(res.rows).toEqual([]);
    expect(res.parsed).toEqual([]);
    expect(res.skipped).toEqual({ shape_change: 1 });
  });
  test("the board's zone is UNVERIFIED, and the copy suppresses a countdown rather than guess", () => {
    expect(VA_LOUDOUN_DUE_DATE_ZONE_UNVERIFIED).toBe(true);
    expect(VA_LOUDOUN_COPY.timeZoneNote).toContain("not settled");
    expect(VA_LOUDOUN_COPY.timeZoneNote).toContain("does not show a countdown");
  });
});

describe("va_loudoun — copy + count line (no coverage claim, count quoted not hardcoded)", () => {
  test("the publisher line names the board's own publisher and the badge is the place", () => {
    expect(VA_LOUDOUN_COPY.publisherLine).toContain("County of Loudoun");
    expect(VA_LOUDOUN_COPY.badge).toBe("Loudoun County");
    expect(VA_LOUDOUN_COPY.noClaimsLine).toContain("no claim about which trades appear");
  });
  test("the count line quotes a REAL count, stamped ET", () => {
    const line = vaLoudounCountLine(10, "2026-10-08 12:00");
    expect(line).toBe(
      "County of Loudoun's bid board listed 10 open solicitations · last checked by Contrax 2026-10-08 12:00 ET.",
    );
    expect(line).toContain("10");
  });
  test("the 2026-10-08 capture carries no delivery / courier / freight row (no trade claim)", () => {
    const cats = parseVaLoudounBoard(F1, REF_NOW).rows.map((r) => r.category);
    expect(cats).not.toContain("Transportation");
    expect(cats).not.toContain("Janitorial");
  });
});

describe("va_loudoun — registration (tail source · class map · VA home · LOCAL badge)", () => {
  test("the runner carries va_loudoun as a tail source with this connector's fetch", () => {
    const entry = TAIL_SOURCES.find((s) => s.name === VA_LOUDOUN_SOURCE);
    expect(entry).toBeDefined();
    expect(entry!.fetchFn).toBe(fetchVaLoudounBids);
    expect(new Set(TAIL_SOURCES.map((s) => s.name)).size).toBe(TAIL_SOURCES.length);
  });
  test("the class map marks it LOCAL with the Loudoun County badge and a VA scope", () => {
    const rec = SOURCE_CLASSES[VA_LOUDOUN_SOURCE];
    expect(rec.class).toBe("local");
    expect(rec.city).toBe("Loudoun County");
    expect(rec.scopeState).toBe("VA");
    expect(rec.searchScope).toBe("city-open-data");
    expect(rec.recordType).toBe("opportunity");
  });
  test("the home jurisdiction is VA by construction (not text-derived)", () => {
    expect(SOURCE_HOME_JURISDICTIONS[VA_LOUDOUN_SOURCE]).toBe("VA");
    const cols = deriveInsertLocationColumns({
      location: "Loudoun County, VA",
      agency: "County of Loudoun",
      title: "CEI Services for Route 15 N Widening",
      description: "Proposals are due October 13, 2026 no later than 4:00 PM.",
      sourceName: VA_LOUDOUN_SOURCE,
    });
    expect(cols.source_jurisdiction).toBe("VA");
    expect(cols.location_conflict).toBe(false);
  });
  test("a new local source needs no cert-matching change and is NOT relabelled Federal", () => {
    expect(NON_STATE_LOCAL_SOURCES.has(VA_LOUDOUN_SOURCE)).toBe(false);
    expect(isStateLocalSource([VA_LOUDOUN_SOURCE])).toBe(true);
    expect(sourceBadgeLabel(VA_LOUDOUN_SOURCE)).toBe("Loudoun County");
  });
});
