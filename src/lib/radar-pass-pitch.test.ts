import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { passFacts, radarPassPitch } from "./radar-pass-pitch";

// Owner 2026-11-09: about 3% of Radar searchers clicked buy; the offer now names their own results.
describe("Radar $5 offer from the visitor's own search", () => {
  const m = (days: number | null, agency: string | null) => ({ days_remaining: days, agency });

  test("facts: bids closing within 7 days and distinct buyers", () => {
    expect(passFacts([m(2, "City A"), m(7, "city a"), m(8, "County B"), m(null, null), m(-1, "C")])).toEqual({ closingSoon: 2, buyers: 3 });
  });

  test("leads with what closes this week, then what $5 adds", () => {
    const p = radarPassPitch({ total: 12, waiting: 9, unlocked: false, trade: "janitorial", stateName: "Virginia", facts: { closingSoon: 3, buyers: 7 } });
    expect(p.headline).toBe("3 of your 12 janitorial bids in Virginia close within 7 days.");
    expect(p.detail).toBe(
      "$5 opens every official notice, document and buyer contact for these 12 bids from 7 buyers, and starting tomorrow at 6 AM, each new one in your trade with Auto-Pilot's call: pursue, partner or pass.",
    );
  });

  test("after an email unlock the offer stays, and without urgent bids it says so plainly", () => {
    expect(radarPassPitch({ total: 5, waiting: 0, unlocked: true, trade: "HVAC", stateName: null, facts: { closingSoon: 0, buyers: 1 } }).headline).toBe(
      "You've seen your 5 HVAC bids. Now go after them.",
    );
    expect(radarPassPitch({ total: 9, waiting: 6, unlocked: false, trade: "roofing", stateName: "Ohio", facts: null }).headline).toBe(
      "6 more roofing bids in Ohio are waiting.",
    );
  });

  test("Radar shows it after an email unlock too, and counts only (no locked bid revealed)", () => {
    const r = readFileSync(new URL("../routes/radar.tsx", import.meta.url), "utf8");
    expect(r).toContain("{(locked > 0 || emailUnlocked) && (() => {");
    expect(r).toContain("passFacts: passFacts(matches),");
  });
});
