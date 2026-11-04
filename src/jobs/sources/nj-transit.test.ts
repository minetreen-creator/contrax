import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { SOURCE_CLASSES } from "~/lib/source-class";
import { SOURCE_HOME_JURISDICTIONS } from "~/lib/location-state";
import { TAIL_SOURCES } from "../runner";
import {
  calendarBody,
  calendarDueIso,
  fetchNjTransitBids,
  NJ_TRANSIT_SOURCE,
  njTransitDeps,
  parseNjTransitCalendar,
  readCalendarRows,
  solicitationName,
} from "./nj-transit";

// Owner 2026-11-04: a Buffalo visitor found 4 janitorial bids in NJ → "yes" → "Yes" to an NJ TRANSIT reader.
const page = readFileSync(new URL("./fixtures/nj-transit/calendar-2026-11-04.html", import.meta.url), "utf8");
const NOW = Date.parse("2026-11-04T22:00:00Z");

describe("NJ TRANSIT procurement calendar", () => {
  test("the calendar body comes out of the page's Nuxt data", () => {
    const body = calendarBody(page)!;
    expect(body).toContain("FY 2027 (07/01/2026 - 06/30/2027)");
    expect(calendarBody("<html>no data</html>")).toBeNull();
  });

  test("rows read in page order, with the advertisement PDF", () => {
    const rows = readCalendarRows(calendarBody(page)!);
    expect(rows[0]).toMatchObject({ date: "01/07/27", time: "11:00", number: "RFP No. 0000241" });
    expect(rows[0].advertisement).toBe("https://content.njtransit.com/sites/default/files/RFP%200000241_Advertisement.pdf");
  });

  test("times without AM/PM read as business hours Eastern", () => {
    expect(calendarDueIso("12/22/26", "02:00")).toBe("2026-12-22T19:00:00.000Z");
    expect(calendarDueIso("01/07/27", "11:00")).toBe("2027-01-07T16:00:00.000Z");
    expect(calendarDueIso("TBD", "11:00")).toBeNull();
  });

  test("the quoted name is the title", () => {
    expect(solicitationName('Proposals Due: RFP No. 0000241 "Atlantic City Rail Shuttle Services." General navigation')).toBe("Atlantic City Rail Shuttle Services");
    expect(solicitationName("no quotes here")).toBeNull();
  });

  test("only open bid and proposal deadlines become bids; meetings, notices and auctions are skipped", () => {
    const { rows, skipped } = parseNjTransitCalendar(page, NOW);
    expect(rows.map((r) => r.external_id).sort()).toEqual([
      "njtransit-0000186",
      "njtransit-0000235",
      "njtransit-0000241",
      "njtransit-0000256",
      "njtransit-26-021X",
    ]);
    expect(skipped.not_a_due_date).toBeGreaterThanOrEqual(3); // pre-bid conference, notice of intent, scrap auction
    const maint = rows.find((r) => r.external_id === "njtransit-0000256")!;
    expect(maint).toMatchObject({
      agency: "NJ TRANSIT (New Jersey Transit Corporation)",
      location: "New Jersey",
      solicitation_number: "IFB 0000256",
      notice_type: "Invitation for Bids",
      due_date: "2026-11-10T19:00:00.000Z",
    });
    expect(maint.title).toStartWith("Newark Broad Street Station & Plaza Area Facility Maintenance");
    const tank = rows.find((r) => r.external_id === "njtransit-26-021X")!;
    expect(tank.title).toBe("Howell Garage Aboveground Storage Tank Upgrade");
    for (const r of rows) {
      expect(Date.parse(r.due_date!)).toBeGreaterThan(NOW);
      expect(r.description).not.toMatch(/Gonzales|Murray|Armour/); // contact names are never stored
    }
  });

  test("last fiscal year's rows are closed", () => {
    const later = parseNjTransitCalendar(page, Date.parse("2027-02-01T00:00:00Z"));
    expect(later.rows).toHaveLength(0);
  });

  test("a page without calendar data fails loudly", async () => {
    const saved = { ...njTransitDeps };
    njTransitDeps.fetch = async () => new Response("<html>maintenance</html>", { status: 200 });
    try {
      await expect(fetchNjTransitBids(NOW)).rejects.toThrow();
    } finally {
      Object.assign(njTransitDeps, saved);
    }
  });

  test("the sync reads the calendar page once", async () => {
    const saved = { ...njTransitDeps };
    let calls = 0;
    njTransitDeps.fetch = async () => { calls++; return new Response(page, { status: 200 }); };
    try {
      const res = await fetchNjTransitBids(NOW);
      expect(res.rows).toHaveLength(5);
      expect(calls).toBe(1);
    } finally {
      Object.assign(njTransitDeps, saved);
    }
  });

  test("registered as a New Jersey state source in the sync", () => {
    expect(TAIL_SOURCES.some((s) => s.name === NJ_TRANSIT_SOURCE)).toBe(true);
    expect(SOURCE_CLASSES[NJ_TRANSIT_SOURCE]).toMatchObject({ class: "state", scopeState: "NJ" });
    expect(SOURCE_HOME_JURISDICTIONS[NJ_TRANSIT_SOURCE]).toBe("NJ");
  });
});
