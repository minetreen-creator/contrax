import { expect, test } from "bun:test";
import { BRAND_MESSAGE, BRAND_STEPS } from "./brand-message";

// Owner 2026-11-10: "I would build the entire marketing strategy around one message".
test("one message, three steps that spell it out and point at real pages", () => {
  expect(BRAND_MESSAGE).toBe("Find the opportunity. Build the team. Get the work.");
  expect(BRAND_STEPS.map((s) => s.title).join(" ")).toBe(BRAND_MESSAGE);
  expect(BRAND_STEPS.map((s) => s.href)).toEqual(["/radar", "/sub-finder", "/pathway"]);
});
