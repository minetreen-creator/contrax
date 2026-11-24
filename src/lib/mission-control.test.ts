import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { chatgptNote, dayChange, etDayStartMs, paidByEtDay } from "./live-console";

// Owner 2026-11-03: "a mission control rework, something that doesn't look too
// lengthy and looks cool" / "yes, don't keep the current version".
describe("Mission Control top strip", () => {
  test("Eastern midnight, in winter and summer", () => {
    expect(new Date(etDayStartMs(Date.parse("2026-11-03T04:40:00Z"))).toISOString()).toBe("2026-11-02T05:00:00.000Z");
    expect(new Date(etDayStartMs(Date.parse("2026-07-15T12:00:00Z"))).toISOString()).toBe("2026-07-15T04:00:00.000Z");
  });
  test("dollars paid today and yesterday, owner and test buyers left out", () => {
    const today = Date.parse("2026-11-03T05:00:00Z");
    const s = (hoursAfter: number, cents: number, email: string | null = "buyer@example.com", status = "paid") => ({
      created: Math.floor((today + hoursAfter * 3_600_000) / 1000),
      amount_total: cents,
      payment_status: status,
      customer_details: { email },
    });
    const out = paidByEtDay(
      [s(2, 500), s(3, 500), s(-5, 500), s(1, 500, "qa-funnel-1@test.contrax"), s(1, 500, "boss@contrax.company"), s(1, 500, null, "unpaid")],
      (e) => e === "boss@contrax.company",
      today,
      today + 4 * 3_600_000,
    );
    // It is 4 AM; yesterday's sale was at 7 PM, after 4 AM yesterday, so it is not in "so far".
    expect(out).toEqual({ today: 10, yesterday: 5, yesterdaySoFar: 0, salesToday: 2 });
  });
  test("compares today so far with this time yesterday (owner 2026-11-03)", () => {
    expect(dayChange(31, 24)).toEqual({ dir: "up", label: "▲ 7 vs this time yesterday" });
    expect(dayChange(3, 5)).toEqual({ dir: "down", label: "▼ 2 vs this time yesterday" });
    expect(dayChange(5, 5)).toEqual({ dir: "flat", label: "same as this time yesterday" });
    expect(dayChange(5, 0, true).label).toBe("▲ $9 vs this time yesterday");
  });
});

describe("Mission Control layout", () => {
  const page = readFileSync("src/routes/admin/live.tsx", "utf8");
  test("one screen: three numbers, the map with who's on, one short feed", () => {
    for (const label of ['label: "People today"', 'label: "Searches"', 'label: "Paid today"']) expect(page).toContain(label);
    // Owner 2026-11-04: "Thats a stat I don't really need."
    expect(page).not.toContain('label: "Checkouts"');
    // Owner 2026-11-16: the picture has a short text panel, so the feed shows five.
    expect(page).toContain("data.feed.slice(0, 5)");
    expect(page).toContain("data.online.slice(0, 5)");
    expect(page).toContain('v.lead?.level === "hot" ? " is-hot" : ""');
  });
  test("money, trials and tracked visitors slide out; Jarvis is a corner button; the old radar is gone", () => {
    expect(page).toContain("<SidePanel");
    expect(page).toContain("<JarvisDock");
    expect(page).not.toContain("HotLeadRadar");
    expect(page).not.toContain("Live search map · 48 hours");
    // The overlays sit inside the page's .admin-console; a second one added a
    // full empty screen at the bottom (owner 2026-11-03).
    expect(page.match(/className="admin-console/g)?.length).toBe(1);
  });
});

// Owner 2026-11-16: "I want it to look just like screenshot" — the picture's layout, Mission
// Control's own numbers.
describe("Mission Control, the picture's layout", () => {
  test("fourteen Eastern days ending today, with zeros where nothing was counted", async () => {
    const { trendDays, fillTrend, TREND_DAYS } = await import("./live-console");
    const days = trendDays(Date.parse("2026-11-16T19:30:00Z"));
    expect(days).toHaveLength(TREND_DAYS);
    expect(days[0]).toBe("2026-11-03");
    expect(days[13]).toBe("2026-11-16");
    // 03:30 UTC is still the evening before in New York.
    expect(trendDays(Date.parse("2026-11-16T03:30:00Z"))[13]).toBe("2026-11-15");
    const t = fillTrend(days, { "2026-11-16": 11, "2026-11-15": 9 }, { "2026-11-16": 7 });
    expect(t[13]).toEqual({ day: "2026-11-16", people: 11, searches: 7 });
    expect(t[12]).toEqual({ day: "2026-11-15", people: 9, searches: 0 });
    expect(t[0]).toEqual({ day: "2026-11-03", people: 0, searches: 0 });
  });

  test("the chart lines stay inside the box and the area closes on the baseline", async () => {
    const { trendPaths } = await import("./live-console");
    const p = trendPaths([0, 5, 10], 100, 50, 10);
    expect(p.line).toBe("M0.0 50.0 L50.0 25.0 L100.0 0.0");
    expect(p.area).toBe("M0.0 50.0 L50.0 25.0 L100.0 0.0 L100.0 50 L0.0 50 Z");
    expect(trendPaths([], 100, 50, 10)).toEqual({ line: "", area: "" });
    expect(trendPaths([4], 100, 50, 8).line).toBe("M0 25.0 L100 25.0");
    // A zero maximum cannot divide by zero.
    expect(trendPaths([0, 0], 100, 50, 0).line).toBe("M0.0 50.0 L100.0 50.0");
  });

  test("a search's result count is read from its own text", async () => {
    const { matchCount } = await import("./live-console");
    expect(matchCount("72 matches")).toBe(72);
    expect(matchCount("0 matches")).toBe(0);
    expect(matchCount("1 match")).toBe(1);
    expect(matchCount("1,204 matches")).toBe(1204);
    expect(matchCount(null)).toBeNull();
    expect(matchCount("Michigan")).toBeNull();
  });

  test("the page keeps every way into a visitor's trail and the slide-out panels", () => {
    const { readFileSync } = require("node:fs") as typeof import("node:fs");
    const page = readFileSync("src/routes/admin/live.tsx", "utf8");
    for (const piece of ["<SearchTable feed={data.feed} now={now} />", "<TrendChart trend={data.trend ?? []} />", "<OnlineNow count={data.onlineCount}", "onChat={openChat}", "setPanel(true)", "setAppPanel(true)", "<JarvisDock", "/logo-horizontal-white.png"]) expect(page).toContain(piece);
    expect(page).toContain('label: "On the site now"');
    expect(readFileSync("src/routes/api/admin/live-console.ts", "utf8")).toContain("trend: await loadTrend(db),");
  });
});

// Owner's screenshot 2026-11-16: the admin-wide h1 size made the page name tower over the logo.
test("the top bar's page name stays small beside the logo", () => {
  const { readFileSync } = require("node:fs") as typeof import("node:fs");
  const css = readFileSync("src/styles/admin.css", "utf8");
  expect(css).toContain(".admin-console main .mc-topbar h1 { font-size: 15px;");
  expect(css).toContain(".admin-console .mc-topbar img { height: 30px; }");
});

// Owner 2026-11-16 ("do all 3"): Facebook visitors read bids without searching.
test("bid opens are counted beside searches, by the same people rules", async () => {
  const { bidOpensNote, BID_PAGE_SQL } = await import("./live-console");
  expect(bidOpensNote({ today: 12, yesterday: 5 })).toBe("12 people opened a bid today (5 yesterday)");
  expect(bidOpensNote({ today: 1, yesterday: 0 })).toBe("1 person opened a bid today (0 yesterday)");
  expect(bidOpensNote(undefined)).toBeNull();
  expect(BID_PAGE_SQL).toBe("path ~ '^/bid/[0-9]+'");
  const { readFileSync } = require("node:fs") as typeof import("node:fs");
  const api = readFileSync("src/routes/api/admin/live-console.ts", "utf8");
  expect(api).toContain("BOOL_OR(${BID_PAGE_SQL}) AS opened_bid");
  expect(api).toContain("bidOpens: { today: 0, yesterday: 0, yesterdaySoFar: 0 },");
  // Counted inside the people loop, after the scanner and data-center exclusions.
  expect(api.indexOf("dataCenterLocation(r.city, r.region))) continue;")).toBeLessThan(api.indexOf("if (r.opened_bid && out.bidOpens)"));
  expect(readFileSync("src/routes/admin/live.tsx", "utf8")).toContain("note2: bidOpensNote(today.bidOpens),");
});

// Owner 2026-11-17: 39 of 40 searches on the feed were email link scanners (a new id each time, no page loaded).
test("Mission Control counts a search only when a person ran it", () => {
  const { readFileSync } = require("node:fs") as typeof import("node:fs");
  const api = readFileSync("src/routes/api/admin/live-console.ts", "utf8");
  expect(api).toContain("export const REAL_SEARCHER_SQL = `(s.user_id IS NOT NULL OR (s.visitor_id IS NOT NULL AND EXISTS (");
  expect(api).toContain("AND NOT ${BOT_EXCLUSION_SQL}");
  // The feed, the map, the 14-day trend and today's tile all use the same rule.
  expect(api.match(/AND \$\{db\.unsafe\(REAL_SEARCHER_SQL\)\}/g)?.length).toBe(2);
  expect(api.match(/AND \$\{REAL_SEARCHER_SQL\}/g)?.length).toBe(2);
});

// Owner 2026-11-24 ("do it"): ChatGPT sent 225 visitors in 30 days and the console did not show them.
describe("ChatGPT as a source", () => {
  test("the People tile says how many came from ChatGPT, and stays quiet when none did", () => {
    expect(chatgptNote({ today: 3, week: 95 })).toBe("3 from ChatGPT today · 95 in 7 days");
    expect(chatgptNote({ today: 0, week: 12 })).toBe("0 from ChatGPT today · 12 in 7 days");
    expect(chatgptNote({ today: 0, week: 0 })).toBeNull();
    expect(chatgptNote(undefined)).toBeNull();
  });
});
