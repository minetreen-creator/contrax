import { describe, expect, test } from "bun:test";

import { STARTER_FIRST_MONTH_AMOUNT_OFF, STARTER_FIRST_MONTH_PRICE, starterFirstMonthApplies } from "./starter-offer";
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
