import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { bidSeoDescription, bidSeoTitle } from "~/lib/bid-seo";
import { agencyInSentence } from "~/lib/bid-job-summary";
import { STARTER_YEARLY_COST } from "~/lib/bid-value-calculator";
import { BOT_EXCLUSION_SQL } from "~/lib/bot-exclusion";
import { SEO_TRADES } from "~/lib/seo-trades";

// Owner 2026-11-11 (revenue review): ChatGPT is the fastest-growing source (1 visitor a week in
// September, 31 the week of Nov 2) and its visitors click $5 at the best rate. It reads llms.txt and
// the bid pages, so both must say what is true today.
const llms = readFileSync("public/llms.txt", "utf8");

test("llms.txt gives today's offer, not the old plans and trial", () => {
  expect(llms).toContain("$5 one time for 30 days");
  expect(llms).toContain("$14 a month");
  expect(llms).toContain("There is no trial");
  expect(llms).not.toMatch(/\$19|\$79|\$199|7-day|free trial/i);
});

test("llms.txt points at the pages assistants send people to", () => {
  for (const path of ["/radar", "/contracts-in/texas/janitorial", "/bid/{id}", "/sitemap-bids.xml", "/map", "/subcontracts", "/subs-wanted", "/co-op-contracts", "/megaprojects"]) {
    expect({ path, listed: llms.includes(`https://www.contrax.company${path}`) }).toEqual({ path, listed: true });
  }
  // Every trade slug it names is a real /contracts-in trade.
  const named = /Trades: ([a-z, -]+)\./.exec(llms)![1].split(", ");
  const real = new Set(SEO_TRADES.map((t) => t.slug));
  for (const slug of named) expect({ slug, real: real.has(slug) }).toEqual({ slug, real: true });
});

test("a bid page's title and description do not name a BidNet group as the buyer", () => {
  const bid = { id: 1, title: "Roof Repairs and Replacement", agency: "Ohio Purchasing Group (BidNet Direct)", location: "Ohio", set_aside: null, due_date: "2026-11-18T23:59:00Z", description: null };
  expect(bidSeoTitle(bid)).toBe("Roof Repairs and Replacement — Ohio public agency (due Nov 18, 2026) | Contrax");
  expect(bidSeoDescription(bid)).toContain("An Ohio public agency (posted on BidNet Direct)");
  expect(bidSeoDescription(bid)).not.toContain("Purchasing Group");
  // A real buyer is unchanged.
  expect(bidSeoTitle({ ...bid, agency: "City of Hudson" })).toBe("Roof Repairs and Replacement — City of Hudson (due Nov 18, 2026) | Contrax");
});

test("the buyer reads right inside a sentence", () => {
  expect(agencyInSentence("Ohio Purchasing Group (BidNet Direct)")).toBe("an Ohio public agency (posted on BidNet Direct)");
  expect(agencyInSentence("Texas Purchasing Group (BidNet Direct)")).toBe("a Texas public agency (posted on BidNet Direct)");
  expect(agencyInSentence("City of Hudson")).toBe("City of Hudson");
  expect(agencyInSentence("Ashtabula County")).toBe("Ashtabula County");
  expect(readFileSync("src/routes/bid.$bidId.tsx", "utf8")).toContain(", for ${agencyInSentence(bid.agency)}");
});

test("the pricing calculator uses today's Starter price", () => {
  expect(STARTER_YEARLY_COST).toBe(168);
});

test("mail-scanner clicks on outreach emails are not counted as visitors", () => {
  expect(BOT_EXCLUSION_SQL).toContain("COALESCE(medium,'') = 'bhgefbdu'");
  // A real click keeps the word and is not excluded by this rule.
  expect(BOT_EXCLUSION_SQL).not.toContain("= 'outreach'");
});
