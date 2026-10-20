import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { PLAN_COPY, upgradeFeatures } from "./plan-features";

describe("plan copy shared by /pricing and /upgrade", () => {
  test("Starter lists the paid perks people upgrade for", () => {
    const s = PLAN_COPY.starter.features.join("\n");
    expect(s).toContain("A 6 AM email of new bids");
    expect(s).toContain("Who to contact on federal bids");
    expect(s).toContain("Unlimited Saved Bids");
  });
  test("/upgrade drops the yearly line (its own switch shows yearly prices)", () => {
    expect(upgradeFeatures(PLAN_COPY.starter.features)).not.toContain("Or $190 a year: 2 months free");
    expect(upgradeFeatures(PLAN_COPY.professional.features).some((f) => f.startsWith("Or $"))).toBe(false);
    expect(upgradeFeatures(PLAN_COPY.starter.features)).toContain("Cancel anytime");
  });
  test("both pages read the shared copy", () => {
    expect(readFileSync("src/routes/pricing/index.tsx", "utf8")).toContain("PLAN_COPY.starter.features");
    expect(readFileSync("src/routes/upgrade.tsx", "utf8")).toContain("upgradeFeatures(PLAN_COPY[p.id].features)");
  });
});
