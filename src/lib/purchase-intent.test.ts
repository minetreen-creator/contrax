import { describe, expect, test } from "bun:test";
import { paidPlanReturn } from "./purchase-intent";
import { resolveGoogleCallbackDestination, resolvePostSignupDestination } from "./funnel-ux";
const safe = (v: unknown): string | null => typeof v === "string" && v.startsWith("/") && !v.startsWith("//") ? v : null;
describe("paid plan handoff", () => {
  test("email signup returns each paid selection before onboarding", () => {
    for (const plan of ["starter", "professional", "agency"]) {
      const href = `/upgrade?plan=${plan}`;
      expect(resolvePostSignupDestination({ next: href }, {}, safe)).toEqual({ kind: "purchase", href });
      expect(resolveGoogleCallbackDestination({ isNewUser: true, saveBid: null, next: href }, safe)).toBe(href);
      expect(resolveGoogleCallbackDestination({ isNewUser: false, saveBid: null, next: href }, safe)).toBe(href);
    }
  });
  test("rejects external, unknown and malformed destinations", () => {
    for (const href of [null, "https://evil.test/upgrade?plan=starter", "//evil.test/upgrade?plan=starter", "/upgrade?plan=basic", "/upgrade?plan=unknown", "/upgrade", "/upgrades?plan=starter"]) expect(paidPlanReturn(href)).toBeNull();
    expect(paidPlanReturn("/upgrade?plan=starter&next=https://evil.test")).toBe("/upgrade?plan=starter");
  });
  test("free and saved-bid journeys keep their destinations", () => {
    expect(resolvePostSignupDestination({}, {}, safe).kind).toBe("radar");
    expect(resolvePostSignupDestination({ saveBid: "12", next: "/bid/12" }, {}, safe)).toEqual({ kind: "save_then_next", href: "/bid/12" });
    expect(resolveGoogleCallbackDestination({ isNewUser: true, saveBid: null, next: null }, safe)).toBe("/radar?first_run=1");
  });
});
