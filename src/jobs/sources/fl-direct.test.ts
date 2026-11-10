import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { TAIL_SOURCES } from "../runner";
import { SOURCE_CLASSES } from "~/lib/source-class";
import { resolveStateFromText, SOURCE_HOME_JURISDICTIONS } from "~/lib/location-state";
import { LOCAL_AGENCIES } from "~/lib/local-agencies";
import {
  FDOT_PAGES, fdotWorkCell, fetchFdotPage, fetchFlLeeBids, FL_DIRECT_SOURCES, flCountyLocation, flDirectDeps, leeClose, mapLeeBoard,
  parseFdotLettings, parsePolkBids, parseTampaConstruction, readLeePage, tampaOpening,
} from "./fl-direct";
import { ionwaveThrottleDeps } from "./ionwave-throttle";

ionwaveThrottleDeps.gapMs = 0; // the shared IonWave pace is tested in ionwave-throttle.test.ts

// Owner 2026-11-07: "Yes do the Florida batch".
const fx = (f: string) => readFileSync(new URL(`./fixtures/fl-direct/${f}-2026-11-07.html`, import.meta.url), "utf8");
const now = Date.parse("2026-11-07T06:00:00Z");
const page = (source: string) => FDOT_PAGES.find((p) => p.source === source)!;

test("FDOT Central Office: the Dec 2 letting's 24 proposals, deadline at the start of letting day", () => {
  const { rows, skipped } = parseFdotLettings(page("fl_fdot_central"), fx("fdot-central"), now);
  expect(rows).toHaveLength(24);
  expect(skipped.closed).toBe(178);
  const bridge = rows.find((r) => r.solicitation_number === "T2A91")!;
  expect(bridge.title).toBe("Intermediate Bridge Replacement — FDOT T2A91, Duval County");
  expect(bridge.due_date).toBe("2026-12-02T05:00:00.000Z"); // 12:00 AM EST
  expect(bridge.location).toBe("Duval County, Florida");
  expect(bridge.agency).toBe("Florida Department of Transportation");
  expect(bridge.category).toBe("Construction");
  expect(bridge.notice_type).toBe("Construction letting");
  expect(bridge.source_url).toStartWith("https://ftp.fdot.gov/public/file/");
  expect(bridge.description).toContain("counts the start of that day as the deadline");
});

test("FDOT Turnpike and districts: moved and withdrawn proposals are skipped, notes kept, Panhandle in Central time", () => {
  const tp = parseFdotLettings(page("fl_fdot_turnpike"), fx("fdot-turnpike"), now);
  expect(tp.rows).toHaveLength(15);
  expect(tp.skipped.moved_to_other_letting).toBe(8);
  // E8V64 was moved from Nov 10 to Nov 17: only the Nov 17 listing counts.
  expect(tp.rows.find((r) => r.solicitation_number === "E8V64")!.due_date).toBe("2026-11-17T05:00:00.000Z");
  expect(tp.rows.find((r) => r.solicitation_number === "E8X16")!.title).toBe("Bridge Painting — Florida's Turnpike E8X16, Broward, Miami-Dade counties");
  expect(tp.rows.find((r) => r.solicitation_number === "E8X16")!.location).toBe("Florida");
  const d3 = parseFdotLettings(page("fl_fdot_d3"), fx("fdot-d3"), now);
  const cathodic = d3.rows.find((r) => r.solicitation_number === "E3Y38")!;
  expect(cathodic.title).toBe("Cathodic Protection — FDOT District 3 E3Y38, Walton County");
  expect(cathodic.description).toContain("Prequalification is required to bid on this project.");
  expect(cathodic.due_date).toBe("2026-11-13T06:00:00.000Z"); // 12:00 AM CST
  expect(parseFdotLettings(page("fl_fdot_d5"), fx("fdot-d5"), now).skipped.withdrawn).toBe(1);
  const counts = FDOT_PAGES.map((p) => parseFdotLettings(p, fx(p.source.replace("fl_", "").replace("_", "-")), now).rows.length);
  expect(counts).toEqual([24, 15, 5, 3, 9, 8, 1]);
  expect(() => parseFdotLettings(page("fl_fdot_d1"), "<html>moved</html>", now)).toThrow();
});

test("FDOT work cell: plain lines are the work, bold lines are notes, short program tags dropped", () => {
  expect(fdotWorkCell("Resurfacing<br /><strong>Prequalification is required.<br />Marine insurance may be required.</strong>")).toEqual({
    work: "Resurfacing", notes: ["Prequalification is required.", "Marine insurance may be required."],
  });
  expect(fdotWorkCell("<strong>BDI</strong><br />Bridge Painting")).toEqual({ work: "Bridge Painting", notes: [] });
  expect(flCountyLocation(["Washington"])).toBe("Florida");
  expect(flCountyLocation(["Districtwide"])).toBe("Florida");
  expect(resolveStateFromText(flCountyLocation(["Orange"]))).toBe("FL");
});

test("Polk County: current table only, address-only DQ quotes skipped", () => {
  const { rows, skipped } = parsePolkBids(fx("polk"), now);
  expect(skipped).toEqual({ no_scope_listed: 2 });
  expect(rows.map((r) => r.solicitation_number)).toEqual(["Bid 26-227", "CQ 26-374", "CQ 26-353", "Bid 26-389", "Bid 27-018", "CQ 26-442", "Bid 27-035", "Bid 27-010"]);
  const station = rows.find((r) => r.solicitation_number === "Bid 27-010")!;
  expect(station.title).toBe("Christina Fire Rescue Station");
  expect(station.due_date).toBe("2026-12-09T05:00:00.000Z");
  expect(station.source_url).toBe("https://www.polkfl.gov/bid-form/bid-27-010/");
  expect(station.notice_type).toBe("ITB");
  expect(() => parsePolkBids("<html></html>", now)).toThrow();
});

test("Lee County IonWave: sole/single-source notices skipped, ET close times, addendum noted", () => {
  const board = readLeePage(fx("lee-ionwave"));
  expect(board).toMatchObject({ total: 14, pages: 1 });
  const { rows, skipped } = mapLeeBoard(board.items, now);
  expect(skipped).toEqual({ not_competitive: 6 });
  expect(rows).toHaveLength(8);
  const well = rows.find((r) => r.solicitation_number === "B260290DWJ")!;
  expect(well.title).toBe("North Lee County Phase 3B Well Field Expansion Pipeline & Surface Facilities");
  expect(well.due_date).toBe("2026-11-12T19:30:00.000Z"); // 2:30 PM EST
  expect(well.description).toContain("Addendum 2 has been issued.");
  expect(well.source_url).toMatch(/^https:\/\/leegov\.ionwave\.net\/PublicDetail\.aspx\?bidID=\d+&SourceType=1$/);
  expect(leeClose("11/11/2026 05:30:00 PM (ET)")).toBe("2026-11-11T22:30:00.000Z");
  expect(leeClose("tomorrow")).toBeNull();
});

test("Tampa construction: printed opening time, past openings closed", () => {
  const { rows, skipped } = parseTampaConstruction(fx("tampa-construction"), now);
  expect(skipped).toEqual({ closed: 6 });
  expect(rows.map((r) => r.solicitation_number)).toEqual(["27-C-00001", "27-C-00004", "26-C-00018", "26-C-00038"]);
  expect(rows[0].title).toBe("Citywide Wastewater Collection Systems Repair - FY27");
  expect(rows[0].due_date).toBe("2026-12-01T18:30:00.000Z"); // 1:30 PM EST
  expect(rows[0].source_url).toBe("https://www.tampa.gov/construction-bid/27-c-00001-citywide-wastewater-collection-systems-repair-fy27");
  expect(rows[0].description).toContain("not online");
  expect(tampaOpening("1:30PM, Tuesday, December 01, 2026")).toBe("2026-12-01T18:30:00.000Z");
  expect(tampaOpening("TBD")).toBeNull();
});

test("readers fail loudly on HTTP errors; sources are scheduled and registered in Florida", async () => {
  const saved = { ...flDirectDeps };
  try {
    flDirectDeps.fetch = async () => new Response("no", { status: 503 });
    await expect(fetchFdotPage(FDOT_PAGES[0], now)).rejects.toThrow();
    await expect(fetchFlLeeBids(now)).rejects.toThrow();
  } finally { Object.assign(flDirectDeps, saved); }
  expect(FL_DIRECT_SOURCES).toHaveLength(10);
  for (const s of FL_DIRECT_SOURCES) {
    expect(TAIL_SOURCES.some((t) => t.name === s.name)).toBe(true);
    expect(SOURCE_CLASSES[s.name]?.scopeState).toBe("FL");
    expect(SOURCE_HOME_JURISDICTIONS[s.name]).toBe("FL");
    const local = SOURCE_CLASSES[s.name]?.class === "local";
    expect(local).toBe(!s.name.startsWith("fl_fdot_"));
    expect(LOCAL_AGENCIES.some((a) => a.source === s.name)).toBe(local);
  }
});
