import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";

import { LEAD_ALERT_INTERVAL_DAYS } from "~/lib/radar-lead-alerts";

const read = (p: string) => readFileSync(new URL(`../${p}`, import.meta.url), "utf8");

describe("free Radar match alerts are weekly", () => {
  test("a lead is emailed at most once every 7 days", () => {
    expect(LEAD_ALERT_INTERVAL_DAYS).toBe(7);
    const src = read("src/lib/radar-lead-alerts.ts");
    expect(src).toContain("last_alerted_at IS NULL");
    expect(src).toContain("last_alerted_at < NOW() - (${LEAD_ALERT_INTERVAL_DAYS} * INTERVAL '1 day')");
    // the send still stamps last_alerted_at, which is what the weekly gate reads
    expect(src).toContain("last_alerted_at = NOW()");
  });

  test("the sign-up box, confirmation and alert emails say weekly", () => {
    const radar = read("src/routes/radar.tsx");
    expect(radar).toContain("weekly email of new");
    expect(radar).toContain("One email a week with your new matches");
    expect(radar).not.toContain("matching opportunities as\n            they open");
    const email = read("src/lib/email.ts");
    expect(email).toContain("once a week with new government contract");
    expect(email).toContain("Free match alerts arrive once a week.");
  });
});
