import { expect, test } from "bun:test";
import { existsSync, readFileSync } from "node:fs";

// Owner 2026-11-26: Google Search Console reported "Page with redirect". /grants and /state-grants
// were retired on 2026-11-18 and send visitors to the homepage, but stayed in the sitemap.
test("no page in the sitemap is a route that only redirects", () => {
  const paths = [...readFileSync("public/sitemap.xml", "utf8").matchAll(/<loc>https:\/\/www\.contrax\.company\/([^<]*)<\/loc>/g)].map((m) => m[1]);
  expect(paths.length).toBeGreaterThan(50);
  const redirecting: string[] = [];
  for (const p of paths) {
    const base = p.replace(/\/$/, "");
    if (!base) continue;
    const file = [`src/routes/${base.replace(/\//g, ".")}.tsx`, `src/routes/${base}.tsx`, `src/routes/${base}/index.tsx`].find((f) => existsSync(f));
    if (!file) continue; // a page made from a pattern (a state, a trade), not a single file
    if (/beforeLoad:\s*\(\)\s*=>\s*\{\s*throw redirect/.test(readFileSync(file, "utf8"))) redirecting.push(`/${base}`);
  }
  expect(redirecting).toEqual([]);
});
