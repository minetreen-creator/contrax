import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { BID_PREP_MIN_DAYS, BID_PREP_PRICE, BID_PREP_PRICE_CENTS, bidPrepOffered, cleanPrepRequest, prepAlert, prepBuyerConfirmation, prepFromMetadata, prepMetadata, prepOwnerNotice, type BidPrepOrder } from "./bid-prep";

const NOW = new Date("2026-11-17T15:00:00Z");
const ORDER: BidPrepOrder = { email: "owner@acmeclean.com", company: "Acme Cleaning LLC", bidId: 2301967, bidTitle: "Stow Road Sidewalk Improvements", agency: "City of Hudson", due: "2026-12-08T19:00:00.000Z" };

describe("bid prep", () => {
  test("the price is $199 in both forms", () => {
    expect(BID_PREP_PRICE).toBe("$199");
    expect(BID_PREP_PRICE_CENTS).toBe(19900);
  });
  test("offered only with a week or more left", () => {
    expect(bidPrepOffered("2026-12-08T19:00:00Z", NOW)).toBe(true);
    expect(bidPrepOffered(new Date(NOW.getTime() + BID_PREP_MIN_DAYS * 86_400_000), NOW)).toBe(true);
    expect(bidPrepOffered(new Date(NOW.getTime() + (BID_PREP_MIN_DAYS - 1) * 86_400_000), NOW)).toBe(false);
    expect(bidPrepOffered("2026-11-01T00:00:00Z", NOW)).toBe(false);
    expect(bidPrepOffered(null, NOW)).toBe(false);
    expect(bidPrepOffered("not a date", NOW)).toBe(false);
  });
  test("a request needs a real email, a company and a bid id", () => {
    expect(cleanPrepRequest({ email: " Owner@AcmeClean.com ", company: "Acme  Cleaning LLC", bidId: "2301967" })).toEqual({ email: "owner@acmeclean.com", company: "Acme Cleaning LLC", bidId: 2301967 });
    expect(cleanPrepRequest({ email: "nope", company: "Acme", bidId: 1 })).toBeNull();
    expect(cleanPrepRequest({ email: "a@b.co", company: "", bidId: 1 })).toBeNull();
    expect(cleanPrepRequest({ email: "a@b.co", company: "Acme", bidId: 0 })).toBeNull();
    expect(cleanPrepRequest(null)).toBeNull();
  });
  test("an order survives the trip through Stripe metadata", () => {
    expect(prepFromMetadata(prepMetadata(ORDER))).toEqual(ORDER);
    expect(prepFromMetadata({ product: "pipeline_report" })).toBeNull();
    for (const v of Object.values(prepMetadata({ ...ORDER, bidTitle: "x".repeat(900) }))) expect(v.length).toBeLessThanOrEqual(500);
  });
  test("the owner notice and the buyer email carry the bid, the deadline and the questions", () => {
    const owner = prepOwnerNotice(ORDER, "cs_test_1");
    expect(owner.subject).toContain("PAID $199");
    expect(owner.text).toContain("https://www.contrax.company/bid/2301967");
    expect(owner.text).toContain("December 8, 2026");
    const buyer = prepBuyerConfirmation(ORDER);
    expect(buyer.text).toContain("Stow Road Sidewalk Improvements");
    expect(buyer.text).toContain("full refund");
    expect(buyer.text).toContain("Do not send tax ID, bank or card numbers by email");
    expect(buyer.text).toContain("We cannot promise you will win");
  });
  test("Mission Control hears about a started and a paid order under different tags", () => {
    expect(prepAlert(ORDER, "cs_1", false).tag).not.toBe(prepAlert(ORDER, "cs_1", true).tag);
    expect(prepAlert(ORDER, "cs_1", true).title).toContain("$199");
  });
  test("the bid page shows the offer, the webhook handles it and checkout reads the bid itself", () => {
    expect(readFileSync("src/routes/bid.$bidId.tsx", "utf8")).toContain("<BidPrepOffer bidId={bid.id} dueDate={bid.due_date} />");
    expect(readFileSync("src/lib/stripe.ts", "utf8")).toContain("handleBidPrepEvent(event)");
    const route = readFileSync("src/routes/api/bid-prep/checkout.ts", "utf8");
    expect(route).toContain("FROM bids WHERE id = ${req.bidId}");
    expect(route).toContain("bidPrepOffered(bid.due_date)");
    expect(readFileSync("src/lib/bid-prep.server.ts", "utf8")).toContain("session.amount_total === BID_PREP_PRICE_CENTS");
  });
});
