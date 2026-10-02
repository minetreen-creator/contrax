/**
 * The "qualified" funnel stage is defined by the same event list in three
 * places (the admin Overview funnel, the analytics-consistency check and the
 * Radar conversion funnel). The homepage's primary CTA fires
 * `homepage_radar_cta_clicked`; if any list misses it, visitors who click the
 * homepage search but never scan disappear from that report.
 *
 * Two of the lists are module-private, so they are checked from source.
 */
import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";

import { RADAR_CONVERSION_QUALIFYING_EVENTS } from "~/lib/radar-conversion-funnel";

const read = (rel: string) => readFileSync(new URL(`../${rel}`, import.meta.url), "utf8");

describe("funnel qualifying events", () => {
  test("the homepage search CTA counts as a qualifying event", () => {
    expect(RADAR_CONVERSION_QUALIFYING_EVENTS).toContain("homepage_radar_cta_clicked");
    expect(RADAR_CONVERSION_QUALIFYING_EVENTS).toContain("hero_cta_click");
  });

  test("all three copies of the list include it", () => {
    for (const rel of [
      "src/lib/radar-conversion-funnel.ts",
      "src/routes/api/admin/unified-funnel.ts",
      "src/routes/api/admin/analytics-consistency.ts",
    ]) {
      expect(read(rel)).toContain('"homepage_radar_cta_clicked",');
    }
  });

  test("the homepage fires that exact event; Radar defaults to a size it accepts", () => {
    const home = read("src/routes/index.tsx");
    expect(home).toContain('trackEvent("homepage_radar_cta_clicked", "hero_primary")');
    const radar = read("src/routes/radar.tsx");
    expect(radar).toContain('{ id: "any", label: "Any size"');
    expect(radar).toContain('export const DEFAULT_RADAR_SIZE: SizeId = "any";');
  });
});
