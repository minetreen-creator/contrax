import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { radarMatchAlertHtml, type NewBidSummary } from "./email";

// Owner 2026-11-05: an alert read "10 new opportunityies" and listed ten bids all due that day.
const bid = (n: number): NewBidSummary => ({
  title: `Roof Replacement ${n}`, agency: "City of Example", source_url: "", location: "Boston, MA",
  due_date: "2026-11-20T21:00:00.000Z", set_aside: null, bid_id: n, why_line: null, click_url: null,
});

describe("Radar match alert email", () => {
  test("the headline spells opportunity / opportunities correctly", () => {
    const many = radarMatchAlertHtml([bid(1), bid(2)], 0, "https://www.contrax.company/u", null);
    expect(many).toContain("Contrax found 2 new opportunities matching your Radar profile");
    expect(many).not.toContain("opportunityies");
    expect(radarMatchAlertHtml([bid(1)], 0, "https://www.contrax.company/u", null)).toContain("Contrax found 1 new opportunity matching");
    const src = readFileSync("src/lib/email.ts", "utf8");
    expect(src).not.toContain('opportunity${bids.length === 1 ? "" : "ies"}');
  });

  test("alerts only carry bids with at least 3 days left", () => {
    const src = readFileSync("src/lib/radar-lead-alerts.ts", "utf8");
    expect(src).toContain("export const LEAD_ALERT_MIN_DAYS_LEFT = 3;");
    expect(src).toContain("WHERE due_date > NOW() + (${LEAD_ALERT_MIN_DAYS_LEFT} * INTERVAL '1 day')");
  });
});
