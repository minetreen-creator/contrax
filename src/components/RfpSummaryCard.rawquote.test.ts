import { describe, expect, test } from "bun:test";
import { isRawFieldQuote } from "./RfpSummaryCard";

describe("milestone quotes", () => {
  test("a stored field dump is hidden; real solicitation text stays", () => {
    expect(isRawFieldQuote('due_date: Fri Aug 14 2026 11:59:59 GMT+0000 (Coordinated Universal Time)')).toBe(true);
    expect(isRawFieldQuote("Proposals are due August 14, 2026 at 2:00 PM")).toBe(false);
  });
});
