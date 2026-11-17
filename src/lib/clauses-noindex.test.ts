import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";

test("a single clause page is not offered to search engines; the index and part pages are", () => {
  const page = readFileSync("src/routes/clauses/$clauseNumber.tsx", "utf8");
  expect(page).toContain('export const CLAUSE_PAGE_ROBOTS = "noindex, follow";');
  expect(page).toContain('{ name: "robots", content: d.notFound ? "noindex, nofollow" : CLAUSE_PAGE_ROBOTS },');
  // The part page (a list of clauses) keeps its own indexable head.
  expect(page.split('content: d.notFound ? "noindex, nofollow" : "index, follow"').length - 1).toBe(1);
  expect(readFileSync("src/routes/clauses/index.tsx", "utf8")).toContain('{ name: "robots", content: "index, follow" }');
});
