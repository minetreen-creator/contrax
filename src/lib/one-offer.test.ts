import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { passOfferCount } from "../routes/radar";

// Owner 2026-11-01: one offer everywhere, own count after signup, Max only, $5 bid button.
const read = (f: string) => readFileSync(f, "utf8");

describe("one offer", () => {
  test("pricing shows one card (Starter) and tucks the rest under Other plans", () => {
    const pricing = read("src/routes/pricing/index.tsx");
    expect(pricing).toContain('plans.filter((plan) => plan.slug === "starter").map((plan) => (');
    expect(pricing).toContain('<summary className="cursor-pointer font-semibold text-slate-700 hover:text-slate-900">Other plans</summary>');
    expect(pricing).toContain("Professional</a> ($79/month");
  });
  test("homepage and bid lock push no competing offer", () => {
    expect(read("src/routes/index.tsx")).not.toContain("<BidScoutCallout");
    const bid = read("src/routes/bid.$bidId.tsx");
    expect(bid).not.toContain("<FoundingSpotsLine");
    expect(read("src/components/BasicUpgradeBar.tsx")).not.toContain("<FoundingSpotsLine");
  });
  test("the bid lock's main button names the exact deal", () => {
    expect(read("src/routes/bid.$bidId.tsx")).toContain("Open this bid + every new one for 30 days: ${STARTER_FIRST_MONTH_PRICE}");
  });
});

describe("a signed-in free account sees its own count with the $5 offer", () => {
  test("Radar returns paidMember and the in-state count, and shows the banner only to free accounts", () => {
    const radar = read("src/routes/radar.tsx");
    expect(radar).toContain("paidMember: subscribed,");
    expect(radar).toContain("localMatched: state ? local.length : matches.length,");
    expect(radar).toContain("{!isAnonymous && scan.paidMember === false && (scan.localMatched ?? 0) > 0 && (");
  });
  test("counts read naturally", () => {
    expect(passOfferCount(23)).toBe("23");
    expect(passOfferCount(100)).toBe("100+");
  });
});

describe("one assistant, no live chat (owner 2026-11-01)", () => {
  test("neither the AI bubble nor the Say hi chat is mounted, and Mission Control has no Say hi", () => {
    const root = read("src/routes/__root.tsx");
    expect(root).not.toContain("<ChatWidget");
    expect(root).not.toContain("<FounderChat");
    const live = read("src/routes/admin/live.tsx");
    expect(live).not.toContain("/> Say hi");
    expect(live).not.toContain("<ChatDrawer");
    expect(live).toContain("const openChat = openTrack;");
  });
  test("the offer names the trade without quotation marks", () => {
    expect(read("src/routes/radar.tsx")).toContain('tradeLabel(track).replace(/["“”]/g, "")');
  });
});
