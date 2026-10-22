import { describe, expect, test } from "bun:test";

import { guestCheckoutAllowed, postCheckoutAccess, STARTER_FIRST_MONTH_AMOUNT_OFF, STARTER_FIRST_MONTH_PRICE, starterFirstMonthApplies } from "./starter-offer";
import { MONTHLY_PRICE_USD } from "./stripe";

describe("Starter $5 first month", () => {
  test("the coupon takes the monthly price down to the advertised first month", () => {
    expect((MONTHLY_PRICE_USD.starter ?? 0) * 100 - STARTER_FIRST_MONTH_AMOUNT_OFF).toBe(STARTER_FIRST_MONTH_PRICE * 100);
  });

  test("only monthly Starter subscriptions outside the VAD price", () => {
    const base = { planTier: "starter", interval: "month", mode: "subscription", vad: false } as const;
    expect(starterFirstMonthApplies(base)).toBe(true);
    expect(starterFirstMonthApplies({ ...base, interval: "year" })).toBe(false);
    expect(starterFirstMonthApplies({ ...base, planTier: "professional" })).toBe(false);
    expect(starterFirstMonthApplies({ ...base, vad: true })).toBe(false);
    expect(starterFirstMonthApplies({ ...base, mode: "payment" })).toBe(false);
  });
});

describe("pay first, account after", () => {
  test("only monthly Starter may start checkout signed out", () => {
    expect(guestCheckoutAllowed({ planTier: "starter" })).toBe(true);
    expect(guestCheckoutAllowed({ planTier: "starter", interval: "month", mode: "subscription" })).toBe(true);
    expect(guestCheckoutAllowed({ planTier: "starter", interval: "year" })).toBe(false);
    expect(guestCheckoutAllowed({ planTier: "professional" })).toBe(false);
    expect(guestCheckoutAllowed({ planTier: "starter", promoCode: "VAD26" })).toBe(false);
    expect(guestCheckoutAllowed({ planTier: "starter", founding: true })).toBe(false);
    expect(guestCheckoutAllowed({ planTier: "starter", mode: "payment" })).toBe(false);
  });

  const created = Date.parse("2026-10-22T15:00:00Z");
  test("a signed-in checkout signs in that account only", () => {
    expect(postCheckoutAccess({ metadataUserId: 7, sessionCreatedMs: created, account: { id: 9, createdAtMs: 0 }, metadataAccount: { id: 7 } })).toEqual({ kind: "login", userId: 7 });
    expect(postCheckoutAccess({ metadataUserId: 7, sessionCreatedMs: created, account: null, metadataAccount: null })).toEqual({ kind: "sign_in_required" });
  });

  test("a pay-first checkout never opens an older account with the same email", () => {
    expect(postCheckoutAccess({ metadataUserId: null, sessionCreatedMs: created, account: null, metadataAccount: null })).toEqual({ kind: "create" });
    expect(postCheckoutAccess({ metadataUserId: null, sessionCreatedMs: created, account: { id: 3, createdAtMs: created + 5_000 }, metadataAccount: null })).toEqual({ kind: "login", userId: 3 });
    expect(postCheckoutAccess({ metadataUserId: null, sessionCreatedMs: created, account: { id: 3, createdAtMs: created - 86_400_000 }, metadataAccount: null })).toEqual({ kind: "sign_in_required" });
  });
});
