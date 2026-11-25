import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import {
  AWARD_PAGE_MIN,
  awardDescription,
  awardIdFromSlug,
  awardOutOfState,
  awardPageEligible,
  awardPath,
  awardSitemapXml,
  awardTitle,
  awardWhat,
  onFileLine,
  type AwardPageData,
} from "./award-pages";

const page: AwardPageData = {
  id: 4812,
  path: "/federal-award/semper-tek-cms-jv-llc-nc-4812",
  company: "Semper Tek CMS JV LLC",
  basedIn: "Lexington, KY",
  recipientState: "KY",
  state: "NC",
  stateName: "North Carolina",
  amount: 26_705_489,
  awardedOn: "2026-11-16T00:00:00.000Z",
  agency: "Department of Veterans Affairs",
  subAgency: "",
  what: "Construction to provide infrastructure upgrades at Asheville VAMC campus",
  recordUrl: "https://www.usaspending.gov/award/X",
  onFile: { contact: true, address: true, website: false },
  others: [],
};

describe("award pages (owner 2026-11-24)", () => {
  test("a path round-trips to the award's id, whatever the company is called", () => {
    expect(awardPath("Semper Tek CMS JV LLC", "NC", 4812)).toBe("/federal-award/semper-tek-cms-jv-llc-nc-4812");
    expect(awardIdFromSlug("semper-tek-cms-jv-llc-nc-4812")).toBe(4812);
    expect(awardIdFromSlug(awardPath("3M Company 2000", "TX", 7).split("/").pop()!)).toBe(7);
    expect(awardPath("???", "VA", 9)).toBe("/federal-award/award-va-9");
    expect(awardIdFromSlug("no-number-here")).toBeNull();
    expect(awardIdFromSlug("x-0")).toBeNull();
    expect(awardIdFromSlug("")).toBeNull();
  });

  test("only large construction awards in the report's states get a page", () => {
    const ok = { amount: AWARD_PAGE_MIN, naics_code: "236220", pop_state: "NC", awarded_on: "2026-11-16" };
    expect(awardPageEligible(ok)).toBe(true);
    expect(awardPageEligible({ ...ok, amount: AWARD_PAGE_MIN - 1 })).toBe(false);
    expect(awardPageEligible({ ...ok, naics_code: "541330" })).toBe(false);
    expect(awardPageEligible({ ...ok, pop_state: "AK" })).toBe(false);
    expect(awardPageEligible({ ...ok, awarded_on: null })).toBe(false);
  });

  test("the title and description state the winner, the amount and the date", () => {
    expect(awardTitle(page)).toBe("Semper Tek CMS JV LLC won a $26.7 million federal construction contract in North Carolina | Contrax");
    const d = awardDescription(page);
    expect(d).toContain("Semper Tek CMS JV LLC of Lexington, KY won $26.7 million");
    expect(d).toContain("November 16, 2026");
    expect(awardOutOfState(page)).toBe(true);
    expect(awardOutOfState({ recipientState: "NC", state: "NC" })).toBe(false);
    expect(awardOutOfState({ recipientState: null, state: "NC" })).toBe(false);
  });

  test("the page names what is on file and never the details", () => {
    expect(onFileLine(page.onFile)).toBe("On file for this winner: a named contact and the office address.");
    expect(onFileLine({ contact: true, address: true, website: true })).toBe("On file for this winner: a named contact, the office address and the company website.");
    expect(onFileLine({ contact: false, address: false, website: false })).toBe("");
    // The page data carries booleans for the contact, not the contact itself.
    const server = readFileSync("src/lib/award-pages.server.ts", "utf8");
    expect(server).not.toMatch(/contact_title|\bzip\b/);
    const route = readFileSync("src/routes/federal-award.$slug.tsx", "utf8");
    expect(route).not.toMatch(/Contact on file: \{/);
  });

  test("a shouted description is tidied to one line", () => {
    expect(awardWhat("REPLACE   BOILER\nBUILDING 4")).toBe("Replace Boiler Building 4");
    expect(awardWhat(null)).toBe("");
  });

  test("the sitemap lists award pages and robots.txt points at it", () => {
    const xml = awardSitemapXml([{ company: "Semper Tek CMS JV LLC", state: "NC", id: 4812 }]);
    expect(xml).toContain("<loc>https://www.contrax.company/federal-award/semper-tek-cms-jv-llc-nc-4812</loc>");
    expect(readFileSync("public/robots.txt", "utf8")).toContain("Sitemap: https://www.contrax.company/sitemap-awards.xml");
  });
});
