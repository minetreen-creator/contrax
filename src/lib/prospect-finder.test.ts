import { describe, expect, test } from "bun:test";

import { bidPlace, contactLinks, csvCell, extractEmails, placesQuery, siteHost } from "./prospect-finder";

describe("extractEmails", () => {
  test("finds mailto and plain-text addresses, own domain first", () => {
    const html = `<a href="mailto:Office@Gmail.com">Email</a> <p>Call or write sales@acmeclean.com</p>`;
    expect(extractEmails(html, "acmeclean.com")).toEqual(["sales@acmeclean.com", "office@gmail.com"]);
  });

  test("a URL-encoded space before an address is dropped; template boxes are skipped (owner 2026-10-29)", () => {
    const html = `<a href="mailto:%20info@canroofconstruction.com">Email</a> example@thermodirectinc.com`;
    expect(extractEmails(html, "canroofconstruction.com")).toEqual(["info@canroofconstruction.com"]);
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
