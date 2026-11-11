import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";

// Owner 2026-11-11 (funnel review, 7 days): 152 visitors were counted as shown an email ask and 4 gave
// an email; 91 saw the bid list on Radar and 1 tapped a bid. Both asks sat where few people reach.
const radar = readFileSync("src/routes/radar.tsx", "utf8");
const bid = readFileSync("src/routes/bid.$bidId.tsx", "utf8");

test("Radar results: the email field is the first thing under the count, before the bid cards", () => {
  const top = radar.indexOf("<EmailUnlockCard\n                    compact");
  const cards = radar.indexOf("{scan.matches.slice(0, visibleCount).map((m, i) => (");
  const bottom = radar.lastIndexOf("<EmailUnlockCard");
  expect(top).toBeGreaterThan(0);
  expect(top).toBeLessThan(cards);
  expect(bottom).toBeGreaterThan(cards); // the full card stays under the cards
  expect(radar).toContain('id="radar-unlock-email-top"');
  expect(radar).toContain("Showing {shown} of {total} matching bids. See {seeAll} now:");
  // The old bar only scrolled down to the card.
  expect(radar).not.toContain('trackEvent("radar_unlock_bar_click"');
  // Which form worked is recorded; the "shown" count is not doubled.
  expect(radar).toContain('trackEvent("radar_lead_captured", compact ? "email_unlock_top" : "email_unlock");');
  expect(radar).toContain("if (shownRef.current || compact) return;");
});

test("Radar bid list: the whole row is the link and says so", () => {
  const i = radar.indexOf('trackEvent("radar_bids_first_click", tab)');
  const row = radar.slice(i - 200, i + 900);
  expect(row).toContain("href={`/bid/${b.id}`}");
  expect(row).toContain("View →");
  expect(row).toContain("{b.title}");
  expect(row.indexOf("b.agency")).toBeLessThan(row.indexOf("</a>")); // agency and due date are inside the link
  expect(radar).toContain("Tap a bid to see the job, the due date and how to bid.");
});

test("bid page: the email offer comes right after the bid, before the scanner and similar bids", () => {
  const alert = bid.indexOf("<BidAlertCapture");
  expect(alert).toBeGreaterThan(bid.indexOf("</article>"));
  expect(alert).toBeLessThan(bid.indexOf("<RedFlagScanner"));
  expect(alert).toBeLessThan(bid.indexOf("<MaxAssistant"));
  expect(bid.match(/<BidAlertCapture/g)).toHaveLength(1);
  expect(bid).toContain('heading="Not ready to bid this one? Get the next ones by email"');
});
