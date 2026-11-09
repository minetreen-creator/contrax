import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import {
  MILESTONE_KEYS,
  certSuggestions,
  commonGaps,
  nextActions,
  ninetyDayPlan,
  profileTradeSlug,
  progress,
  readiness,
  stageOf,
  type RoadmapPick,
} from "./roadmap";

const now = new Date("2026-11-09T12:00:00Z");
const ready = {
  businessName: "Shine Co",
  industry: "Janitorial",
  services: ["janitorial"],
  naics: ["561720"],
  states: ["VA"],
  certifications: ["sdvosb"],
  uei: "ABC123DEF456",
  samExpiration: "2027-08-01",
  pastPerformance: "Nightly cleaning of a 40,000 sq ft clinic for three years.",
  capabilityStatement: "Shine Co provides janitorial, floor care and post-construction cleaning across Virginia with a trained, bonded crew of 12.",
};

describe("roadmap", () => {
  test("the trade comes from NAICS codes first, then words", () => {
    expect(profileTradeSlug({ naics: ["561720"] })).toBe("janitorial");
    expect(profileTradeSlug({ industry: "Cybersecurity consulting" })).toBe("cybersecurity");
    expect(profileTradeSlug({ services: ["trash pickup", "waste hauling"] })).toBe("waste-hauling");
    expect(profileTradeSlug({ industry: "Commercial roofing contractor" })).toBe("construction");
    expect(profileTradeSlug({ industry: "Bakery" })).toBeNull();
  });

  test("readiness: SAM missing, expired, expiring soon, done", () => {
    const sam = (p: object) => readiness({ ...ready, ...p }, "janitorial", now).find((i) => i.key === "sam")!;
    expect(sam({ uei: null }).status).toBe("missing");
    expect(sam({ samExpiration: "2026-10-01" }).status).toBe("missing");
    expect(sam({ samExpiration: "2026-12-01" }).status).toBe("warn");
    expect(sam({}).status).toBe("done");
  });

  test("stage: getting ready until SAM and trade are set; bidding once there are picks", () => {
    const pick: RoadmapPick = { bidId: 1, title: "Cleaning", decision: "pursue", fit: 82, missing: [] };
    expect(stageOf(readiness({ ...ready, uei: null }, "janitorial", now), [])).toBe("getting-ready");
    expect(stageOf(readiness(ready, "janitorial", now), [])).toBe("ready-to-bid");
    expect(stageOf(readiness(ready, "janitorial", now), [pick])).toBe("bidding");
  });

  test("the plan marks setup steps done from the profile; next actions skip done milestones", () => {
    const plan = ninetyDayPlan(readiness(ready, "janitorial", now), "janitorial", "VA");
    const setup = plan[0].milestones;
    expect(setup.filter((m) => m.auto).map((m) => m.key)).toEqual(["sam", "profile", "capability"]);
    expect(nextActions(plan, []).map((m) => m.key)).toEqual(["certs", "agencies", "primes"]);
    expect(nextActions(plan, ["certs", "agencies"]).map((m) => m.key)).toEqual(["primes", "first-bid", "recompetes"]);
    expect(progress(plan, ["certs"])).toEqual({ done: 4, total: 12 });
    expect(plan[1].milestones.find((m) => m.key === "primes")!.href).toBe("/prime-finder?trade=janitorial&state=VA");
  });

  test("certifications: never ones already held; VOSB is skipped for an SDVOSB", () => {
    const codes = certSuggestions(ready).map((c) => c.code);
    expect(codes).not.toContain("sdvosb");
    expect(codes).not.toContain("vosb");
    expect(codes).toContain("hubzone");
  });

  test("gaps: what Auto-Pilot most often said is missing", () => {
    const p = (missing: string[]): RoadmapPick => ({ bidId: 1, title: "x", decision: "partner", fit: 70, missing });
    expect(commonGaps([p(["Payment and performance bonds", "Virginia license"]), p(["payment and performance bonds"])])).toEqual([
      { item: "Payment and performance bonds", times: 2 },
      { item: "Virginia license", times: 1 },
    ]);
  });

  test("only known milestone keys can be saved; the page is linked from the dashboard and in the sitemap", () => {
    expect(MILESTONE_KEYS).toHaveLength(12);
    const server = readFileSync(new URL("./roadmap.server.ts", import.meta.url), "utf8");
    expect(server).toContain("if (!MILESTONE_KEYS.includes(key)) return false;");
    expect(readFileSync(new URL("../routes/dashboard.tsx", import.meta.url), "utf8")).toContain('href="/roadmap"');
    expect(readFileSync(new URL("../../scripts/generate-sitemap.mjs", import.meta.url), "utf8")).toContain('["/roadmap", "monthly", "0.5"]');
  });
});
