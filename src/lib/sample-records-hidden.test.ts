import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { SAMPLE_EXCLUSION_SQL, SAMPLE_SOURCES } from "~/lib/source-class";

// Owner 2026-11-11 ("yes hide the demo records"): /bid/2417, a made-up sample bid, opened like a real
// listing, and the 2026-11-05 scraper read it.
test("made-up sample records have no bid page; legacy labels on real bids are untouched", () => {
  expect([...SAMPLE_SOURCES]).toEqual(["contrax-demo", "seed", "fixture_test"]);
  expect(SAMPLE_SOURCES).not.toContain("md_dc");
  expect(SAMPLE_EXCLUSION_SQL).toBe("LOWER(COALESCE(source, '')) NOT IN ('contrax-demo', 'seed', 'fixture_test')");
  const page = readFileSync("src/routes/bid.$bidId.tsx", "utf8");
  // Both loaders (the public one and the signed-in one) leave them out.
  expect(page.match(/WHERE id = \$\{id\} AND \$\{sql\(\)\.unsafe\(SAMPLE_EXCLUSION_SQL\)\}/g)).toHaveLength(2);
  expect(page).not.toMatch(/WHERE id = \$\{id\}\n\s+LIMIT 1/);
});
