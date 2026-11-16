import { expect, test } from "bun:test";
import { extractLocation, isVagueLocation, mapSamItem, placeLocation } from "./sam-gov";
import { JANITORIAL_TRADE_FILTERS, tradePageLimit } from "./sam-gov-trades";

// Owner 2026-11-16: "we need more janitorial sources nationwide". 22 of 29 open federal janitorial
// notices were stored as "United States", so no state search showed them.
test("a notice's place of performance becomes its location", () => {
  expect(placeLocation({ city: { name: "Sioux Falls" }, state: { code: "SD" } })).toBe("Sioux Falls, SD");
  expect(placeLocation({ state: { code: "va" } })).toBe("VA");
  expect(placeLocation({ state: { code: "ZZ" } })).toBeNull();
  expect(placeLocation({ city: { name: "Ramstein" } })).toBeNull();
  expect(placeLocation(null)).toBeNull();
});

test("an office suffix in parentheses is not read as a state", () => {
  expect(extractLocation([{ name: "W6QM MICC-FORT BUCHANAN (RC)" }], "")).toBe("United States");
  expect(extractLocation([{ name: "W071 ENDIST SEATTLE (WA)" }], "")).toBe("WA");
  expect(isVagueLocation("United States")).toBe(true);
  expect(isVagueLocation("Quantico, VA")).toBe(false);
});

const item = { _id: "abc123", title: "S201--Janitorial Services", organizationHierarchy: [{ name: "W6QM MICC-FORT BUCHANAN (RC)" }], descriptions: [{ content: "Custodial services for the reserve center." }], responseDate: "2026-12-10T17:00:00Z" };
const detail = { setAside: "Total Small Business Set-Aside (FAR 19.5)", naicsCode: "561720", psc: "S201", noticeType: "Solicitation", solicitationNumber: "W6QM-26-Q-0001" };

test("a federal notice with no state in its text takes the place of performance from its detail", async () => {
  const bid = await mapSamItem(item, { sourceLabel: "sam_naics_561720", filterNaics: "561720", detailDelay: false, detailFetcher: async () => ({ ...detail, placeOfPerformance: { city: { name: "Fort Buchanan" }, state: { code: "PR" } } }) });
  expect(bid.location).toBe("Fort Buchanan, PR");
});

test("the detail is asked for the place even when every code is already known", async () => {
  let calls = 0;
  const known = { ...item, typeOfSetAsideDescription: "Total Small Business Set-Aside (FAR 19.5)" };
  const bid = await mapSamItem(known, { sourceLabel: "sam_naics_561720", filterNaics: "561720", filterPsc: "S201", detailDelay: false, detailFetcher: async () => { calls += 1; return { ...detail, placeOfPerformance: { state: { code: "TX" } } }; } });
  expect(calls).toBe(1);
  expect(bid.location).toBe("TX");
});

test("a notice whose detail names no state stays nationwide, and a stated city is never overwritten", async () => {
  const none = await mapSamItem(item, { sourceLabel: "sam_naics_561720", filterNaics: "561720", detailDelay: false, detailFetcher: async () => ({ ...detail, placeOfPerformance: null }) });
  expect(none.location).toBe("United States");
  const stated = await mapSamItem({ ...item, descriptions: [{ content: "Janitorial services at the clinic in Marion, IN for one base year." }] }, { sourceLabel: "sam_naics_561720", filterNaics: "561720", detailDelay: false, detailFetcher: async () => ({ ...detail, placeOfPerformance: { state: { code: "OH" } } }) });
  expect(stated.location).toBe("Marion, IN");
});

test("the janitorial passes read every active notice SAM reports, not the newest 100", () => {
  for (const f of JANITORIAL_TRADE_FILTERS) expect(tradePageLimit(f)).toBe(12);
});
