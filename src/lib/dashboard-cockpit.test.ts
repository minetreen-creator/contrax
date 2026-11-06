import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { cockpitStats, compactDollars, weekDelta, type CockpitBid } from "./dashboard-cockpit";

// Owner 2026-11-06: a procurement-dashboard look for the contractor's own matches.
const NOW = Date.parse("2026-11-06T15:00:00Z");
const day = 86_400_000;
const bid = (id: number, o: Partial<CockpitBid>): CockpitBid => ({
  id, title: `Bid ${id}`, agency: null, location: null, category: null, due_date: null, estimated_value: null, created_at: null, ...o,
});
const iso = (t: number) => new Date(t).toISOString();

describe("dashboard cockpit numbers", () => {
  const bids = [
    bid(1, { location: "Richmond, VA", category: "Janitorial", due_date: iso(NOW + 3 * day), estimated_value: "$120,000", created_at: iso(NOW - 2 * day) }),
    bid(2, { location: "Norfolk, VA", category: "Janitorial", due_date: iso(NOW + 20 * day), estimated_value: "Not specified", created_at: iso(NOW - 10 * day) }),
    bid(3, { location: "Raleigh, NC", category: "Landscaping", due_date: iso(NOW + 10 * day), estimated_value: "$1.5M", created_at: iso(NOW - 1 * day) }),
    bid(4, { location: "Nationwide", category: "", due_date: iso(NOW + 30 * day), created_at: iso(NOW - 12 * day) }),
    bid(5, { location: "Austin, TX", category: "HVAC", due_date: iso(NOW - day), created_at: iso(NOW - 3 * day) }),
  ];
  const s = cockpitStats(bids, 2, NOW);

  test("counts only open bids, and only what the data states", () => {
    expect(s.open).toBe(4);
    expect(s.closing7).toBe(1);
    expect(s.soonest?.id).toBe(1);
    expect(s.saved).toBe(2);
    expect(s.byState).toEqual({ VA: 2, NC: 1 });
    expect(s.topState).toEqual({ code: "VA", count: 2 });
  });

  test("week over week compares bids added in each 7-day window", () => {
    expect(s.newThisWeek).toBe(3);
    expect(s.newLastWeek).toBe(2);
    expect(weekDelta(3, 2)).toEqual({ text: "▲ 1 vs last week", tone: "up" });
    expect(weekDelta(1, 4).tone).toBe("down");
    expect(weekDelta(2, 2).text).toBe("same as last week");
  });

  test("trade rows sum stated values only and say how many state one", () => {
    const jan = s.trades.find((t) => t.trade === "Janitorial")!;
    expect(jan).toMatchObject({ count: 2, statedValue: 120000, valued: 1 });
    expect(s.trades[0].trade).toBe("Janitorial");
    expect(s.trades.find((t) => t.trade === "Other")).toMatchObject({ count: 1, statedValue: null });
    expect(compactDollars(1_560_000)).toBe("$1.5M");
    expect(compactDollars(480_900)).toBe("$480K");
  });

  test("the dashboard shows the cockpit above the old cards", () => {
    const page = readFileSync("src/routes/dashboard.tsx", "utf8");
    expect(page).toContain("<DashboardCockpit bids={data.bids} savedCount={savedBids.size} />");
    expect(page.indexOf("<DashboardCockpit")).toBeLessThan(page.indexOf("<GettingStarted"));
  });
});

// Owner 2026-11-06: the preview map lit up Washington State for "Washington, DC".
test("a trailing state code beats a state name inside the place name", async () => {
  const { resolveBidState } = await import("./location-state");
  const cases: [string, string][] = [
    ["Washington, DC", "DC"], ["Washington, D.C.", "DC"], ["Washington DC 20001", "DC"],
    ["Kansas City, MO", "MO"], ["Indiana, PA", "PA"], ["Delaware, OH", "OH"],
    ["Washington Township, NJ", "NJ"], ["Arkansas City, KS", "KS"], ["Richmond, VA 23219", "VA"], ["Hagatna, GU", "GU"],
  ];
  for (const [loc, st] of cases) expect(resolveBidState(loc, null)).toBe(st);
  expect(resolveBidState("Busan, South Korea", null)).toBeNull();
});
