import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { dollars, isRealSale, monthlyRecurring, renewalRate, revenueWindows, weekGrowthLabel } from "./investor-numbers";

// Owner 2026-11-04: "yes add the investor numbers panel".
const NOW = Date.parse("2026-11-04T03:00:00Z");
const at = (daysAgo: number) => Math.floor((NOW - daysAgo * 86_400_000) / 1000);
const noAdmin = () => false;

describe("investor numbers", () => {
  test("only real paid checkouts count: no unpaid, test, owner or path-check sessions", () => {
    expect(isRealSale({ created: at(0), payment_status: "paid", amount_total: 500, customer_details: { email: "buyer@gmail.com" } }, noAdmin)).toBe(true);
    expect(isRealSale({ created: at(0), payment_status: "unpaid", amount_total: 500 }, noAdmin)).toBe(false);
    expect(isRealSale({ created: at(0), payment_status: "paid", amount_total: 500, customer_details: { email: "qa@test.contrax" } }, noAdmin)).toBe(false);
    expect(isRealSale({ created: at(0), payment_status: "paid", amount_total: 500, metadata: { probe: "path_check" } }, noAdmin)).toBe(false);
    expect(isRealSale({ created: at(0), payment_status: "paid", amount_total: 500, customer_details: { email: "owner@x.com" } }, (e) => e === "owner@x.com")).toBe(false);
  });

  test("revenue and weekly sales windows", () => {
    const w = revenueWindows(
      [
        { created: at(0.1), payment_status: "paid", amount_total: 500 }, // the first $5
        { created: at(3), payment_status: "paid", amount_total: 1900 },
        { created: at(10), payment_status: "paid", amount_total: 500 },
        { created: at(40), payment_status: "paid", amount_total: 1900 }, // older than 30 days
      ],
      noAdmin,
      NOW,
    );
    expect(w).toEqual({ revenue30d: 29, revenue7d: 24, revenuePrev7d: 5, sales7d: 2, salesPrev7d: 1 });
  });

  test("recurring revenue, renewal rate and growth read plainly", () => {
    expect(monthlyRecurring([{ plan_tier: "starter", n: 2 }, { plan_tier: "professional", n: 1 }, { plan_tier: null, n: 3 }], { starter: 19, professional: 79 })).toBe(117);
    expect(renewalRate(0, 0).rate).toBeNull();
    expect(renewalRate(1, 3).rate).toBe(0.25);
    expect(weekGrowthLabel(1, 0)).toBe("new");
    expect(weekGrowthLabel(0, 0)).toBe("flat");
    expect(weekGrowthLabel(3, 2)).toBe("+50%");
    expect(weekGrowthLabel(1, 2)).toBe("-50%");
    expect(dollars(5)).toBe("$5");
    expect(dollars(12.5)).toBe("$12.50");
    expect(dollars(1234)).toBe("$1,234");
  });

  test("Mission Control shows the panel from the live-console API", () => {
    expect(readFileSync("src/routes/api/admin/live-console.ts", "utf8")).toContain("investor: await loadInvestorNumbers(now, money?.starterPass ?? null),");
    const live = readFileSync("src/routes/admin/live.tsx", "utf8");
    expect(live).toContain("<InvestorPanel n={data.investor} />");
    expect(live).toContain("Investor numbers");
  });
});
