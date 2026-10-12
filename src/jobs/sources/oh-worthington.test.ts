import { expect, test } from "bun:test";
import { readWorthingtonListings, readWorthingtonDeadline, worthingtonRow } from "./oh-worthington";
import { findPlace, AGENCY_BY_SLUG } from "~/lib/local-agencies";

const phrase = "The completed response must be delivered on or before Monday, November 2, 2026, by 12:00 PM (noon).";
const html = '<h2><a href="/DocumentCenter/View/13616/Planning-and-Zoning">RFP: Planning &amp; Zoning Code Assessment and Rewrite</a></h2>';

test("reads official document identity and title, deduplicates links", () => {
  const list = readWorthingtonListings(html + html + '<a href="https://other.example/DocumentCenter/View/123">RFP: Other city</a>');
  expect(list).toHaveLength(1);
  expect(list[0].id).toBe("13616");
  expect(list[0].title).toBe("Planning & Zoning Code Assessment and Rewrite");
});

test("reads noon deadline with EST after DST ends, never a question date", () => {
  expect(readWorthingtonDeadline("Questions due October 16, 2026 at 4:00 PM. " + phrase)?.iso).toBe("2026-11-02T17:00:00.000Z");
  expect(readWorthingtonDeadline("Question deadline November 2, 2026 at noon")).toBeNull();
  expect(readWorthingtonDeadline(phrase.replace("November 2", "February 30"))).toBeNull();
  expect(readWorthingtonDeadline(phrase.replace("12:00 PM", "noon"))).toBeNull();
  expect(readWorthingtonDeadline(phrase.replace("November 2", "October 12"))?.iso).toBe("2026-10-12T16:00:00.000Z");
});

test("expired or undated records are excluded; budget and source provenance retained", () => {
  const listing = readWorthingtonListings(html)[0];
  const text = phrase + " The City has budgeted $275,000 for the project.";
  const row = worthingtonRow(listing, text, Date.parse("2026-10-12T14:00:00Z"));
  expect(row?.estimated_value).toBe("$275,000");
  expect(row?.external_id).toBe("worthington-13616");
  expect(row?.location).toBe("Worthington, OH");
  expect(row?.set_aside).toBeNull();
  expect(worthingtonRow(listing, text, Date.parse("2026-11-02T17:00:00Z"))).toBeNull();
  expect(worthingtonRow(listing, "Open Upon Contract", Date.now())).toBeNull();
});

test("Worthington resolves to its Ohio city and agency pages", () => {
  expect(findPlace("ohio", "worthington")?.stateCode).toBe("OH");
  expect(AGENCY_BY_SLUG["city-of-worthington"]?.source).toBe("oh_worthington");
});
