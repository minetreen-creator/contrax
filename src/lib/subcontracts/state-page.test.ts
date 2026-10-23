import { describe, expect, test } from "bun:test";
import type { AwardLead } from "~/lib/award-leads";
import { moneyText, pickWinners, stateFromSlug, titleCase, WINNER_MIN_AMOUNT } from "./state-page";

const lead = (over: Partial<AwardLead>): AwardLead => ({
  award_key: "k",
  award_id: "a",
  recipient_name: "ACME LLC",
  recipient_uei: null,
  recipient_city: "LAS VEGAS",
  recipient_state: "NV",
  amount: 1_000_000,
  awarded_on: "2026-10-01",
  agency: "Department of the Air Force",
  sub_agency: null,
  description: null,
  pop_state: "NV",
  naics_code: "236220",
  naics_description: null,
  ...over,
});

describe("stateFromSlug", () => {
  test("names, multi-word names and codes", () => {
    expect(stateFromSlug("nevada")).toEqual({ code: "NV", name: "Nevada", slug: "nevada" });
    expect(stateFromSlug("new-york")?.code).toBe("NY");
    expect(stateFromSlug("NV")?.slug).toBe("nevada");
    expect(stateFromSlug("atlantis")).toBeNull();
  });
});

describe("pickWinners", () => {
  test("one row per company (its biggest award), biggest first, small awards dropped", () => {
    const out = pickWinners([
      lead({ recipient_name: "A", amount: 2_000_000 }),
      lead({ recipient_name: "A", amount: 5_000_000 }),
      lead({ recipient_name: "B", amount: 3_000_000 }),
      lead({ recipient_name: "C", amount: WINNER_MIN_AMOUNT - 1 }),
    ]);
    expect(out.map((r) => [r.recipient_name, r.amount])).toEqual([
      ["A", 5_000_000],
      ["B", 3_000_000],
    ]);
  });
  test("caps the list", () => {
    const many = Array.from({ length: 30 }, (_, i) => lead({ recipient_name: `Co ${i}`, amount: 300_000 + i }));
    expect(pickWinners(many, 10)).toHaveLength(10);
  });
});

describe("text", () => {
  test("money", () => {
    expect(moneyText(1_250_000)).toBe("$1.3M");
    expect(moneyText(2_000_000)).toBe("$2M");
    expect(moneyText(640_400)).toBe("$640K");
    expect(moneyText(3_100_000_000)).toBe("$3.1B");
  });
  test("company names", () => {
    expect(titleCase("ACME BUILDERS LLC")).toBe("Acme Builders LLC");
  });
});
