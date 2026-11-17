import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { NATIONWIDE_SLUG, OPEN_BIDS_PAGE_SIZE, OPEN_BIDS_STATES, openBidsHref, openBidsHrefForState, openBidsPage, openBidsPageCount, openBidsPageLinks, openBidsPlace } from "./open-bids-list";

describe("open bids list pages", () => {
  test("every state has a page, plus one for bids with no state", () => {
    expect(OPEN_BIDS_STATES.length).toBeGreaterThanOrEqual(51);
    expect(openBidsPlace("ohio")).toEqual({ code: "OH", name: "Ohio", slug: "ohio" });
    expect(openBidsPlace("new-york")?.code).toBe("NY");
    expect(openBidsPlace("district-of-columbia")?.code).toBe("DC");
    expect(openBidsPlace(NATIONWIDE_SLUG)?.code).toBeNull();
    expect(openBidsPlace("atlantis")).toBeNull();
    expect(openBidsHrefForState("New York")).toBe("/open-bids/new-york");
    expect(openBidsHrefForState(null)).toBeNull();
  });
  test("pages are 100 bids, numbered from 1, and a bad page number is page 1", () => {
    expect(OPEN_BIDS_PAGE_SIZE).toBe(100);
    expect(openBidsPageCount(0)).toBe(1);
    expect(openBidsPageCount(100)).toBe(1);
    expect(openBidsPageCount(101)).toBe(2);
    expect(openBidsPage("3")).toBe(3);
    expect(openBidsPage("0")).toBe(1);
    expect(openBidsPage("abc")).toBe(1);
    expect(openBidsPage(2.5)).toBe(1);
    expect(openBidsHref("ohio")).toBe("/open-bids/ohio");
    expect(openBidsHref("ohio", 4)).toBe("/open-bids/ohio?page=4");
  });
  test("page links always include the first and last page", () => {
    expect(openBidsPageLinks(1, 1)).toEqual([1]);
    expect(openBidsPageLinks(1, 30)).toEqual([1, 2, 3, 4, 30]);
    expect(openBidsPageLinks(15, 30)).toEqual([1, 12, 13, 14, 15, 16, 17, 18, 30]);
  });
  test("the list uses the bid sitemap's filters and is linked from the state page, the bid page and the sitemap", () => {
    const route = readFileSync("src/routes/open-bids.$state.tsx", "utf8");
    expect(route).toContain("AND ${s.unsafe(LOW_CONTENT_SQL)} AND ${s.unsafe(AWARD_EXCLUSION_SQL)}");
    expect(route).toContain("due_date > NOW()");
    expect(route).toContain("href={`/bid/${b.id}`}");
    expect(readFileSync("src/routes/contracts-in.$state.tsx", "utf8")).toContain("openBidsHrefForState(data.name)");
    expect(readFileSync("src/routes/bid.$bidId.tsx", "utf8")).toContain("openBidsHrefForState(bid.state_name)");
    expect(readFileSync("src/routes/sitemap-local[.]xml.ts", "utf8")).toContain("...OPEN_BIDS_STATES.map((s) => openBidsHref(s.slug)),");
  });
});
