import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";

// Owner 2026-11-07: the console read "MRR: $0 · Customers: 0" with two paid $5 passes.
test("admin finance counts active $5 Starter pass buyers as customers (no MRR)", () => {
  const api = readFileSync("src/routes/api/admin/finance.ts", "utf8");
  expect(api).toContain("WHERE starter_pass_ends_at > NOW()");
  expect(api).toContain("customerCount += passCustomers;");
  expect(api).toContain("passCustomers,");
  expect(api).not.toMatch(/mrrCents\s*\+=\s*.*pass/i);
  // The app-db fallback must not count a pass holder as a $19 subscriber too.
  expect(api.match(/starter_pass_ends_at IS NULL OR starter_pass_ends_at <= NOW\(\)/g)?.length).toBe(2);
  const chip = readFileSync("src/components/AdminShared.tsx", "utf8");
  expect(chip).toContain("on $5 pass");
  expect(chip).toContain('{fin.mrrCents > 0 ? " ↑" : ""}');
});
