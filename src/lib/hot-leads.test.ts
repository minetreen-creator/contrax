import { describe, expect, test } from "bun:test";
import { announcements, isRedAlert, feedLine, hotLine, MAX_LINES_PER_POLL, pageName, radarSpot, scoreLead, visitorLine } from "./hot-leads";

const base = { currentPath: "/", pathsHour: ["/"], viewsHour: 1, visitDays: 1, signedIn: false };

describe("scoreLead", () => {
  test("a first-time homepage visitor is cold", () => {
    expect(scoreLead(base)).toEqual({ score: 0, level: "cold", reasons: [] });
  });
  test("on pricing now after reading Bid Scout is hot", () => {
    const l = scoreLead({ ...base, currentPath: "/pricing", pathsHour: ["/bid-scout", "/pricing"] });
    expect(l.score).toBe(65);
    expect(l.level).toBe("hot");
    expect(l.reasons).toEqual(["on the pricing page now", "read Bid Scout"]);
  });
  test("a return visitor searching bids is warm", () => {
    const l = scoreLead({ ...base, currentPath: "/radar", pathsHour: ["/radar"], visitDays: 2 });
    expect(l.score).toBe(30);
    expect(l.level).toBe("warm");
    expect(l.reasons).toContain("2nd day visiting");
  });
  test("looked at pricing earlier counts less than being on it now", () => {
    expect(scoreLead({ ...base, currentPath: "/radar", pathsHour: ["/pricing", "/radar"] }).score).toBe(35);
  });
  test("caps at 100", () => {
    const l = scoreLead({ currentPath: "/upgrade", pathsHour: ["/bid-scout", "/radar"], viewsHour: 9, visitDays: 5, signedIn: true });
    expect(l.score).toBe(100);
  });
});

describe("pageName", () => {
  test("names pages in words", () => {
    expect(pageName("/")).toBe("the homepage");
    expect(pageName("/pricing?x=1")).toBe("the pricing page");
    expect(pageName("/contracts-in/va/janitorial")).toBe("janitorial bids in Virginia");
    expect(pageName("/contracts-in/tx")).toBe("bids in Texas");
    expect(pageName("/learn/course-1")).toBe("a free course");
    expect(pageName("/some-page")).toBe("some page");
  });
});

describe("lines", () => {
  test("feed, visitor and hot lines", () => {
    expect(feedLine({ kind: "signup", place: "Richmond, VA", title: "New signup", detail: null })).toBe("New signup from Richmond, VA!");
    expect(feedLine({ kind: "purchase", place: null, title: "Starter", detail: null })).toBe("Sale! Starter.");
    expect(visitorLine(null, "/town/23834")).toBe("New visitor, on What's Your Town Buying.");
    expect(hotLine("Austin, TX", "/pricing")).toBe("Hot lead in Austin, TX, on the pricing page. Now's a good time to say hi.");
  });
});

describe("radarSpot", () => {
  test("stays in the box, hotter is closer to the center, same visitor same angle", () => {
    const d = (p: { x: number; y: number }) => Math.hypot(p.x - 50, p.y - 50);
    const hot = radarSpot("abc", 100);
    const cold = radarSpot("abc", 0);
    expect(d(hot)).toBeLessThan(d(cold));
    for (const p of [hot, cold, radarSpot("zzz-123", 50)]) {
      expect(p.x).toBeGreaterThanOrEqual(0);
      expect(p.x).toBeLessThanOrEqual(100);
      expect(p.y).toBeGreaterThanOrEqual(0);
      expect(p.y).toBeLessThanOrEqual(100);
    }
    expect(radarSpot("abc", 40)).toEqual(radarSpot("abc", 40));
  });
});

describe("announcements", () => {
  const hotLead = { score: 70, level: "hot" as const, reasons: [] };
  const sale = { id: "p1", kind: "purchase" as const, place: null, title: "Starter", detail: null, money: true };
  const search = { id: "s1", kind: "search" as const, place: "Houston, TX", title: "roofing", detail: null, money: false };

  test("says nothing on the first poll", () => {
    expect(announcements(null, [sale], [{ vid: "a", place: null, path: "/" }]).lines).toEqual([]);
  });
  test("money first, then hot leads, then the rest; nothing repeats", () => {
    const first = announcements(null, [], [{ vid: "a", place: null, path: "/" }]);
    const online = [
      { vid: "a", place: null, path: "/" },
      { vid: "b", place: "Austin, TX", path: "/pricing", lead: hotLead },
      { vid: "c", place: null, path: "/radar" },
    ];
    const next = announcements(first.state, [search, sale], online);
    expect(next.lines.map((l) => l.tone)).toEqual(["money", "hot", "blip", "blip"]);
    expect(next.lines[1].text).toContain("Hot lead in Austin, TX");
    expect(next.lines.some((l) => l.text.includes("New visitor, on Contract Radar"))).toBe(true);
    expect(announcements(next.state, [search, sale], online).lines).toEqual([]);
  });
  test("a visitor already here who turns hot is announced once", () => {
    const first = announcements(null, [], [{ vid: "a", place: null, path: "/radar" }]);
    const turned = announcements(first.state, [], [{ vid: "a", place: null, path: "/pricing", lead: hotLead }]);
    expect(turned.lines).toEqual([{ text: "Hot lead, on the pricing page. Now's a good time to say hi.", tone: "hot", vid: "a" }]);
    expect(isRedAlert(turned.lines[0])).toBe(true);
    expect(isRedAlert({ text: "New visitor, on the homepage.", tone: "blip" })).toBe(false);
  });
  test("a busy poll is capped with a summary line", () => {
    const first = announcements(null, [], []);
    const many = Array.from({ length: 7 }, (_, i) => ({ vid: `v${i}`, place: null, path: "/" }));
    const r = announcements(first.state, [], many);
    expect(r.lines).toHaveLength(MAX_LINES_PER_POLL);
    expect(r.lines.at(-1)!.text).toBe("And 4 more updates.");
  });
});
