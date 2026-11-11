import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { dueDayText } from "~/lib/deadline-label";
import { bidSeoTitle } from "~/lib/bid-seo";

// Owner 2026-11-11: a BidNet bid due Nov 17 at 11:59 PM Eastern read "Due Nov 18" (the stored instant,
// 04:59 UTC on the 18th, was printed in UTC). About half of all open bids were stored that way.
test("a late-evening U.S. deadline shows its own day, not the next one", () => {
  expect(dueDayText("2026-11-18T04:59:00.000Z")).toBe("Nov 17, 2026"); // 11:59 PM Eastern (winter)
  expect(dueDayText("2026-07-15T03:59:00.000Z")).toBe("Jul 14, 2026"); // 11:59 PM Eastern (summer)
  expect(dueDayText("2026-11-18T01:00:00.000Z")).toBe("Nov 17, 2026"); // 5 PM Pacific
  expect(dueDayText("2026-11-18T19:00:00.000Z")).toBe("Nov 18, 2026"); // 2 PM Eastern
});

test("a date stored with no time keeps its own day", () => {
  expect(dueDayText("2026-11-18T00:00:00.000Z")).toBe("Nov 18, 2026");
  expect(dueDayText("2026-11-18")).toBe("Nov 18, 2026");
});

test("options and bad input", () => {
  expect(dueDayText("2026-11-18T04:59:00.000Z", { year: false })).toBe("Nov 17");
  expect(dueDayText(null)).toBeNull();
  expect(dueDayText("not a date")).toBeNull();
});

test("the bid page title, the bid page and the Radar lists all use it", () => {
  const bid = { id: 1, title: "Auctions International", agency: "City of X", location: null, set_aside: null, due_date: "2026-11-18T04:59:00.000Z", description: null };
  expect(bidSeoTitle(bid)).toContain("(due Nov 17, 2026)");
  const page = readFileSync("src/routes/bid.$bidId.tsx", "utf8");
  expect(page).toContain("const due = dueDayText(bid?.due_date);");
  expect(page).toContain("dueDayText(iso, { year: false })");
  const radar = readFileSync("src/routes/radar.tsx", "utf8");
  expect(radar.match(/dueDayText\(/g)!.length).toBeGreaterThanOrEqual(4);
});
