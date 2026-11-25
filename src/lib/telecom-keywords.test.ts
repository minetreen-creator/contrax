import { expect, test } from "bun:test";
import { inferNaics } from "./naics-infer";

// Owner 2026-11-25: a Florida telecommunications search found 8 jobs and missed these two school jobs.
test("network cabling and internet service jobs read as telecommunications", () => {
  expect(String(inferNaics("E-Rate Category Two Network Cabling Equipment and Installation Services"))).toMatch(/^517/);
  expect(String(inferNaics("Internet Services E-Rate"))).toMatch(/^517/);
  expect(String(inferNaics("Structured Cabling for New Elementary School"))).toMatch(/^517/);
});
