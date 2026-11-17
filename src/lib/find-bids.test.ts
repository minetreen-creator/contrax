import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { findBidsPattern } from "./find-bids";

test("words become one safe title pattern", () => {
  expect(findBidsPattern("excavation, trenching ,site prep")).toBe("(excavation|trenching|site[[:space:]]+prep)");
  expect(findBidsPattern("water/sewer; DROP TABLE")).toBe("(water\\/sewer drop table)".replace(" drop table", "[[:space:]]+drop[[:space:]]+table"));
  expect(findBidsPattern("a, , ok")).toBeNull();
  expect(findBidsPattern("")).toBeNull();
});

test("the job only reads, and is wired to a hand-run workflow", () => {
  const job = readFileSync("src/jobs/find-bids.ts", "utf8");
  expect(job).not.toMatch(/INSERT|UPDATE |DELETE |resend/i);
  expect(readFileSync(".github/workflows/find-bids.yml", "utf8")).toContain("bun run find-bids");
  expect(readFileSync("package.json", "utf8")).toContain('"find-bids": "bun run src/jobs/find-bids.ts"');
});
