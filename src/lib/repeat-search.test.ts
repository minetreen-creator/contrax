import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { REPEAT_OFFER_FROM, recordRepeatSearch, repeatSearchId, repeatSearchOffer } from "./repeat-search";

const HOUR = 60 * 60 * 1000;
const DAY = 24 * HOUR;
const T0 = Date.UTC(2026, 10, 17, 15, 0, 0);

describe("a visitor who keeps running the same search", () => {
  test("separate visits are counted, a refresh is not", () => {
    let r = recordRepeatSearch(null, "hvac", "CO", T0);
    expect(r.count).toBe(1);
    r = recordRepeatSearch(r.raw, "HVAC ", "co", T0 + 10 * 60 * 1000); // ten minutes later: same visit
    expect(r.count).toBe(1);
    r = recordRepeatSearch(r.raw, "hvac", "CO", T0 + DAY);
    expect(r.count).toBe(2);
    r = recordRepeatSearch(r.raw, "hvac", "CO", T0 + 2 * DAY);
    expect(r.count).toBe(3);
    // A different search does not add to it.
    expect(recordRepeatSearch(r.raw, "roofing", "CO", T0 + 2 * DAY + 4 * HOUR).count).toBe(1);
    expect(recordRepeatSearch(r.raw, "hvac", "TX", T0 + 2 * DAY + 4 * HOUR).count).toBe(1);
  });

  test("runs older than a week drop out, and bad stored text is treated as empty", () => {
    let r = recordRepeatSearch(null, "hvac", "CO", T0);
    r = recordRepeatSearch(r.raw, "hvac", "CO", T0 + DAY);
    expect(recordRepeatSearch(r.raw, "hvac", "CO", T0 + 9 * DAY).count).toBe(1);
    expect(recordRepeatSearch("not json", "hvac", "CO", T0).count).toBe(1);
    expect(recordRepeatSearch("[1,2]", "hvac", "CO", T0).count).toBe(1);
    expect(recordRepeatSearch(null, "  ", "CO", T0).count).toBe(0); // no trade, nothing to count
    expect(repeatSearchId(" HVAC  Repair ", "co")).toBe("hvac repair|CO");
  });

  test("the offer starts on the third run and says only what the pass does", () => {
    expect(repeatSearchOffer(REPEAT_OFFER_FROM - 1, "hvac", "Colorado")).toBeNull();
    const o = repeatSearchOffer(5, "hvac", "Colorado")!;
    expect(o.headline).toBe("You've checked hvac bids in Colorado 5 times this week.");
    expect(o.detail).toContain("every morning at 6 AM");
    expect(o.detail).toContain("$9 for 30 days, one payment, nothing renews");
    expect(repeatSearchOffer(3, "janitorial", null)!.headline).toBe("You've checked janitorial bids 3 times this week.");
    expect(repeatSearchOffer(4, "", "Texas")).toBeNull();
    // The pass really is a morning email at 6 AM (src/lib/starter-pass.ts).
    expect(readFileSync(new URL("./starter-pass.ts", import.meta.url), "utf8")).toContain("emailed every morning at 6 AM, for 30 days");
  });

  test("the search page shows it to visitors without an account and sends them to the pass checkout", () => {
    const page = readFileSync(new URL("../routes/radar.tsx", import.meta.url), "utf8");
    expect(page).toContain("recordRepeatSearch(");
    expect(page).toContain("repeatSearchOffer(repeatCount");
    expect(page).toContain('trackEvent("radar_repeat_offer_click"');
  });
});
