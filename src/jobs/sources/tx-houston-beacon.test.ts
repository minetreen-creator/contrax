import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import {
  BEACON_GQL,
  beaconDue,
  fetchTxHoustonBeaconBids,
  houstonBeaconDeps,
  LIST_SOLICITATIONS,
  parseHoustonBeacon,
} from "./tx-houston-beacon";
import { expandTrade, isStrongTradeMatch } from "~/lib/trade-registry";

// Captured 2026-11-03 (owner: "can we do Houston too?" → "go ahead").
const capture = () =>
  JSON.parse(readFileSync(new URL("./fixtures/tx-houston-beacon/open-2026-11-03.json", import.meta.url), "utf8"));
const now = Date.parse("2026-11-03T16:00:00Z");

describe("City of Houston on Beacon", () => {
  test("the captured open list parses: 35 rows, 32 bids, 3 not bids", () => {
    const list = capture().data.solicitations;
    expect(list.total).toBe(35);
    const { rows, skipped } = parseHoustonBeacon(list.data, now);
    expect(rows).toHaveLength(32);
    expect(skipped).toEqual({ not_a_bid: 3 });
    for (const r of rows) {
      expect(r.external_id).toMatch(/^houstonbeacon-[0-9a-f-]{36}$/);
      expect(r.source_url).toStartWith("https://www.beaconbid.com/solicitations/city-of-houston/");
      expect(r.agency).toBe("City of Houston");
      expect(r.location).toBe("Houston, TX");
      expect(Date.parse(r.due_date!)).toBeGreaterThan(now);
      expect(r.solicitation_number).toMatch(/^[A-Z]+-\d{4}-\d{4}$/);
    }
    expect(parseHoustonBeacon(list.data, Date.parse("2027-06-01T00:00:00Z")).rows).toHaveLength(0);
  });

  test("due dates are Beacon's own UTC instant", () => {
    expect(beaconDue({ utcDate: "2026-11-05T16:00:00.000Z", specifiedZone: "America/Chicago" })).toBe("2026-11-05T16:00:00.000Z");
    expect(beaconDue(null)).toBeNull();
    expect(beaconDue({ utcDate: "not a date" })).toBeNull();
  });

  test("Houston's drainage, waterline and street jobs are construction; CMI services are not", () => {
    const c = expandTrade("construction");
    const titles = parseHoustonBeacon(capture().data.solicitations.data, now).rows.map((r) => r.title);
    const strong = titles.filter((t) => isStrongTradeMatch(t, null, null, null, c));
    for (const t of [
      "Braeburn Glen Area Drainage and Paving Improvements Project",
      "TIRZ 17 Memorial City Area Detention Basin",
      "FY 2027 Ditch Re-establishment (DRE) Work Order Contract #1",
      "Airline Drive Intersection and Griggs Road Crossing Improvements",
      "24-Inch Waterline Along Highway 3 From Fuqua Street to Dixie Farm Road (FM 1959)",
    ]) expect(strong).toContain(t);
    for (const t of ["CMI & SERVICES FOR DRAINAGE AND PAVING REHABILITATION PROJECTS # 1", "Street Sweeping Services (South Quadrants)", "Ditch Mowing Services", "Pedestrian Crossing Guard Services"]) {
      expect({ t, m: isStrongTradeMatch(t, null, null, null, c) }).toEqual({ t, m: false });
    }
    expect(isStrongTradeMatch("IAH Terminal D HVAC Efficiency Upgrades", null, null, null, expandTrade("HVAC"))).toBe(true);
  });

  test("one public query per sync, only the public list fields, no documents", async () => {
    const calls: { url: string; body: any }[] = [];
    const saved = { ...houstonBeaconDeps };
    houstonBeaconDeps.pause = async () => {};
    houstonBeaconDeps.fetch = async (url, init) => {
      calls.push({ url, body: JSON.parse(String(init.body)) });
      return new Response(JSON.stringify(capture()), { status: 200 });
    };
    try {
      const res = await fetchTxHoustonBeaconBids(now);
      expect(res.rows).toHaveLength(32);
      expect(calls).toHaveLength(1);
      expect(calls[0].url).toBe(BEACON_GQL);
      expect(calls[0].body.variables).toEqual({ agencyTag: "city-of-houston", status: "open", start: 0, pageSize: 100 });
      expect(LIST_SOLICITATIONS).toContain("data { id title refnum dueDate type status }");
      expect(LIST_SOLICITATIONS).not.toContain("planholder");
    } finally {
      Object.assign(houstonBeaconDeps, saved);
    }
  });

  test("a 429 or a GraphQL error fails the source loudly (never a quiet zero)", async () => {
    const saved = { ...houstonBeaconDeps };
    try {
      houstonBeaconDeps.fetch = async () => new Response("{}", { status: 429 });
      await expect(fetchTxHoustonBeaconBids(now)).rejects.toThrow();
      houstonBeaconDeps.fetch = async () => new Response(JSON.stringify({ errors: [{ message: "Not allowed." }] }), { status: 200 });
      await expect(fetchTxHoustonBeaconBids(now)).rejects.toThrow();
    } finally {
      Object.assign(houstonBeaconDeps, saved);
    }
  });
});
