import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { attentionItems, cleanNote, greeting, operations, tiles, type CommandCounts } from "./command-center";

// Owner 2026-11-05: "I need an admin dashboard like this!" (a command-center home).
const base: CommandCounts = {
  outreachDrafts: 0, outreachSentToday: 0, storiesPending: 0, dataFeedRequestsNew: 0, bidFitReviewsOpen: 0,
  nonprofitReviews: 0, passesEndingSoon: 0, failingSources: [], sourcesSyncedToday: 300, newBidsToday: 120,
  openBids: 30603, lastSyncAt: "2026-11-05T12:00:00.000Z", federalFiguresFailing: 0, federalFiguresLastAt: "2026-11-05T11:58:00.000Z", partnersNew: 0, partnersActive: 0,
};
const NOW = new Date("2026-11-05T15:00:00.000Z");

describe("Command Center", () => {
  test("greets by Eastern time", () => {
    expect(greeting(new Date("2026-11-05T13:00:00Z"))).toBe("Good morning"); // 8 AM ET
    expect(greeting(new Date("2026-11-05T19:00:00Z"))).toBe("Good afternoon"); // 2 PM ET
    expect(greeting(new Date("2026-11-06T01:00:00Z"))).toBe("Good evening"); // 8 PM ET
  });

  test("nothing waiting means an empty attention list, never a made-up item", () => {
    expect(attentionItems(base)).toEqual([]);
  });

  test("money first, then approvals, then fixes", () => {
    const items = attentionItems({ ...base, outreachDrafts: 86, outreachSentToday: 4, dataFeedRequestsNew: 1, failingSources: [{ source: "ma_boston", cause: "the site is having trouble on its end" }], passesEndingSoon: 1 });
    expect(items.map((i) => i.key)).toEqual(["data-feed", "passes", "outreach", "sources"]);
    expect(items[2].label).toBe("86 outreach drafts to approve");
    expect(items[3].detail).toContain("ma_boston");
    expect(attentionItems({ ...base, storiesPending: 1 })[0].label).toBe("1 success story to review");
    expect(attentionItems({ ...base, partnersNew: 1, outreachDrafts: 2 })[0].label).toBe("1 new Association Partner ($149/month)");
  });

  test("jobs read their status from what they wrote", () => {
    const ok = operations(base, NOW);
    expect(ok.find((o) => o.name === "Bid sync")!.status).toBe("working");
    expect(ok.find((o) => o.name === "Outreach")!.status).toBe("waiting");
    const bad = operations({ ...base, failingSources: [{ source: "x", cause: "y" }], outreachDrafts: 3, lastSyncAt: "2026-11-04T00:00:00.000Z" }, NOW);
    expect(bad.find((o) => o.name === "Bid sync")!.status).toBe("waiting");
    expect(bad.find((o) => o.name === "Outreach")!.status).toBe("needs-approval");
    expect(tiles(operations({ ...base, federalFiguresFailing: 2, outreachDrafts: 1 }, NOW))).toEqual({ working: 1, waiting: 1, needsApproval: 1, problems: 1 });
  });

  test("Quick Capture notes are one trimmed line", () => {
    expect(cleanNote("  call   Brad back \n tomorrow ")).toBe("call Brad back tomorrow");
    expect(cleanNote("")).toBeNull();
    expect(cleanNote("x".repeat(501))).toBeNull();
    expect(cleanNote(42)).toBeNull();
  });

  test("the page is admin-only and listed first in the admin menu", () => {
    const page = readFileSync("src/routes/admin/command.tsx", "utf8");
    expect(page).toContain("if (!user.is_admin) throw redirect");
    const api = readFileSync("src/routes/api/admin/command.ts", "utf8");
    expect(api).toContain('if (!user.is_admin) return { error: Response.json({ error: "Admin access required" }, { status: 403 }) }');
    const shared = readFileSync("src/components/AdminShared.tsx", "utf8");
    expect(shared.indexOf('key: "command"')).toBeLessThan(shared.indexOf('key: "overview"'));
  });
});
