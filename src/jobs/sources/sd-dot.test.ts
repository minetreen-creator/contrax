/**
 * SDDOT lettings (`sd_dot`) connector pins. Zero network, no database: the
 * fixtures hold the verbatim pages captured 2026-10-12 (gzipped; see
 * fixtures/sd-dot/README.md for the URLs and sha256s); `now` is injected.
 */
import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { gunzipSync } from "node:zlib";
import { deriveInsertLocationColumns } from "~/lib/location-state";
import { SOURCE_CLASSES } from "~/lib/source-class";
import { TAIL_SOURCES } from "../runner";
import {
  parseSdDot,
  parseSdDotContracts,
  parseSdDotDetail,
  parseSdDotIndex,
  sdDotArea,
  sdDotContractNumber,
  sdDotDateKey,
  sdDotDetailShapeOk,
  sdDotDueMs,
  sdDotIndexShapeOk,
  sdDotLettingDate,
  sdDotLettingUrl,
  sdDotPcn,
  sdDotWorkDescription,
  type SdDotLetting,
} from "./sd-dot";

const read = (name: string): string =>
  gunzipSync(readFileSync(new URL(`./fixtures/sd-dot/${name}`, import.meta.url))).toString("utf8");

const INDEX = read("index-2026-10-12.html.gz");
const LETTING_1021 = read("letting-2026-10-21.html.gz");
const LETTING_1104 = read("letting-2026-11-04.html.gz");

/** Captured 2026-10-12T02:52Z — both advertised lettings are still ahead. */
const CAPTURED = Date.parse("2026-10-12T02:52:00Z");

const LINKS = parseSdDotIndex(INDEX);
const LETTINGS: SdDotLetting[] = [
  parseSdDotDetail(LINKS[0]!.args, LETTING_1021)!,
  parseSdDotDetail(LINKS[1]!.args, LETTING_1104)!,
];

describe("sd_dot — index page (captured)", () => {
  test("only the currently-advertised lettings are read", () => {
    // The page also lists five post-bid lettings and four historical region
    // searches; none of them may become a row.
    expect(INDEX).toContain("Lettings Currently Advertised for Bids");
    expect(INDEX).toContain("Status of Lettings Post Bid Opening");
    expect(LINKS.length).toBe(2);
    expect(LINKS.map((l) => l.dateText)).toEqual(["October 21, 2026", "November 4, 2026"]);
    for (const l of LINKS) expect(l.args).toMatch(/^[A-F0-9]{48}$/);
  });
  test("the shape guard distinguishes a reshape from honest-empty", () => {
    expect(sdDotIndexShapeOk(INDEX)).toBe(true);
    // A page that no longer carries the advertised-lettings repeater is a reshape…
    expect(sdDotIndexShapeOk("<html><body>Service Unavailable</body></html>")).toBe(false);
    // …but an advertised-lettings repeater with zero entries is still the shape.
    expect(sdDotIndexShapeOk('<p>Lettings Currently Advertised for Bids</p><span id="x_repCurLettings_ctl00_LettingId"></span>')).toBe(true);
    expect(parseSdDotIndex("<html></html>")).toEqual([]);
  });
});

describe("sd_dot — letting page (captured)", () => {
  test("both advertised lettings parse, with the page's own dates and rows", () => {
    expect(LETTINGS[0]!.lettingDate).toBe("10/21/2026");
    expect(LETTINGS[0]!.contracts.length).toBe(9);
    expect(LETTINGS[1]!.lettingDate).toBe("11/04/2026");
    expect(LETTINGS[1]!.contracts.length).toBe(7);
    expect(sdDotDetailShapeOk(LETTING_1021)).toBe(true);
    expect(sdDotDetailShapeOk("<html></html>")).toBe(false);
    expect(parseSdDotDetail("A", "<html></html>")).toBeNull();
    // Nothing is read before the item table (the "Tentative Future Bid Opening
    // Dates" list and the post-bid notices live outside it).
    expect(sdDotLettingDate(LETTING_1021)).toBe("10/21/2026");
    expect(parseSdDotContracts("<html></html>")).toEqual([]);
  });
  test("a row reads exactly as SDDOT prints it", () => {
    const first = LETTINGS[0]!.contracts[0]!;
    expect(first.item).toBe("* 1");
    expect(first.contractInfo).toBe("NH-EM-TA 0100(107)411 - Grading, PCC, C&G, Storm, Light - PCN - 01VA");
    expect(first.area).toBe("Sioux Falls Area");
    expect(first.addendums).toBe("0 - addendums for this contract");
    expect(first.questions).toBe("3 - questions for this contract");
    expect(first.workTypes).toBe("Work Type 1 or Work Type 3");
  });
});

describe("sd_dot — rows (captured)", () => {
  test("16 advertised contracts, all accepted, none invented", () => {
    const { rows, skipped } = parseSdDot(LETTINGS, CAPTURED);
    expect(skipped).toEqual({});
    expect(rows.length).toBe(16);
    for (const r of rows) {
      expect(r.external_id).toMatch(/^sddot-2026-(10-21|11-04)-.+/);
      expect(r.agency).toBe("South Dakota Department of Transportation");
      expect(r.location).toBe("South Dakota");
      expect(r.category).toBe("Construction");
      expect(r.notice_type).toBe("Highway construction letting");
      expect(r.estimated_value).toBe("Not specified");
      // Every row cites a public letting page on SDDOT's own host.
      const u = new URL(r.source_url);
      expect(u.host).toBe("apps.sd.gov");
      expect(u.pathname).toBe("/HC65BidLetting/ebslettingsdetail1.aspx");
      expect(u.searchParams.get("args")).toMatch(/^[A-F0-9]{48}$/);
      // Fields this source does not publish are never claimed.
      expect(r.naics_code).toBeNull();
      expect(r.psc).toBeNull();
      expect(r.set_aside).toBeNull();
      // The state guard resolves each row to SD from its own text.
      const cols = deriveInsertLocationColumns({
        location: r.location,
        agency: r.agency,
        title: r.title,
        description: r.description,
        sourceName: "sd_dot",
      });
      expect(cols.source_jurisdiction).toBe("SD");
      expect(cols.normalized_state).toBe("SD");
    }
  });
  test("a row reads as the letting page lists it", () => {
    const { rows } = parseSdDot(LETTINGS, CAPTURED);
    const r = rows.find((x) => x.external_id === "sddot-2026-10-21-NH-EM-TA-0100(107)411")!;
    expect(r.title).toBe("Grading, PCC, C&G, Storm, Light — South Dakota DOT contract NH-EM-TA 0100(107)411, Sioux Falls Area");
    expect(r.solicitation_number).toBe("NH-EM-TA 0100(107)411");
    // Letting 10/21/2026 — the page prints no time, so 11:59 PM CDT.
    expect(r.due_date).toBe("2026-10-22T04:59:00.000Z");
    expect(r.description).toContain("SDDOT highway construction letting 10/21/2026 (Sioux Falls Area), item 1");
    expect(r.description).toContain("PCN 01VA");
    expect(r.description).toContain("Prequalification: Work Type 1 or Work Type 3.");
    expect(r.description).toContain("3 question(s) submitted for this contract.");
    expect(r.description).toContain("no time");
    expect(r.source_url).toBe(sdDotLettingUrl(LINKS[0]!.args));
  });
  test("the November letting is stored in CST (DST ended Nov 1)", () => {
    const { rows } = parseSdDot(LETTINGS, CAPTURED);
    const r = rows.find((x) => x.external_id.startsWith("sddot-2026-11-04-"))!;
    expect(r.due_date.endsWith("T05:59:00.000Z")).toBe(true);
  });
  test("a passed letting is never accepted; a repeat is skipped; empty is honest", () => {
    const late = parseSdDot(LETTINGS, Date.parse("2027-01-01T00:00:00Z"));
    expect(late.rows.length).toBe(0);
    expect(late.skipped).toEqual({ closed: 16 });
    const twice = parseSdDot([LETTINGS[0]!, LETTINGS[0]!], CAPTURED);
    expect(twice.skipped).toEqual({ duplicate: 9 });
    expect(twice.rows.length).toBe(9);
    // Zero advertised lettings (a real state between letting cycles) is 0 rows,
    // not an error — the fetch fails only on a reshape.
    expect(parseSdDot([], CAPTURED)).toEqual({ rows: [], skipped: {}, skippedRows: [] });
  });
  test("the same bytes parsed twice give the same rows (no churn on re-run)", () => {
    const print = (ls: SdDotLetting[]) =>
      parseSdDot(ls, CAPTURED).rows.map((r) => [r.external_id, r.title, r.due_date, r.source_url].join(" | "));
    expect(print(LETTINGS)).toEqual(print(LETTINGS));
  });
});

describe("sd_dot — helpers", () => {
  test("letting dates, date-only deadlines and the identity parts", () => {
    expect(sdDotDueMs("10/21/2026")).toBe(Date.parse("2026-10-22T04:59:00Z")); // CDT
    expect(sdDotDueMs("11/04/2026")).toBe(Date.parse("2026-11-05T05:59:00Z")); // CST
    expect(sdDotDueMs("13/40/2026")).toBeNaN();
    expect(sdDotDueMs("soon")).toBeNaN();
    expect(sdDotDateKey("10/21/2026")).toBe("2026-10-21");
    expect(sdDotDateKey("soon")).toBeNull();
    expect(sdDotContractNumber("CIP 11120(  ) - Watermain and Sanitary Sewer - PCN - X06Y")).toBe("CIP 11120( )");
    expect(sdDotContractNumber("NH 0018(251)360")).toBe("NH 0018(251)360");
    expect(sdDotWorkDescription("P 0025(105)149 - Asphalt Concrete Surfacing - PCN - 06DX")).toBe("Asphalt Concrete Surfacing");
    expect(sdDotWorkDescription("NH 0018(251)360")).toBe("");
    expect(sdDotPcn("PT 0183(28)2 - Rip Rap - PCN - 09AC")).toBe("09AC");
    expect(sdDotPcn("PT 0183(28)2 - Rip Rap")).toBeNull();
    expect(sdDotArea("Rapid City      Area")).toBe("Rapid City");
    expect(sdDotLettingUrl("AB")).toBe("https://apps.sd.gov/HC65BidLetting/ebslettingsdetail1.aspx?args=AB");
  });
  test("registration", () => {
    expect(TAIL_SOURCES.some((s) => s.name === "sd_dot")).toBe(true);
    expect(SOURCE_CLASSES.sd_dot).toEqual({
      class: "state",
      scopeState: "SD",
      searchScope: "state-portal",
      recordType: "opportunity",
    });
  });
});
