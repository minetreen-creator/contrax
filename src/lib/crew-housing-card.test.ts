import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { showCrewHousingOnBid, showCrewHousingOnStatePage } from "./tampa";

const readSrc = (p: string) => readFileSync(new URL(`../../${p}`, import.meta.url), "utf8");

describe("Casa Blue Collar beyond the Tampa page (owner 2026-11-12)", () => {
  test("shown on Tampa Bay construction, trade and facility bids only", () => {
    expect(showCrewHousingOnBid("Tampa, FL", "City of Tampa", "Roof Replacement at Fire Station 5")).toBe(true);
    expect(showCrewHousingOnBid("MacDill AFB, FL", null, "HVAC chiller repair")).toBe(true);
    expect(showCrewHousingOnBid("Tampa, FL", "City of Tampa", "Office supplies")).toBe(false);
    expect(showCrewHousingOnBid("Miami, FL", "Miami-Dade County", "Roof Replacement")).toBe(false);
    expect(showCrewHousingOnBid("Brandon, MS", null, "Roof Replacement")).toBe(false);
    expect(showCrewHousingOnBid(null, null, null)).toBe(false);
  });

  test("shown on the Florida pages for construction, HVAC and electrical, and nowhere else", () => {
    expect(showCrewHousingOnStatePage("FL", "construction")).toBe(true);
    expect(showCrewHousingOnStatePage("FL", "hvac")).toBe(true);
    expect(showCrewHousingOnStatePage("FL", "electrical")).toBe(true);
    expect(showCrewHousingOnStatePage("FL", "janitorial")).toBe(false);
    expect(showCrewHousingOnStatePage("GA", "construction")).toBe(false);
    expect(showCrewHousingOnStatePage(null, null)).toBe(false);
  });

  test("the card uses Casa's own published details and says whose figures they are", () => {
    const card = readSrc("src/components/CrewHousingCard.tsx");
    expect(card).toContain("Housing referral partner · Tampa Bay");
    expect(card).toContain("{CASA_PRICE_NOTE}");
    expect(card).toContain("is an independent company and Contrax's housing referral partner");
    expect(card).toContain('rel="sponsored noopener"');
    // No figure is typed into the card itself: they all come from src/lib/tampa.ts.
    expect(card).not.toMatch(/\b\d{2,}\+|\b3x\b|\$\d/);
  });

  test("clicks count in the partner's click report, labeled by where they happened", () => {
    const card = readSrc("src/components/CrewHousingCard.tsx");
    expect(card).toContain('trackEvent("tampa_housing_referral_click", `${where}_site`)');
    expect(card).toContain('trackEvent("tampa_housing_referral_click", `${where}_phone`)');
    expect(readSrc("src/lib/markets.ts")).toContain('clickEvent: "tampa_housing_referral_click"');
  });

  test("it is wired into the bid page and the state trade page", () => {
    expect(readSrc("src/routes/bid.$bidId.tsx")).toContain("showCrewHousingOnBid(bid.location, bid.agency, bid.title) && <CrewHousingCard");
    expect(readSrc("src/routes/contracts-in.$state_.$trade.tsx")).toContain("showCrewHousingOnStatePage(data.code, data.trade?.slug) && (");
  });
});
