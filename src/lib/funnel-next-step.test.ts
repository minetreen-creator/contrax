import { expect, test } from "bun:test";
import { agencyCardLabel } from "./bid-job-summary";
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

// Owner 2026-11-11 ("I do like their layout better"): the rows became cards, two across on a wide screen.
test("Radar bid list: each bid is a card, the whole card is the link and says so", () => {
  const i = radar.indexOf('trackEvent("radar_bids_first_click", tab)');
  const row = radar.slice(i - 200, i + 1300);
  expect(row).toContain("href={`/bid/${b.id}`}");
  expect(row).toContain("See the job and how to bid →");
  expect(radar).toContain('<ul className="mt-2 grid grid-cols-1 gap-2.5 sm:grid-cols-2">');
  expect(row).toContain("uppercase tracking-wider"); // agency sits above the title
  expect(row.indexOf("agencyCardLabel(b.agency)")).toBeLessThan(row.indexOf("{displayTitle(b.title)}"));
  expect(row).toContain("{displayTitle(b.title)}"); // all-capitals titles read in title case (owner 2026-11-13)
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

// Owner 2026-11-11: on a card the BidNet wording was cut off ("AN OHIO PUBLIC AGENCY (POSTE…").
test("a bid card's agency line fits: BidNet bids say where they were posted, others name the agency", () => {
  expect(agencyCardLabel("Ohio Purchasing Group (BidNet Direct)")).toBe("Posted on BidNet Direct");
  expect(agencyCardLabel("City of Hampton")).toBe("City of Hampton");
  expect(agencyCardLabel("")).toBeNull();
});

// Owner 2026-11-11: 79 Facebook visitors in 14 days, 26 reached their results, almost none opened a
// bid (where the $5 offer is). The only link was a button labelled "Get the AI Executive Brief".
test("a Radar result opens its bid in plain words, for a visitor without an account", () => {
  expect(radar).toContain("See this bid: the job, the due date and how to bid");
  expect(radar).toContain('trackEvent("radar_match_title_click", String(match.id))');
  const i = radar.indexOf("See this bid: the job, the due date and how to bid");
  const btn = radar.slice(i - 400, i);
  expect(btn).toContain("href={`/bid/${match.id}`}");
  expect(btn).toContain("bg-amber-500"); // the main button on the card, not an outline
  // A signed-in member's card keeps its own wording.
  expect(radar).toContain("✦ Get the AI Executive Brief");
});
