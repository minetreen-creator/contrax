import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { dayChange, etDayStartMs, paidByEtDay } from "./live-console";

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
    expect(dayChange(5, 0, true).label).toBe("▲ $5 vs this time yesterday");
  });
});

describe("Mission Control layout", () => {
  const page = readFileSync("src/routes/admin/live.tsx", "utf8");
  test("one screen: three numbers, the map with who's on, one short feed", () => {
    for (const label of ['label: "People today"', 'label: "Searches"', 'label: "Paid today"']) expect(page).toContain(label);
    // Owner 2026-11-04: "Thats a stat I don't really need."
    expect(page).not.toContain('label: "Checkouts"');
    expect(page).toContain("data.feed.slice(0, 10)");
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
