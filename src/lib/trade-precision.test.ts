import { expect, test } from "bun:test";
import { verifyTradePrecision } from "./trade-registry";

// The registry's precision self-check only ran by hand (`bun src/lib/trade-registry.ts`), so a
// stale assertion threw unnoticed from 2026-10-16 to 2026-11-16 and skipped every check after it.
// Running it here means the test suite fails the day it breaks.
test("the trade registry's precision self-check passes", () => {
  expect(() => verifyTradePrecision()).not.toThrow();
});
