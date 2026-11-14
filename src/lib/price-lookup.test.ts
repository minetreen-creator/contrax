import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { addLookupSession, cleanLookupSessions, lookupSessionId, PRICE_LOOKUP_MAX_KEPT, PRICE_LOOKUP_PRICE_CENTS, PRICE_LOOKUP_PRODUCT } from "./price-lookup";

// Owner 2026-11-14 ("3"): a $9 one-time "What did this sell for?" on a bid page.
describe("$9 price lookup", () => {
  const A = "cs_live_a1B2c3D4e5F6g7H8i9J0";
  const B = "cs_test_ZZZZZZZZZZZZZZZZ";

  test("costs $9, one product name", () => {
    expect(PRICE_LOOKUP_PRICE_CENTS).toBe(900);
    expect(PRICE_LOOKUP_PRODUCT).toBe("price_lookup");
  });

  test("only real Stripe checkout session ids are kept", () => {
    expect(lookupSessionId(A)).toBe(A);
    expect(lookupSessionId(B)).toBe(B);
    expect(lookupSessionId("cs_live_short")).toBeNull();
    expect(lookupSessionId("pi_123456789012345")).toBeNull();
    expect(lookupSessionId("cs_live_abc'; DROP TABLE x;--")).toBeNull();
    expect(lookupSessionId(42)).toBeNull();
  });

  test("the browser list drops junk and repeats and keeps the newest", () => {
    expect(cleanLookupSessions([A, "x", A, B, null])).toEqual([A, B]);
    expect(cleanLookupSessions("not a list")).toEqual([]);
    const many = Array.from({ length: PRICE_LOOKUP_MAX_KEPT + 5 }, (_, i) => `cs_live_${String(i).padStart(12, "0")}`);
    const kept = cleanLookupSessions(many);
    expect(kept.length).toBe(PRICE_LOOKUP_MAX_KEPT);
    expect(kept.at(-1)).toBe(many.at(-1));
  });

  test("adding a purchase survives a broken or empty store", () => {
    expect(JSON.parse(addLookupSession(null, A))).toEqual([A]);
    expect(JSON.parse(addLookupSession("{broken", A))).toEqual([A]);
    expect(JSON.parse(addLookupSession(JSON.stringify([A]), B))).toEqual([A, B]);
    expect(JSON.parse(addLookupSession(JSON.stringify([A]), A))).toEqual([A]);
  });

  test("it is wired in: webhook, checkout only with awards to show, and the bid page check", () => {
    const stripe = readFileSync("src/lib/stripe.ts", "utf8");
    expect(stripe).toContain("handlePriceLookupEvent(event)");
    const checkout = readFileSync("src/routes/api/price-lookup/checkout.ts", "utf8");
    expect(checkout).toContain("awards.total <= 0");
    expect(checkout).toContain('checkIpLimit(request, "price-lookup-checkout"');
    const page = readFileSync("src/routes/bid.$bidId.tsx", "utf8");
    expect(page).toContain("hasPriceLookup(id, lookups, user?.email ?? null)");
    const server = readFileSync("src/lib/price-lookup.server.ts", "utf8");
    expect(server).toContain('payment_status !== "paid"');
    expect(server).toContain("ids.slice(-3)");
    const box = readFileSync("src/components/AreaAwardsBox.tsx", "utf8");
    expect(box).toContain("One-time, for this bid. No account or subscription needed.");
  });
});
