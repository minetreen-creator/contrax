import { expect, test } from "bun:test";
import { mapCategory } from "./trade-classification";

// Owner 2026-11-06: "Vanguard Academy - Employee Benefits Insurance Programs" showed up as Security.
test("guard must be its own word to mean a guard service", () => {
  expect(mapCategory("", "Vanguard Academy - Employee Benefits Insurance Programs", "")).not.toBe("Security");
  expect(mapCategory("", "Safeguard Records Storage Services", "")).not.toBe("Security");
  expect(mapCategory("", "Unarmed Guard Services for City Hall", "")).toBe("Security");
  expect(mapCategory("", "Crossing Guard Services", "")).toBe("Security");
  expect(mapCategory("", "Replacement Hail Guards for Rooftop Units", "")).not.toBe("Security");
  expect(mapCategory("", "Security Patrol Services", "")).toBe("Security");
});
