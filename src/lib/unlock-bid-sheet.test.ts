import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { checkoutBidToOpen, clearCheckoutBid, rememberCheckoutBid, RESUME_WINDOW_MS } from "./checkout-resume";
import { STARTER_FULL_PRICE } from "./starter-offer";

// Owner 2026-11-08: 4 of the day's 6 Stripe checkouts came from the bid page's $5 button, none paid.
function memory() {
  const m = new Map<string, string>();
  return { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => void m.set(k, v), removeItem: (k: string) => void m.delete(k) };
}

describe("bid-page $5 confirm step", () => {
  test("the bid a checkout started from is remembered for 48 hours, then cleared", () => {
    const s = memory();
    const t = Date.parse("2026-11-08T23:00:00Z");
    rememberCheckoutBid(1449965, t, s);
    expect(checkoutBidToOpen(t + 60_000, s)).toBe(1449965);
    expect(checkoutBidToOpen(t + RESUME_WINDOW_MS + 1, s)).toBeNull();
    clearCheckoutBid(s);
    expect(checkoutBidToOpen(t + 60_000, s)).toBeNull();
    rememberCheckoutBid(-3, t, s);
    expect(checkoutBidToOpen(t, s)).toBeNull();
  });

  test("the regular Starter month is $19", () => {
    expect(STARTER_FULL_PRICE).toBe(19);
  });

  test("first-time buyers get the sheet; a used pass is told $19/month, never '$5 one time'", () => {
    const page = readFileSync(new URL("../routes/bid.$bidId.tsx", import.meta.url), "utf8");
    expect(page).toContain('const pass = (bid?.starter_kind ?? "pass") === "pass";');
    expect(page).toContain("setConfirming(true);");
    expect(page).toContain("Starter is $${STARTER_FULL_PRICE}/month. Cancel anytime.");
    expect(page).toContain('await import("~/lib/starter-pass.server")');
    const sheet = readFileSync(new URL("../components/UnlockBidSheet.tsx", import.meta.url), "utf8");
    expect(sheet).toContain("one time. No automatic renewal.");
    expect(sheet).toContain("rememberCheckoutBid(bidId);");
  });

  test("after paying, the buyer lands back on that bid", () => {
    const post = readFileSync(new URL("../routes/post-checkout.tsx", import.meta.url), "utf8");
    expect(post).toContain("checkoutBidToOpen()");
    expect(post).toContain('navigate({ to: "/bid/$bidId", params: { bidId: String(bidToOpen) }');
  });
});
