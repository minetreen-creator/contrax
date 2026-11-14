import { describe, expect, test } from "bun:test";

import { bidPlace, contactLinks, csvCell, extractEmails, placesQuery, siteHost } from "./prospect-finder";

describe("extractEmails", () => {
  test("finds mailto and plain-text addresses, own domain first", () => {
    const html = `<a href="mailto:Office@Gmail.com">Email</a> <p>Call or write sales@acmeclean.com</p>`;
    expect(extractEmails(html, "acmeclean.com")).toEqual(["sales@acmeclean.com", "office@gmail.com"]);
  });

  test("a URL-encoded space before an address is dropped; template boxes are skipped (owner 2026-10-29)", () => {
    const html = `<a href="mailto:%20info@sunridgeroofing.com">Email</a> example@coolairinc.com`;
    expect(extractEmails(html, "sunridgeroofing.com")).toEqual(["info@sunridgeroofing.com"]);
  });

  test("undoes encoded @ and drops images, placeholders and no-reply", () => {
    const html = `info&#64;acme.com bob%40acme.com logo@2x.png name@example.com noreply@acme.com you@domain.com x@sentry.io jane@company.com`;
    expect(extractEmails(html, "acme.com").sort()).toEqual(["bob@acme.com", "info@acme.com"]);
  });

  test("nothing on the page means nothing found", () => {
    expect(extractEmails("<p>Call us at 555-0100</p>")).toEqual([]);
  });
});

describe("contactLinks", () => {
  test("same-site contact and about pages only", () => {
    const html = `<a href="/contact-us">Contact</a><a href="https://other.com/contact">x</a><a href="/services">Services</a><a href="about.html">About us</a><a href="/contact-us">Again</a>`;
    expect(contactLinks(html, "https://www.acme.com/")).toEqual(["https://www.acme.com/contact-us", "https://www.acme.com/about.html"]);
  });
});

describe("bidPlace and placesQuery", () => {
  test("uses the bid's location, else the buyer and state", () => {
    expect(bidPlace("Raleigh, NC", "City of Raleigh", "NC")).toBe("Raleigh, NC");
    expect(bidPlace("Nationwide", "Town of Cary", "NC")).toBe("Town of Cary, NC");
    expect(bidPlace(null, null, "NC")).toBe("NC");
    expect(placesQuery(" janitorial ", "Raleigh, NC")).toBe("janitorial company near Raleigh, NC");
  });
});

describe("siteHost and csvCell", () => {
  test("bare host and safe CSV", () => {
    expect(siteHost("https://www.Acme.com/contact")).toBe("acme.com");
    expect(siteHost("not a url")).toBeNull();
    expect(csvCell('Say "hi", ok')).toBe('"Say ""hi"", ok"');
    expect(csvCell(null)).toBe("");
  });
});

// Owner 2026-11-14: the Google Places billing account was closed and every
// search returned 403, so no first emails were queued for a week. The
// contractor registry is the free source when Places is missing or failing.
import { readFileSync as readSource } from "node:fs";
import { registryTrade } from "./prospect-finder";

describe("contractor registry in place of Google Places", () => {
  test("an outreach trade maps to the registry's trade, narrowed by NAICS for building trades", () => {
    expect(registryTrade("janitorial")).toMatchObject({ trade: "janitorial", naics: [] });
    expect(registryTrade("cleaning")).toMatchObject({ trade: "janitorial", naics: [] });
    expect(registryTrade("grounds maintenance")?.trade).toBe("landscaping");
    expect(registryTrade("HVAC")?.trade).toBe("hvac");
    expect(registryTrade("security guard")?.trade).toBe("security-guard");
    expect(registryTrade("roofing")).toMatchObject({ trade: "construction", naics: ["238160"] });
    expect(registryTrade("construction")).toMatchObject({ trade: "construction", naics: ["236220", "236210"] });
    // A business must be named for the trade or list only a few codes.
    expect(new RegExp(registryTrade("janitorial")!.name, "i").test("Veterans Cleaning Group, LLC")).toBe(true);
    expect(new RegExp(registryTrade("janitorial")!.name, "i").test("Cardinal Recruiting LLC")).toBe(false);
    expect(new RegExp(registryTrade("construction")!.name, "i").test("Pinnacle Software Consulting, Inc.")).toBe(false);
    expect(registryTrade("pest control")).toBeNull();
    expect(registryTrade("moving")).toBeNull();
  });
  test("both jobs fall back to the registry, and a dead key no longer ends the run", () => {
    const finder = readSource("src/jobs/prospect-finder.ts", "utf8");
    expect(finder).toContain("export async function searchRegistrants(");
    expect(finder).toContain("AND url IS NOT NULL AND url <> ''");
    expect(finder).toContain("AND (name ~* ${t.name} OR cardinality(naics) <= ${FOCUSED_NAICS})");
    expect(finder).toContain('return { places: await searchRegistrants(reg), source: "registry" };');
    expect(finder).not.toContain("nothing to do.");
    const prepare = readSource("src/jobs/outreach-prepare.ts", "utf8");
    expect(prepare).toContain("await findBusinesses(key, query,");
    expect(prepare).not.toContain("no new first emails today");
    // Still only emails the business publishes on its own site, and never a known address.
    expect(prepare).toContain("emails.find((e) => emailFitsSite(e, host, p.name))");
    expect(prepare).toContain("await isNewAddress(email)");
  });
  test("a focus run takes any outreach trade in one state, with more businesses per bid", () => {
    const prepare = readSource("src/jobs/outreach-prepare.ts", "utf8");
    expect(prepare).toContain("OUTREACH_TRADES.find((t) => t.match === FOCUS_TRADE || t.label.toLowerCase() === FOCUS_TRADE)");
    expect(prepare).toContain("const FOCUS_BUSINESSES_PER_BID = 10;");
    expect(prepare).toContain("WHERE normalized_state = ${state}");
    // The daily run keeps its two businesses per bid.
    expect(prepare).toContain("perBid = BUSINESSES_PER_BID");
  });
});
