/**
 * The SHARED CivicEngage / CivicPlus bid-board reader (`civicengage-bids.ts`).
 *
 * DETERMINISTIC, ZERO NETWORK, NO DATABASE, NO `mock.module`. Every byte read
 * here is a VERBATIM capture of a live board committed under
 * `fixtures/<board>/` (see each README for provenance, byte sizes and sha256s);
 * the ONE fetch path is exercised through an in-process `globalThis.fetch` stub
 * built from those same bytes, so nothing in this file depends on the network or
 * on which test file bun happens to run first.
 *
 * What the pins defend (they are the reasons the module exists):
 *   · the BARE-URL rule — a query-param board URL is refused at CONFIG load, and
 *     the trap response (`?showAllBids=true&Status=all`) parses to ZERO rows with
 *     a loud `shape_change`, never to a plausible empty board;
 *   · the two div.bidStatus child divs (labels vs VALUES) — the naive read
 *     returns the label text "Status:";
 *   · the `Bid No.` line is OPTIONAL and anchored on its `<strong>` label;
 *   · row class alternation (`listItemsRow bid` / `… bid alt`) is matched on the
 *     prefix, never the exact string;
 *   · the "Read on" affordance is stripped on EITHER spelling (Dayton writes
 *     `Read&nbsp;on`, the Virginia boards write a plain `Read on`) so the source's
 *     truncated description never leaks the affordance or the title into a
 *     stored description, and mixed entities (`&ldquo;`/`&rsquo;`/`&mdash;`/…)
 *     are decoded;
 *   · "parse or NULL" — a non-date `Closes:` value (the open-ended state these
 *     boards print as `Upon Contract`) → `due_date = null` and the row is STILL
 *     EMITTED; a genuinely past-due row is dropped as `closed` (defensive,
 *     deterministic through the INJECTED reference instant);
 *   · the fail-closed fetch gates: non-2xx, a body below
 *     `CIVICENGAGE_MIN_BODY_BYTES`, a body without the item-region anchors, and a
 *     transport failure all throw `SourceUnreachableError` (DEAD), never zero
 *     rows;
 *   · HONEST DATA — `agency` / `location` come from the BOARD CONFIG, not from
 *     the row text (the synthetic config below deliberately disagrees with the
 *     bytes it parses), `set_aside` is NULL unless the row's own text states a
 *     program, and `naics_code` / `psc` / `notice_type` / `solicitation_number`
 *     stay NULL because the board exposes none.
 */
import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { SourceUnreachableError } from "../fetch-failure";
import {
  CIVICENGAGE_DUE_DATE_ZONE_UNVERIFIED,
  CIVICENGAGE_HEADERS,
  CIVICENGAGE_ITEMS_ANCHOR,
  CIVICENGAGE_MIN_BODY_BYTES,
  CIVICENGAGE_REGION_END_ANCHOR,
  assertCivicEngageConfig,
  civicEngageCategory,
  civicEngageCopy,
  civicEngageCountLine,
  civicEngageFallbackDescription,
  civicEngageRegion,
  civicEngageSetAside,
  fetchCivicEngageBoard,
  parseCivicEngageBoard,
  type CivicEngageBoardConfig,
} from "./civicengage-bids";

const DIR = new URL("./fixtures/loudoun/", import.meta.url);
function fixture(name: string): string {
  return readFileSync(new URL(name, DIR), "utf8");
}
/** Real captured bytes: the open board (fetch 1) and the query-param trap. */
const F1 = fixture("loudoun-open-2026-10-08-fetch1.html");
const F2 = fixture("loudoun-open-2026-10-08-fetch2.html");
const TRAP = fixture("loudoun-query-param-all-2026-10-08.html");
/** Reference instant inside the capture window (2026-10-08), so the defensive
 *  `closed` guard never depends on the wall clock. */
const REF_NOW = Date.parse("2026-10-08T12:00:00Z");

/**
 * A deliberately NON-matching config over REAL Loudoun bytes: `agency` and
 * `location` below appear NOWHERE in the page text, so any row that carries them
 * proves they were stamped from the config (never read or inferred per row). The
 * endpoint/host pair is real because it must satisfy the config guard.
 */
const TEST_CONFIG: CivicEngageBoardConfig = {
  source: "civicengage_reader_probe",
  endpoint: "https://www.loudoun.gov/bids.aspx",
  host: "www.loudoun.gov",
  agency: "Test Reader County",
  location: "Testville, VA",
  idPrefix: "readerprobe",
};

describe("civicengage-bids — config guards (a config mistake fails LOUDLY, never silently)", () => {
  test("a complete config passes", () => {
    expect(() => assertCivicEngageConfig(TEST_CONFIG)).not.toThrow();
    expect(CIVICENGAGE_DUE_DATE_ZONE_UNVERIFIED).toBe(true);
    expect(CIVICENGAGE_MIN_BODY_BYTES).toBeGreaterThan(0);
    expect(CIVICENGAGE_MIN_BODY_BYTES).toBeLessThan(F1.length);
    expect(CIVICENGAGE_HEADERS["User-Agent"]).toContain("Mozilla/5.0");
  });
  test("every required field is required", () => {
    for (const key of ["source", "endpoint", "host", "agency", "location", "idPrefix"] as const) {
      expect(() => assertCivicEngageConfig({ ...TEST_CONFIG, [key]: "" })).toThrow(/is missing/);
    }
  });
  test("the endpoint must be absolute https", () => {
    expect(() =>
      assertCivicEngageConfig({ ...TEST_CONFIG, endpoint: "http://www.loudoun.gov/bids.aspx" }),
    ).toThrow(/must be absolute https/i);
  });
  test("a QUERY-PARAM endpoint is refused at load — that URL is the silent-empty trap", () => {
    const trapUrl = "https://www.loudoun.gov/bids.aspx?showAllBids=true&Status=all";
    expect(() => assertCivicEngageConfig({ ...TEST_CONFIG, endpoint: trapUrl })).toThrow(
      /BARE board URL/,
    );
    // …and the trap URL really is what the board answers with nothing.
    expect(TRAP).not.toContain(CIVICENGAGE_ITEMS_ANCHOR);
  });
  test("a host that does not match the endpoint is refused (a wrong jurisdiction cannot be stamped)", () => {
    expect(() =>
      assertCivicEngageConfig({ ...TEST_CONFIG, host: "www.suffolkva.us" }),
    ).toThrow(/does not match endpoint/);
  });
});

describe("civicengage-bids — region anchors and block shape", () => {
  test("the item region is found on real bytes and runs to its closing script anchor", () => {
    const { start, end } = civicEngageRegion(F1);
    expect(start).toBeGreaterThan(0);
    expect(end).toBeGreaterThan(start);
    expect(F1.slice(start, start + CIVICENGAGE_ITEMS_ANCHOR.length)).toBe(CIVICENGAGE_ITEMS_ANCHOR);
    expect(F1.slice(end, end + CIVICENGAGE_REGION_END_ANCHOR.length)).toBe(
      CIVICENGAGE_REGION_END_ANCHOR,
    );
  });
  test("a page without the anchors reports -1/-1 (never a partial parse)", () => {
    for (const html of ["", "<html></html>", "<html><body><p>maintenance</p></body></html>", TRAP]) {
      const { start, end } = civicEngageRegion(html);
      expect(start).toBe(-1);
      expect(end).toBe(-1);
    }
  });
  test("the item region WITHOUT its closing script anchor also fails safe", () => {
    const truncated = F1.slice(0, F1.indexOf(CIVICENGAGE_REGION_END_ANCHOR));
    const res = parseCivicEngageBoard(truncated, TEST_CONFIG, REF_NOW);
    expect(res.rows).toEqual([]);
    expect(res.parsed).toEqual([]);
    expect(res.skipped).toEqual({ shape_change: 1 });
  });
});

describe("civicengage-bids — real bytes parse to the captured rows, config literals are stamped", () => {
  test("fetch1 and fetch2 (the stability pair) yield the SAME rows and the same fingerprint", () => {
    const a = parseCivicEngageBoard(F1, TEST_CONFIG, REF_NOW);
    const b = parseCivicEngageBoard(F2, TEST_CONFIG, REF_NOW);
    expect(a.rows.length).toBe(10);
    expect(b.rows.length).toBe(10);
    expect(a.skipped).toEqual({});
    expect(b.skipped).toEqual({});
    // Fingerprint = the parsed identity, never a raw-HTML hash (the page echoes a
    // session cookie / __VIEWSTATE per request, so the bytes always differ).
    const fingerprint = (html: string) =>
      JSON.stringify(
        parseCivicEngageBoard(html, TEST_CONFIG, REF_NOW).rows.map((r) => [
          r.external_id,
          r.title,
          r.due_date,
        ]),
      );
    expect(fingerprint(F1)).toBe(fingerprint(F2));
    expect(F1).not.toBe(F2); // the raw bytes really are different requests
  });
  test("agency / location / ids come from the CONFIG, never from the row text", () => {
    const { rows } = parseCivicEngageBoard(F1, TEST_CONFIG, REF_NOW);
    for (const row of rows) {
      expect(row.agency).toBe("Test Reader County");
      expect(row.location).toBe("Testville, VA");
      expect(row.external_id.startsWith("readerprobe-")).toBe(true);
      expect(row.source_url).toBe(
        `https://www.loudoun.gov/bids.aspx?bidID=${row.external_id.replace("readerprobe-", "")}`,
      );
      // The board itself says "County of Loudoun" — proof the literal is the config.
      expect(row.agency).not.toContain("Loudoun");
    }
    // Nothing this source does not publish is ever invented.
    for (const row of rows) {
      expect(row.naics_code).toBeNull();
      expect(row.psc).toBeNull();
      expect(row.notice_type).toBeNull();
      expect(row.solicitation_number).toBeNull();
      expect(row.estimated_value).toBe("Not specified");
      expect(row.set_aside).toBeNull();
    }
  });
  test("the two div.bidStatus child divs: the VALUE is read, the label 'Status:' never is", () => {
    const { parsed } = parseCivicEngageBoard(F1, TEST_CONFIG, REF_NOW);
    expect(parsed.length).toBe(10);
    for (const p of parsed) {
      expect(p.status).toBe("Open");
      expect(p.closes).not.toBe("Closes:");
      expect(p.closes.length).toBeGreaterThan(0);
    }
    const first = parsed.find((p) => p.bidID === "1107")!;
    expect(first.closes).toBe("10/13/2026 4:00 PM");
    expect(first.group).toBe("Procurement");
    expect(first.bidNo).toBe("RFQ 714025");
  });
  test("the optional `Bid No.` line is anchored on its label", () => {
    const { parsed } = parseCivicEngageBoard(F1, TEST_CONFIG, REF_NOW);
    expect(parsed.every((p) => p.bidNo === null || /^RFQ |^IFB |^RFP /.test(p.bidNo))).toBe(true);
    expect(parsed.filter((p) => p.bidNo !== null).length).toBeGreaterThan(0);
    // A row whose Bid-No. line is removed keeps its title and description.
    const stripped = F1.replace(/<strong>Bid No\.<\/strong>[\s\S]*?<\/span>/, "");
    expect(stripped).not.toBe(F1);
    const { rows } = parseCivicEngageBoard(stripped, TEST_CONFIG, REF_NOW);
    expect(rows.length).toBe(10);
    for (const row of rows) expect(row.title.length).toBeGreaterThan(0);
  });
  test("alternating row classes (`bid` / `bid alt`) are matched on the prefix", () => {
    expect(F1).toContain('class="listItemsRow bid alt"');
    const normalized = F1.replace(/class="listItemsRow bid alt"/g, 'class="listItemsRow bid"');
    expect(normalized).not.toBe(F1);
    const a = parseCivicEngageBoard(F1, TEST_CONFIG, REF_NOW).rows.map((r) => r.external_id);
    const b = parseCivicEngageBoard(normalized, TEST_CONFIG, REF_NOW).rows.map((r) => r.external_id);
    expect(b).toEqual(a);
  });
});

describe("civicengage-bids — description hygiene (Read on, entities, source truncation)", () => {
  test("the `Read on` affordance is stripped on EITHER spelling, both before and after the title", () => {
    expect(F1).toContain("Read on");
    const nbsp = F1.split("Read on").join("Read&nbsp;on");
    expect(nbsp).not.toBe(F1);
    for (const html of [F1, nbsp]) {
      const { rows } = parseCivicEngageBoard(html, TEST_CONFIG, REF_NOW);
      expect(rows.length).toBe(10);
      for (const row of rows) {
        expect(row.description).not.toMatch(/Read\s*on/i);
        expect(row.description).not.toContain("[]");
        expect(row.description.length).toBeGreaterThan(0);
      }
    }
  });
  test("no raw entity spelling reaches a stored description or title", () => {
    const { rows } = parseCivicEngageBoard(F1, TEST_CONFIG, REF_NOW);
    for (const row of rows) {
      expect(`${row.title} ${row.description}`).not.toMatch(
        /&(?:nbsp|ldquo|rdquo|lsquo|rsquo|mdash|ndash|hellip|apos|amp|#160);/,
      );
    }
    expect(rows.some((r) => r.description.includes("\u201cRFP\u201d"))).toBe(true);
    // The source's own truncation is PRESERVED (never "cleaned up" into a claim).
    expect(rows.some((r) => r.description.endsWith("..."))).toBe(true);
  });
  test("the fallback description is used ONLY when the source published none", () => {
    const fallback = civicEngageFallbackDescription(TEST_CONFIG);
    expect(fallback).toContain("Test Reader County");
    const { rows } = parseCivicEngageBoard(F1, TEST_CONFIG, REF_NOW);
    for (const row of rows) expect(row.description).not.toBe(fallback);
  });
});

describe("civicengage-bids — the query-param trap and shape changes fail safe", () => {
  test("the real `?showAllBids=true&Status=all` capture → ZERO rows + `{shape_change: 1}` (loud)", () => {
    const res = parseCivicEngageBoard(TRAP, TEST_CONFIG, REF_NOW);
    expect(res.rows).toEqual([]);
    expect(res.parsed).toEqual([]);
    expect(res.skipped).toEqual({ shape_change: 1 });
    expect(res.skippedRows).toEqual([{ id: "readerprobe-board", reason: "shape_change" }]);
  });
  test("anchor-less HTML of any shape → ZERO rows, reason coded, no throw", () => {
    for (const html of ["", "<html></html>", "<html><body><p>Board maintenance</p></body></html>"]) {
      const res = parseCivicEngageBoard(html, TEST_CONFIG, REF_NOW);
      expect(res.rows).toEqual([]);
      expect(res.skipped).toEqual({ shape_change: 1 });
    }
  });
});

describe("civicengage-bids — dates: parse or NULL, never a sentinel lookup, never a dropped row", () => {
  test("a real `Upon Contract` row → due_date NULL and the row is STILL EMITTED", () => {
    const { rows, parsed } = parseCivicEngageBoard(F1, TEST_CONFIG, REF_NOW);
    const open = rows.find((r) => r.external_id === "readerprobe-937")!;
    expect(open.due_date).toBeNull();
    expect(open.title).toContain("Concession Food Services");
    expect(parsed.find((p) => p.bidID === "937")!.closes).toBe("Upon Contract");
  });
  test("a NON-DATE sentinel in either wording → NULL, and no row is lost", () => {
    for (const sentinel of ["Upon Contract", "Open Until Contracted", "TBD", "See solicitation"]) {
      const html = F1.replace("Upon Contract", sentinel);
      expect(html).toContain(sentinel);
      const res = parseCivicEngageBoard(html, TEST_CONFIG, REF_NOW);
      expect(res.rows.find((r) => r.external_id === "readerprobe-937")!.due_date).toBeNull();
      expect(res.rows.length).toBe(10);
      expect(res.skipped).toEqual({});
    }
  });
  test("a real date is stored as published (date part always; exact instant under UTC)", () => {
    const { rows } = parseCivicEngageBoard(F1, TEST_CONFIG, REF_NOW);
    const row = rows.find((r) => r.external_id === "readerprobe-1107")!;
    expect(row.due_date!.slice(0, 10)).toBe("2026-10-13");
    if (!process.env.TZ || /^utc|^etc\/utc|^zulu$/i.test(process.env.TZ)) {
      expect(row.due_date).toBe("2026-10-13T16:00:00.000Z");
      expect(row.due_date).not.toBe("2026-10-13T20:00:00.000Z"); // not ET→UTC shifted
    }
  });
  test("a genuinely past-due row is dropped as `closed` (defensive, deterministic)", () => {
    const res = parseCivicEngageBoard(F1.replace("Upon Contract", "1/2/2020 10:00 AM"), TEST_CONFIG, REF_NOW);
    expect(res.skipped).toEqual({ closed: 1 });
    expect(res.skippedRows).toEqual([{ id: "readerprobe-937", reason: "closed" }]);
    expect(res.rows.length).toBe(9);
    expect(res.parsed.length).toBe(10); // it was READ; the guard dropped it
  });
  test("a page default change to `Closed` is caught by the value guard, not by the count", () => {
    const html = F1.replace("<span>Open</span>", "<span>Closed</span>");
    expect(html).not.toBe(F1);
    const res = parseCivicEngageBoard(html, TEST_CONFIG, REF_NOW);
    expect(res.skipped).toEqual({ not_open: 1 });
    expect(res.rows.length).toBe(9);
    expect(res.parsed.length).toBe(10);
  });
});

describe("civicengage-bids — trade + set-aside use the SHARED rules, never a local branch", () => {
  test("the shared classifier decides Transportation / Janitorial", () => {
    expect(civicEngageCategory("Courier Services", "")).toBe("Transportation");
    expect(civicEngageCategory("Trucking services", "")).toBe("Transportation");
    expect(civicEngageCategory("IFB AD26016 Industrial Electrical Cleaning Services", "")).toBe(
      "Janitorial",
    );
    // The product veto still applies: a container purchase is not a waste service.
    expect(civicEngageCategory("IFB 26060Z Custom 5 Cubic Yard Dumpster Liners", "")).toBe("Other");
  });
  test("the structural fallbacks never emit a fabricated trade", () => {
    expect(civicEngageCategory("Roadway & Civil Design Services for Route 15 Widening", "")).toBe(
      "Construction",
    );
    expect(civicEngageCategory("Library Material Suppliers", "")).toBe("Supplies & Equipment");
    expect(civicEngageCategory("Legislative Services", "")).toBe("Other");
  });
  test("the 2026-10-08 captures carry NO delivery / courier / freight trade (no coverage claim)", () => {
    const { rows } = parseCivicEngageBoard(F1, TEST_CONFIG, REF_NOW);
    expect(rows.map((r) => r.category)).not.toContain("Transportation");
    expect(rows.map((r) => r.category)).not.toContain("Janitorial");
  });
  test("set_aside is set ONLY when the row text literally states a program — never inferred", () => {
    expect(civicEngageSetAside("A municipal bid from a Virginia locality")).toBeNull();
    expect(civicEngageSetAside("Library Material Suppliers")).toBeNull();
    expect(civicEngageSetAside("Small Business set-aside")).toBe("Small Business set-aside");
    expect(civicEngageSetAside("(SDVOSB) preferred")).toBe("SDVOSB");
    expect(civicEngageSetAside("8(a) sole source")).toBe("8(a)");
    expect(civicEngageSetAside("HUBZone firms encouraged")).toBe("HUBZone");
    expect(civicEngageSetAside("SBA set-aside")).toBe("SBA set-aside");
  });
});

describe("civicengage-bids — copy is honest, count lines quote a REAL count", () => {
  const copy = civicEngageCopy(TEST_CONFIG);
  test("the publisher line and badge name the board's own publisher, with no invented hierarchy", () => {
    expect(copy.publisherLine).toContain("Test Reader County");
    expect(copy.badge).toBe("Testville"); // ", VA" is stripped for the badge
    expect(copy.publisherNote).toContain("Test Reader County");
    expect(copy.publisherNote).toContain("no department hierarchy is invented");
  });
  test("the zone note states the unsettled zone and the countdown suppression", () => {
    expect(copy.timeZoneNote).toContain("not settled");
    expect(copy.timeZoneNote).toContain("never shifted");
    expect(copy.timeZoneNote).toContain("does not show a countdown");
    expect(CIVICENGAGE_DUE_DATE_ZONE_UNVERIFIED).toBe(true);
  });
  test("the copy makes NO coverage or trade claim", () => {
    expect(copy.noClaimsLine).toContain("does not warrant");
    expect(copy.noClaimsLine).toContain("no claim about which trades appear");
    expect(copy.openSetDefinition).toContain("currently lists as open");
    const joined = Object.values(copy).join(" ");
    expect(joined).not.toMatch(/all (?:Virginia|county|city) (?:bids|solicitations)/i);
  });
  test("the count line quotes the number it is GIVEN, in ET, with no hardcoded number", () => {
    expect(civicEngageCountLine(TEST_CONFIG, 10, "2026-10-08 12:00")).toBe(
      "Test Reader County's bid board listed 10 open solicitations · last checked by Contrax 2026-10-08 12:00 ET.",
    );
    expect(civicEngageCountLine(TEST_CONFIG, 0, "2026-10-08 12:00")).toContain("listed 0 open");
    const fromDate = civicEngageCountLine(TEST_CONFIG, 3, new Date("2026-10-08T16:00:00Z"));
    expect(fromDate).toContain("listed 3 open");
    expect(fromDate).toContain("2026-10-08 12:00"); // 16:00Z == 12:00 America/New_York
    expect(fromDate.endsWith(" ET.")).toBe(true);
  });
});

describe("civicengage-bids — fetch gates (fail CLOSED, a dead board never reads as an honest empty)", () => {
  /** In-process fetch stub — no network, and it records the URL actually asked for. */
  function stubFetch(resp: { ok: boolean; status: number; body: string }) {
    const urls: string[] = [];
    const original = globalThis.fetch;
    globalThis.fetch = (async (url: string) => {
      urls.push(String(url));
      return { ok: resp.ok, status: resp.status, text: async () => resp.body } as unknown as Response;
    }) as typeof fetch;
    return { urls, restore: () => void (globalThis.fetch = original) };
  }
  /** In-process fetch stub that fails the way a dead network does. */
  function stubFetchThrow(message: string) {
    const original = globalThis.fetch;
    globalThis.fetch = (async () => {
      throw new Error(message);
    }) as unknown as typeof fetch;
    return { restore: () => void (globalThis.fetch = original) };
  }

  test("GATE ①: a non-2xx status is UNREACHABLE, never an empty board", async () => {
    const s = stubFetch({ ok: false, status: 404, body: TRAP });
    try {
      await expect(fetchCivicEngageBoard(TEST_CONFIG, REF_NOW)).rejects.toThrow(
        SourceUnreachableError,
      );
      await expect(fetchCivicEngageBoard(TEST_CONFIG, REF_NOW)).rejects.toThrow(
        /HTTP 404 for https:\/\/www\.loudoun\.gov\/bids\.aspx/,
      );
    } finally {
      s.restore();
    }
  });
  test("GATE ②: a body below the size floor (an error stub) is UNREACHABLE", async () => {
    const body = "<html><body>Service temporarily unavailable</body></html>";
    expect(body.length).toBeLessThan(CIVICENGAGE_MIN_BODY_BYTES);
    const s = stubFetch({ ok: true, status: 200, body });
    try {
      await expect(fetchCivicEngageBoard(TEST_CONFIG, REF_NOW)).rejects.toThrow(
        /refusing to read it as an empty board/,
      );
    } finally {
      s.restore();
    }
  });
  test("GATE ③: a 200 whose item-region anchors are missing (the trap page) is UNREACHABLE", async () => {
    expect(TRAP.length).toBeGreaterThan(CIVICENGAGE_MIN_BODY_BYTES); // passes gate ②, fails gate ③
    const s = stubFetch({ ok: true, status: 200, body: TRAP });
    try {
      await expect(fetchCivicEngageBoard(TEST_CONFIG, REF_NOW)).rejects.toThrow(
        /item-region anchors missing/,
      );
    } finally {
      s.restore();
    }
  });
  test("GATE ④: a transport failure is UNREACHABLE", async () => {
    const s = stubFetchThrow("getaddrinfo ENOTFOUND www.loudoun.gov");
    try {
      await expect(fetchCivicEngageBoard(TEST_CONFIG, REF_NOW)).rejects.toThrow(
        SourceUnreachableError,
      );
      await expect(fetchCivicEngageBoard(TEST_CONFIG, REF_NOW)).rejects.toThrow(
        /request failed: getaddrinfo ENOTFOUND/,
      );
    } finally {
      s.restore();
    }
  });
  test("the real captured bytes PASS every gate, and the BARE URL is the only request", async () => {
    const s = stubFetch({ ok: true, status: 200, body: F1 });
    try {
      const result = await fetchCivicEngageBoard(TEST_CONFIG, REF_NOW);
      expect(result.rows.length).toBe(10);
      expect(result.skipped).toEqual({});
      expect(s.urls).toEqual(["https://www.loudoun.gov/bids.aspx"]);
      expect(s.urls[0]).not.toContain("?");
    } finally {
      s.restore();
    }
  });
  test("an honest EMPTY board (200, anchors present, nothing listed) returns ZERO rows and NO error", async () => {
    const empty = F1.replace(
      F1.slice(F1.indexOf(CIVICENGAGE_ITEMS_ANCHOR), F1.indexOf(CIVICENGAGE_REGION_END_ANCHOR)),
      `${CIVICENGAGE_ITEMS_ANCHOR}</div>`,
    );
    expect(empty).not.toBe(F1);
    expect(empty.length).toBeGreaterThan(CIVICENGAGE_MIN_BODY_BYTES);
    const s = stubFetch({ ok: true, status: 200, body: empty });
    try {
      const result = await fetchCivicEngageBoard(TEST_CONFIG, REF_NOW);
      expect(result.rows).toEqual([]);
      expect(result.skipped).toEqual({});
    } finally {
      s.restore();
    }
  });
});
