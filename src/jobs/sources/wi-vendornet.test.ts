/**
 * Wisconsin DOA VendorNet Bids (`wi_vendornet`) — Phase 2 connector pins.
 *
 * DETERMINISTIC, ZERO NETWORK, NO BROWSER, NO DATABASE. Every byte read here comes
 * from ONE real capture of the live board
 * (`fixtures/wi-vendornet/vendornet-openonly-2026-10-06.json`, provenance in that
 * directory's README): the driver's envelope for the open-only set (56 items,
 * 2 pages) as the page actually showed it. The parser is a pure function and the
 * one clock-dependent guard takes an INJECTED instant, so nothing here depends on
 * the wall clock. The live path (a real browser, a real board) is a separate,
 * explicitly-invoked gate — `wi-vendornet.source-validation.test.ts`, opt-in via
 * `BIDS_RUN_LIVE_SOURCE_TESTS=1` — and never runs in the default suite.
 *
 * What these pins defend:
 *   1. registration: the source is in TAIL_SOURCES (the EXISTING sync-bids cadence
 *      picks it up — no new cron), class `state` + badge "State (WI)" (R5/R8), home
 *      jurisdiction "WI", and a NULL set-aside from this source IS a genuinely
 *      pursuable state/local posting (rule 3 / ruling f) — not a federal miss.
 *   2. the real capture parses to 56 rows with 0 skips, the grid's OWN count kept
 *      as the run's count, and no partial open set ever accepted.
 *   3. identity: a real Solicitation Ref # → `wi-<ref>`; the MMSD rows whose ref
 *      cell merely repeats the solicitation text → the deterministic slug, counted
 *      apart from an empty ref cell (never borrowed, never positional).
 *   4. data honesty: only `bids` columns are written — `bid_type` / `available_date`
 *      stay in the diagnostics (no migration, nothing stuffed into a wrong column),
 *      `set_aside`/`naics_code`/`psc`/`notice_type` stay NULL, `location` is the
 *      source's own statewide scope.
 *   5. fail-closed: a broken envelope, unmapped columns, a missing count text, or a
 *      count that outruns the rows read yields ZERO rows + a `shape_change` skip
 *      (and, in the fetch path, an UNREACHABLE source — never "empty").
 *   6. the §4 copy: the owner-locked strings verbatim, and a count line that can
 *      only be built from a real run's numbers.
 */
import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { certMatches, isStateLocalSource, NON_STATE_LOCAL_SOURCES } from "~/lib/cert-matching";
import { deriveInsertLocationColumns, SOURCE_HOME_JURISDICTIONS } from "~/lib/location-state";
import { resolveSourceClass, sourceBadgeLabel, SOURCE_CLASSES } from "~/lib/source-class";
import { TAIL_SOURCES } from "../runner";
import {
  centralDateOnly,
  dueDayFromText,
  fetchWiVendornetBids,
  parseWiVendornetPayload,
  resolveWiVendornetDriverConfig,
  validateWiVendornetPayload,
  wiRefIsUsable,
  wiSlugExternalId,
  WI_VENDORNET_COPY,
  WI_VENDORNET_ENDPOINT,
  WI_VENDORNET_HOST,
  WI_VENDORNET_LOCATION,
  WI_VENDORNET_SOURCE,
  wiVendornetCountLine,
  type WiVendornetPayload,
} from "./wi-vendornet";

const FIXTURE = "vendornet-openonly-2026-10-06.json";
function fixturePayload(): WiVendornetPayload {
  const raw = readFileSync(new URL(`./fixtures/wi-vendornet/${FIXTURE}`, import.meta.url), "utf8");
  return JSON.parse(raw) as WiVendornetPayload;
}
/** A deep copy so a test can break ONE field without touching the real capture. */
function payloadCopy(): WiVendornetPayload {
  return JSON.parse(JSON.stringify(fixturePayload())) as WiVendornetPayload;
}
/**
 * The capture's own "now": 2026-10-06 10:00 CT. The open-only guard compares
 * CALENDAR DAYS in Central Time, so this pins the fixture's reference day to
 * 2026-10-06 — the day its grid footer was filtered on.
 */
const CAPTURE_NOW = Date.parse("2026-10-06T15:00:00Z");
/** The two MMSD rows whose ref cell repeats the solicitation text (measured). */
const MMSD_TITLE = "PFAS Testing of Wastewater and Biosolids Consultant";

describe("wi_vendornet registration + provenance class", () => {
  test("the source is registered in TAIL_SOURCES (the existing sync-bids cadence, no new cron)", () => {
    const tail = TAIL_SOURCES.find((s) => s.name === WI_VENDORNET_SOURCE);
    expect(tail).toBeDefined();
    expect(typeof tail!.fetchFn).toBe("function");
  });

  test("class map: state / WI / state-portal / opportunity (R5 + R8)", () => {
    expect(SOURCE_CLASSES.wi_vendornet).toEqual({
      class: "state",
      scopeState: "WI",
      searchScope: "state-portal",
      recordType: "opportunity",
    });
    expect(resolveSourceClass(WI_VENDORNET_SOURCE)).toBe("state");
    // STATE → the badge is the state's own name, never a city (earlier defect).
    expect(sourceBadgeLabel(WI_VENDORNET_SOURCE)).toBe(WI_VENDORNET_COPY.badge);
    expect(sourceBadgeLabel(WI_VENDORNET_SOURCE)).toBe("State (WI)");
  });

  test("the write path pins the home jurisdiction to WI (provable by construction, never text-derived)", () => {
    expect(SOURCE_HOME_JURISDICTIONS[WI_VENDORNET_SOURCE]).toBe("WI");
    // A buyer the source really shows: "Madison Metropolitan Sewerage District".
    // The STATE comes from the source pin, not from the buyer string (R7/b), and a
    // free-text buyer that names no state cannot make the resolver claim one.
    const derived = deriveInsertLocationColumns({
      sourceName: WI_VENDORNET_SOURCE,
      location: WI_VENDORNET_LOCATION,
      agency: "Madison Metropolitan Sewerage District",
      title: "PFAS Testing of Wastewater and Biosolids Consultant",
      description: "",
    });
    expect(derived.source_jurisdiction).toBe("WI");
  });

  test("ruling (f): a NULL set-aside from this state source stays pursuable — and is never a federal miss", () => {
    expect(NON_STATE_LOCAL_SOURCES.has(WI_VENDORNET_SOURCE)).toBe(false);
    expect(isStateLocalSource([WI_VENDORNET_SOURCE])).toBe(true);
    // The rule-3 decision the certification layer makes for a state portal's row.
    expect(certMatches(null, [WI_VENDORNET_SOURCE], "sb")).toBe("include");
    // …and it is NOT a federal feed, so no federal-only program can be claimed.
    expect(certMatches(null, [WI_VENDORNET_SOURCE], "8a")).toBe("exclude");
  });
});

describe("wi_vendornet — the real open-only capture", () => {
  test("the fixture is the real shape: 56 open items, 2 pages, the grid's own footers", () => {
    const p = fixturePayload();
    expect(p.source).toBe(WI_VENDORNET_SOURCE);
    expect(p.endpoint).toBe(WI_VENDORNET_ENDPOINT);
    expect(p.countFromSource).toBe(56);
    expect(p.rowsSeen).toBe(56);
    expect(p.pagesRendered).toBe(2);
    expect(p.pages.map((pg) => pg.footerText)).toEqual(["1 - 50 of 56 items", "51 - 56 of 56 items"]);
    // The rows really came over the Blazor WebSocket, not from the shell.
    expect((p.blazor as { webSocketCreated?: number }).webSocketCreated).toBe(1);
  });

  test("56 rows accepted, zero skips, and the source's own count carried through", () => {
    const r = parseWiVendornetPayload(fixturePayload(), CAPTURE_NOW);
    expect(r.meta.fatalReason).toBeNull();
    expect(r.rows.length).toBe(56);
    expect(r.parsed.length).toBe(56);
    expect(Object.keys(r.skipped)).toEqual([]);
    expect(r.meta.countFromSource).toBe(56);
    expect(r.meta.pageFooters).toEqual(["1 - 50 of 56 items", "51 - 56 of 56 items"]);
    expect(r.meta.referenceDay).toBe("2026-10-06");
    expect(r.meta.diagnostics.refMissing).toBe(0);
    expect(r.meta.diagnostics.refRepeatedTitle).toBe(2); // the two MMSD rows
    expect(r.meta.diagnostics.collisions).toBe(0);
    expect(r.meta.diagnostics.dueDateUnparseable).toBe(0);
    expect(r.meta.diagnostics.bidTypeAbsent).toBe(11); // the capture's empty Bid Type cells
    // Bid types are captured as metadata ONLY (there is no `bid_type` column).
    expect(r.meta.diagnostics.bidTypesSeen).toEqual(["RFB", "RFI", "RFP", "Simplified Bid"]);
  });

  test("every emitted row is honest and uses ONLY existing `bids` columns", () => {
    const r = parseWiVendornetPayload(fixturePayload(), CAPTURE_NOW);
    const ids = new Set<string>();
    for (const b of r.rows) {
      // Column discipline: exactly the existing RawBid fields, nothing else — the
      // source's bid_type / available_date stay in the diagnostics (no migration).
      expect(Object.keys(b).sort()).toEqual(
        [
          "agency",
          "category",
          "description",
          "due_date",
          "estimated_value",
          "external_id",
          "location",
          "naics_code",
          "notice_type",
          "psc",
          "set_aside",
          "solicitation_number",
          "source_url",
          "title",
        ].sort(),
      );
      expect(b.title.length).toBeGreaterThan(0);
      expect(b.agency.length).toBeGreaterThan(0);
      expect(b.location).toBe("Wisconsin");
      expect(b.source_url).toBe(WI_VENDORNET_ENDPOINT);
      expect(new URL(b.source_url).host).toBe(WI_VENDORNET_HOST);
      expect(b.estimated_value).toBe("Not specified");
      // Nothing inferred: no federal set-aside claim, no NAICS/PSC/notice type.
      expect(b.set_aside).toBeNull();
      expect(b.naics_code).toBeNull();
      expect(b.psc).toBeNull();
      expect(b.notice_type).toBeNull();
      // Null-or-parseable, never an invented instant.
      if (b.due_date != null) expect(Number.isNaN(Date.parse(b.due_date))).toBe(false);
      expect(ids.has(b.external_id)).toBe(false);
      ids.add(b.external_id);
    }
    // The natural-key danger the connector must not create: two rows that differ
    // only in fields the `bids` natural-key index ignores.
    expect(ids.size).toBe(56);
  });

  test("identity: a real ref becomes wi-<ref>; the repeated-title refs become the slug", () => {
    const r = parseWiVendornetPayload(fixturePayload(), CAPTURE_NOW);
    const greenBay = r.rows.find((b) => b.external_id === "wi-2027-GRBATH-01410-RFB");
    expect(greenBay).toBeDefined();
    expect(greenBay!.title).toBe("UW-Green Bay Athletic Apparel, Footware, and Equipment");
    expect(greenBay!.agency).toBe("University of Wisconsin Green Bay");
    expect(greenBay!.solicitation_number).toBe("2027-GRBATH-01410-RFB");

    const mmsd = r.parsed.filter((p) => p.refCell && p.refCell.includes(MMSD_TITLE));
    expect(mmsd.length).toBe(1);
    expect(mmsd[0]!.idSource).toBe("slug");
    expect(mmsd[0]!.externalId.startsWith("wi-s-2026-10-30-")).toBe(true); // due-day prefix
    expect(mmsd[0]!.ref).toBeNull();
    expect(mmsd[0]!.organization).toBe("Madison Metropolitan Sewerage District");
    // The slug id is derived from the row, never from its page position.
    expect(mmsd[0]!.externalId).toBe(
      wiSlugExternalId({
        title: MMSD_TITLE,
        organization: "Madison Metropolitan Sewerage District",
        dueDay: "2026-10-30",
      }),
    );
    const row = r.rows.find((b) => b.external_id === mmsd[0]!.externalId)!;
    // A slug row has no usable source reference, so it claims no solicitation number.
    expect(row.solicitation_number).toBeNull();
  });

  test("re-parsing the same bytes is byte-identical (no churn on a re-run)", () => {
    const a = parseWiVendornetPayload(fixturePayload(), CAPTURE_NOW);
    const b = parseWiVendornetPayload(fixturePayload(), CAPTURE_NOW);
    expect(JSON.stringify(a.rows)).toBe(JSON.stringify(b.rows));
    expect(JSON.stringify(a.meta.diagnostics)).toBe(JSON.stringify(b.meta.diagnostics));
  });

  test("descriptions state the publisher and the source's own values — and claim nothing more", () => {
    const r = parseWiVendornetPayload(fixturePayload(), CAPTURE_NOW);
    const row = r.rows.find((b) => b.external_id === "wi-2027-GRBATH-01410-RFB")!;
    expect(row.description).toContain("Wisconsin DOA VendorNet bid board");
    expect(row.description).toContain("2027-GRBATH-01410-RFB");
    expect(row.description).toContain("RFB");
    expect(row.description).toContain("Central Time");
    // No completeness claim may ride along in a row's own text.
    expect(row.description.toLowerCase()).not.toContain("all wisconsin");
    expect(row.description.toLowerCase()).not.toContain("every wisconsin");
  });
});

describe("wi_vendornet identity + date helpers (pure)", () => {
  test("wiRefIsUsable rejects empty, over-long, and title-carrying ref cells", () => {
    expect(wiRefIsUsable("", "Some Title Long Enough")).toBe(false);
    expect(wiRefIsUsable("   ", "Some Title Long Enough")).toBe(false);
    expect(wiRefIsUsable(null, "Some Title Long Enough")).toBe(false);
    expect(wiRefIsUsable("2027-UWMIL-01468-RFB", "Elevator Testing and Maintenance")).toBe(true);
    // The MMSD shape: the cell repeats the solicitation text (measured, live).
    expect(
      wiRefIsUsable(
        "MMSD, 2026, PFAS Testing of Wastewater and Biosolids Consultant",
        "PFAS Testing of Wastewater and Biosolids Consultant",
      ),
    ).toBe(false);
    expect(wiRefIsUsable("Prefix - PFAS Testing of Wastewater", "PFAS Testing of Wastewater")).toBe(false);
    expect(wiRefIsUsable("x".repeat(81), "short title")).toBe(false);
  });

  test("wiSlugExternalId is deterministic, due-day-keyed, and never positional", () => {
    const row = { title: "A Title", organization: "An Org", dueDay: "2026-11-01" };
    expect(wiSlugExternalId(row)).toBe(wiSlugExternalId({ ...row }));
    expect(wiSlugExternalId(row)).toStartWith("wi-s-2026-11-01-");
    expect(wiSlugExternalId(row)).not.toBe(wiSlugExternalId({ ...row, dueDay: "2026-11-02" }));
    expect(wiSlugExternalId(row)).not.toBe(wiSlugExternalId({ ...row, organization: "Other Org" }));
    // No due day at all is still a fixed, readable id (never a null or a counter).
    expect(wiSlugExternalId({ ...row, dueDay: null })).toStartWith("wi-s-nodue-");
  });

  test("dueDayFromText reads the source's own cell shapes and refuses to guess", () => {
    expect(dueDayFromText("10/22/2026 02:00 PM")).toBe("2026-10-22");
    expect(dueDayFromText("06/30/2027 11:59 PM")).toBe("2027-06-30");
    expect(dueDayFromText("2026-10-06")).toBe("2026-10-06");
    expect(dueDayFromText("  10/06/2026  ")).toBe("2026-10-06");
    expect(dueDayFromText("TBD")).toBeNull();
    expect(dueDayFromText("")).toBeNull();
    expect(dueDayFromText(null)).toBeNull();
  });

  test("centralDateOnly pins the Central-Time day (the open-set definition is a DATE, not an instant)", () => {
    // 2026-10-06 05:00Z = 2026-10-06 00:00 CDT.
    expect(centralDateOnly(Date.parse("2026-10-06T05:00:00Z"))).toBe("2026-10-06");
    // 2026-10-06 03:00Z is still 2026-10-05 in Central Time — a UTC-day bug would
    // call this row closed one day too early.
    expect(centralDateOnly(Date.parse("2026-10-06T03:00:00Z"))).toBe("2026-10-05");
    expect(centralDateOnly(Date.parse("2026-10-06T15:00:00Z"))).toBe("2026-10-06");
  });
});

describe("wi_vendornet fail-closed guards (cases derived in-test from the real capture)", () => {
  test("honest empty: the grid's own count is 0 ⇒ no rows, no skips, no error", () => {
    const p = payloadCopy();
    p.countFromSource = 0;
    p.rowsSeen = 0;
    p.pages = [{ page: 1, footerText: "0 - 0 of 0 items", rangeStart: 0, rangeEnd: 0, countFromSource: 0, rowCount: 0, firstRef: null, refs: [], rows: [] }];
    p.openOnly = { ...p.openOnly!, footerText: "No items to display", footerKind: "no-items", countFromSource: 0, rowCount: 0 };
    const r = parseWiVendornetPayload(p, CAPTURE_NOW);
    expect(r.meta.fatalReason).toBeNull();
    expect(r.rows.length).toBe(0);
    expect(Object.keys(r.skipped)).toEqual([]);
  });

  test("a count that outruns the rows read is a READ failure — zero rows, never a partial set", () => {
    const p = payloadCopy();
    p.rowsSeen = 40; // the source says 56
    p.pages = [p.pages[0]!];
    expect(validateWiVendornetPayload(p)).toMatchObject({ ok: false, reason: "incomplete" });
    const r = parseWiVendornetPayload(p, CAPTURE_NOW);
    expect(r.rows.length).toBe(0);
    expect(r.skipped.shape_change).toBe(1);
    expect(r.meta.fatalReason).toBe("incomplete");
  });

  test("a non-zero count with zero rows read is a parse failure, not an empty board", () => {
    const p = payloadCopy();
    p.rowsSeen = 0;
    p.pages = [{ page: 1, footerText: "1 - 50 of 56 items", rangeStart: 1, rangeEnd: 50, countFromSource: 56, rowCount: 0, firstRef: null, refs: [], rows: [] }];
    const r = parseWiVendornetPayload(p, CAPTURE_NOW);
    expect(r.rows.length).toBe(0);
    expect(r.meta.fatalReason).toBe("incomplete");
  });

  test("an envelope from another source or host is refused outright", () => {
    const wrongSource = payloadCopy();
    wrongSource.source = "id_ipro";
    expect(parseWiVendornetPayload(wrongSource, CAPTURE_NOW).meta.fatalReason).toBe("envelope");
    const wrongHost = payloadCopy();
    wrongHost.endpoint = "https://example.com/Bids";
    const r = parseWiVendornetPayload(wrongHost, CAPTURE_NOW);
    expect(r.meta.fatalReason).toBe("envelope");
    expect(r.rows.length).toBe(0);
    expect(r.skipped.shape_change).toBe(1);
  });

  test("unmappable columns and a missing count text are refusals, not empty sets", () => {
    const noColumns = payloadCopy();
    noColumns.openOnly = { ...noColumns.openOnly!, columnMapping: "unmapped" };
    expect(parseWiVendornetPayload(noColumns, CAPTURE_NOW).meta.fatalReason).toBe("columns");
    const noHeaders = payloadCopy();
    noHeaders.openOnly = { ...noHeaders.openOnly!, headers: [] };
    expect(parseWiVendornetPayload(noHeaders, CAPTURE_NOW).meta.fatalReason).toBe("columns");
    const noFooter = payloadCopy();
    noFooter.openOnly = { ...noFooter.openOnly!, footerKind: "absent", footerText: null };
    expect(parseWiVendornetPayload(noFooter, CAPTURE_NOW).meta.fatalReason).toBe("count");
    const weirdFooter = payloadCopy();
    weirdFooter.openOnly = { ...weirdFooter.openOnly!, footerKind: "other", footerText: "loading…" };
    expect(parseWiVendornetPayload(weirdFooter, CAPTURE_NOW).meta.fatalReason).toBe("count");
  });

  test("an empty ref cell and a repeated-title ref cell are counted apart and both slug", () => {
    const p = payloadCopy();
    const row = p.pages[0]!.rows[0]!;
    row.ref = "";
    const r = parseWiVendornetPayload(p, CAPTURE_NOW);
    expect(r.rows.length).toBe(56); // the row is KEPT, re-identified
    expect(r.meta.diagnostics.refMissing).toBe(1);
    expect(r.meta.diagnostics.refRepeatedTitle).toBe(2);
    const kept = r.parsed.find((x) => x.title === row.title)!;
    expect(kept.idSource).toBe("slug");
    expect(kept.refCell).toBeNull();
  });

  test("a duplicate id inside one payload is kept, suffixed, and counted", () => {
    const p = payloadCopy();
    // Two DIFFERENT solicitations that would generate the same ref-based id.
    p.pages[0]!.rows[1]!.ref = "2027-GRBATH-01410-RFB";
    p.pages[0]!.rows[1]!.title = "A genuinely different solicitation";
    p.pages[0]!.rows[1]!.organization = "Another Buyer";
    const r = parseWiVendornetPayload(p, CAPTURE_NOW);
    expect(r.meta.diagnostics.collisions).toBe(1);
    expect(r.rows.length).toBe(56); // nothing dropped
    const ids = r.rows.map((b) => b.external_id);
    expect(ids).toContain("wi-2027-GRBATH-01410-RFB");
    expect(ids).toContain("wi-2027-GRBATH-01410-RFB-2");
    expect(new Set(ids).size).toBe(56);
  });

  test("a due date already past is dropped WITH a reason (the render was stale)", () => {
    const p = payloadCopy();
    p.pages[0]!.rows[0]!.due_date = "10/01/2026 02:00 PM";
    const r = parseWiVendornetPayload(p, CAPTURE_NOW);
    expect(r.rows.length).toBe(55);
    expect(r.skipped.not_open).toBe(1);
    expect(r.meta.notOpen).toBe(1);
  });

  test("a row due LATER TODAY is still open (day-inclusive boundary, Central)", () => {
    const p = payloadCopy();
    p.pages[0]!.rows[0]!.due_date = "10/06/2026 11:59 PM";
    const r = parseWiVendornetPayload(p, CAPTURE_NOW);
    expect(r.rows.length).toBe(56);
    expect(r.skipped.not_open ?? 0).toBe(0);
  });

  test("an unreadable due date keeps the row (NULL due_date) and is diagnosed, never dropped", () => {
    const p = payloadCopy();
    p.pages[0]!.rows[0]!.due_date = "TBD";
    const r = parseWiVendornetPayload(p, CAPTURE_NOW);
    expect(r.rows.length).toBe(56);
    expect(r.meta.diagnostics.dueDateUnparseable).toBe(1);
    const kept = r.parsed.find((x) => x.dueText === "TBD")!;
    expect(kept.dueDate).toBeNull();
    expect(kept.dueDay).toBeNull();
  });

  test("a row with no title or no buyer is skipped by reason (never emitted half-blank)", () => {
    const noTitle = payloadCopy();
    noTitle.pages[0]!.rows[0]!.title = "";
    const r1 = parseWiVendornetPayload(noTitle, CAPTURE_NOW);
    expect(r1.skipped.missing_title).toBe(1);
    expect(r1.rows.length).toBe(55);

    const noAgency = payloadCopy();
    noAgency.pages[0]!.rows[0]!.organization = "   ";
    const r2 = parseWiVendornetPayload(noAgency, CAPTURE_NOW);
    expect(r2.skipped.missing_agency).toBe(1);
    expect(r2.rows.length).toBe(55);
  });
});

describe("wi_vendornet driver plumbing (no network in this suite)", () => {
  test("the driver is resolved from the environment, with the workflow's copy winning", () => {
    const fromCwd = resolveWiVendornetDriverConfig({}, "/repo");
    expect(fromCwd.script).toBe("/repo/.github/scripts/vendornet-bids-fetch.mjs");
    expect(fromCwd.node).toBe("node");
    // The driver's own deadline always sits BELOW the spawn timeout, so the driver
    // reports the precise failing stage before we have to kill it.
    expect(fromCwd.deadlineMs).toBeLessThan(fromCwd.timeoutMs);
    const fromEnv = resolveWiVendornetDriverConfig({
      WI_VENDORNET_FETCH_SCRIPT: "/tmp/runner/vendornet/vendornet-bids-fetch.mjs",
      WI_VENDORNET_PAYLOAD_OUT: "/tmp/wi.json",
      WI_VENDORNET_NODE: "/usr/bin/node",
      WI_VENDORNET_SPAWN_TIMEOUT_MS: "60000",
    });
    expect(fromEnv.script).toBe("/tmp/runner/vendornet/vendornet-bids-fetch.mjs");
    expect(fromEnv.outFile).toBe("/tmp/wi.json");
    expect(fromEnv.node).toBe("/usr/bin/node");
    expect(fromEnv.timeoutMs).toBe(60000);
    expect(fromEnv.deadlineMs).toBeLessThanOrEqual(60000);
  });

  test("a driver that cannot run is an UNREACHABLE source, never an empty result", async () => {
    const prev = { ...process.env };
    try {
      process.env.WI_VENDORNET_NODE = "/nonexistent/node-binary-for-this-test";
      process.env.WI_VENDORNET_FETCH_SCRIPT = "/nonexistent/driver.mjs";
      await expect(fetchWiVendornetBids()).rejects.toThrow(/wi_vendornet unreachable/);
    } finally {
      for (const k of Object.keys(process.env)) if (!(k in prev)) delete process.env[k];
      Object.assign(process.env, prev);
    }
  });

  test("a driver that exits 0 without a payload is an UNREACHABLE source too", async () => {
    const prev = { ...process.env };
    try {
      // /bin/true exits 0 and writes nothing: the payload read must fail closed.
      process.env.WI_VENDORNET_NODE = "/bin/true";
      process.env.WI_VENDORNET_FETCH_SCRIPT = "/nonexistent/driver.mjs";
      process.env.WI_VENDORNET_PAYLOAD_OUT = `/tmp/wi-vendornet-absent-${process.pid}.json`;
      await expect(fetchWiVendornetBids()).rejects.toThrow(/payload could not be read/);
    } finally {
      for (const k of Object.keys(process.env)) if (!(k in prev)) delete process.env[k];
      Object.assign(process.env, prev);
    }
  });
});

describe("wi_vendornet §4 copy (owner-locked wording)", () => {
  test("the strings are the plan's, verbatim", () => {
    expect(WI_VENDORNET_COPY.publisherLine).toBe(
      "State and local solicitations as published by Wisconsin DOA VendorNet.",
    );
    expect(WI_VENDORNET_COPY.badge).toBe("State (WI)");
    expect(WI_VENDORNET_COPY.openSetDefinition).toBe(
      "Showing solicitations due today or later. Awarded and canceled solicitations are excluded, as are solicitations whose due date has passed.",
    );
    expect(WI_VENDORNET_COPY.buyerMixNote).toBe(
      "VendorNet hosts solicitations for Wisconsin state agencies, the University of Wisconsin System, and for cities, counties and special districts that publish through it. Contact and buyer details are as the source states them.",
    );
    expect(WI_VENDORNET_COPY.timeZoneNote).toBe(
      "Due dates and times are shown as published by the source (Central Time), and are not converted.",
    );
    expect(WI_VENDORNET_COPY.noClaimsLine).toBe(
      "Contrax checks this source on a schedule, but does not warrant that every Wisconsin solicitation is listed. Always confirm details and deadlines at the official source.",
    );
  });

  test("the count line carries a real number and a real stamp — and the no-claims words are non-committal", () => {
    const line = wiVendornetCountLine(56, new Date("2026-10-06T05:29:16.423Z"));
    expect(line).toContain("listed 56 solicitations due today or later");
    expect(line).toContain("last checked by Contrax 2026-10-06 00:29 CT");
    // Never a completeness claim.
    expect(line.toLowerCase()).not.toContain("all wisconsin");
    expect(WI_VENDORNET_COPY.noClaimsLine).toContain("does not warrant");
  });
});
