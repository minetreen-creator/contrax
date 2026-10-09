import { describe, expect, test } from "bun:test";
import type { FPDSIntel } from "./fpds";
import {
  deriveWinnerPrice,
  fiscalYearOf,
  formatWinnerPriceAmount,
  winnerPriceLine,
  winnerPriceViewState,
} from "./winner-price";

const intel = (o: Partial<FPDSIntel> = {}): FPDSIntel => ({
  incumbent_name: "ACME JANITORIAL LLC",
  incumbent_uei: "ABC123",
  total_obligated: 1_234_567,
  pop_start_date: "2024-01-01",
  pop_end_date: "2025-12-31",
  historical_pricing: [{ fiscal_year: 2024, total_obligated: 1_234_567, award_count: 1 }],
  ...o,
});

describe("winner-price — fiscal year (federal Oct–Sep rule, same as fpds.ts)", () => {
  test("October belongs to the next fiscal year", () => {
    expect(fiscalYearOf("2023-10-01")).toBe(2024);
    expect(fiscalYearOf("2023-09-30")).toBe(2023);
    expect(fiscalYearOf("2024-12-15")).toBe(2025);
    expect(fiscalYearOf("2025-01-02")).toBe(2025);
  });
  test("an absent or unparseable date yields no year — never a guessed one", () => {
    expect(fiscalYearOf(null)).toBeNull();
    expect(fiscalYearOf(undefined)).toBeNull();
    expect(fiscalYearOf("")).toBeNull();
    expect(fiscalYearOf("not a date")).toBeNull();
    expect(fiscalYearOf("2024-13-01")).toBeNull();
  });
});

describe("winner-price — amount formatting", () => {
  test("dollars are shown in full, not abbreviated", () => {
    expect(formatWinnerPriceAmount(1_234_567)).toBe("$1,234,567");
    expect(formatWinnerPriceAmount(84_200.4)).toBe("$84,200");
  });
  test("a zero or missing amount is not a price", () => {
    expect(formatWinnerPriceAmount(0)).toBeNull();
    expect(formatWinnerPriceAmount(-5)).toBeNull();
    expect(formatWinnerPriceAmount(null)).toBeNull();
    expect(formatWinnerPriceAmount(Number.NaN)).toBeNull();
  });
});

describe("winner-price — derivation (never invents a name or an amount)", () => {
  test("no intel and no stored award → no line", () => {
    expect(deriveWinnerPrice(null)).toBeNull();
    expect(deriveWinnerPrice(undefined)).toBeNull();
  });

  test("a named incumbent with no published amount and no usable year data → no line", () => {
    expect(
      deriveWinnerPrice(intel({ total_obligated: 0, historical_pricing: [] })),
    ).toBeNull();
  });

  test("a nameless incumbent → no line (never a placeholder winner)", () => {
    expect(deriveWinnerPrice(intel({ incumbent_name: "   " }))).toBeNull();
  });

  test("a stored SAM.gov Award Notice is preferred: exact published winner + amount + date", () => {
    const w = deriveWinnerPrice(intel(), {
      awardeeName: "Summit Building Services",
      amount: 482_000,
      awardDate: "2025-11-04",
    });
    expect(w).not.toBeNull();
    expect(w!.winner).toBe("Summit Building Services");
    expect(w!.amount).toBe(482_000);
    expect(w!.fiscalYear).toBe(2026); // Nov 2025 → FY2026
    expect(w!.basis).toBe("award");
    expect(w!.source).toBe("sam");
    expect(winnerPriceLine(w!)).toBe("Won by Summit Building Services for $482,000 (FY2026)");
  });

  test("a stored award without a published amount falls through to the FPDS intel", () => {
    const w = deriveWinnerPrice(intel(), { awardeeName: "No Amount Co", amount: null, awardDate: null });
    expect(w!.source).toBe("fpds");
    expect(w!.winner).toBe("ACME JANITORIAL LLC");
    expect(w!.amount).toBe(1_234_567);
    expect(w!.fiscalYear).toBe(2024);
    expect(w!.basis).toBe("award");
  });

  test("the incumbent's own obligated award is the price, with the fiscal year of its POP start", () => {
    const w = deriveWinnerPrice(intel({ pop_start_date: "2023-10-15" }));
    expect(winnerPriceLine(w!)).toBe("Won by ACME JANITORIAL LLC for $1,234,567 (FY2024)");
  });

  test("no single usable award amount → the most recent published fiscal-year bucket, stated as a total", () => {
    const w = deriveWinnerPrice(
      intel({
        total_obligated: 0,
        pop_start_date: null,
        historical_pricing: [
          { fiscal_year: 2022, total_obligated: 300_000, award_count: 2 },
          { fiscal_year: 2025, total_obligated: 900_000, award_count: 3 },
          { fiscal_year: 2023, total_obligated: 0, award_count: 1 },
        ],
      }),
    );
    expect(w!.basis).toBe("fiscal_year_total");
    expect(w!.fiscalYear).toBe(2025);
    expect(w!.awardCount).toBe(3);
    expect(winnerPriceLine(w!)).toBe("Won by ACME JANITORIAL LLC — $900,000 across 3 awards in FY2025");
  });

  test("a bucket sum is never worded like a single winning price", () => {
    const w = deriveWinnerPrice(
      intel({ total_obligated: null, historical_pricing: [{ fiscal_year: 2024, total_obligated: 500_000, award_count: 2 }] }),
    );
    const line = winnerPriceLine(w!);
    expect(line).toContain("across 2 awards");
    expect(line).not.toContain("for $500,000");
  });

  test("an unknown award count still says it is a total, not a price", () => {
    const w = deriveWinnerPrice(
      intel({ total_obligated: 0, historical_pricing: [{ fiscal_year: 2024, total_obligated: 500_000, award_count: 0 }] }),
    );
    expect(w!.awardCount).toBeNull();
    expect(winnerPriceLine(w!)).toContain("across its awards");
  });

  test("every published amount zero → no line at all (no fabricated figure)", () => {
    expect(
      deriveWinnerPrice(
        intel({
          total_obligated: 0,
          historical_pricing: [
            { fiscal_year: 2024, total_obligated: 0, award_count: 1 },
            { fiscal_year: 2025, total_obligated: 0, award_count: 4 },
          ],
        }),
      ),
    ).toBeNull();
  });

  test("a line with no published date still renders, without a guessed year", () => {
    const w = deriveWinnerPrice(intel({ pop_start_date: null }));
    expect(w!.fiscalYear).toBeNull();
    expect(winnerPriceLine(w!)).toBe("Won by ACME JANITORIAL LLC for $1,234,567");
  });
});

describe("winner-price — the Starter-and-up allowance (one rule, no second copy)", () => {
  test("no data → nothing renders, whatever the tier", () => {
    expect(winnerPriceViewState({ hasData: false, paidAccess: true })).toBe("none");
    expect(winnerPriceViewState({ hasData: false, paidAccess: false })).toBe("none");
  });

  test("paid access (Starter-and-up, resolved by hasPaidBidAccess) → the full line", () => {
    expect(winnerPriceViewState({ hasData: true, paidAccess: true })).toBe("full");
  });

  test("Basic / free / logged-out → the Starter teaser", () => {
    expect(winnerPriceViewState({ hasData: true, paidAccess: false })).toBe("teaser");
    expect(winnerPriceViewState({ hasData: true, paidAccess: false, revealed: false })).toBe("teaser");
  });

  test("an existing free reveal on the same card renders the line in full (never a manufactured wall)", () => {
    expect(winnerPriceViewState({ hasData: true, paidAccess: false, revealed: true })).toBe("full");
  });
});
