import { expect, test } from "bun:test";
import { existsSync, readFileSync } from "node:fs";
import { INDEXNOW_ENDPOINT, INDEXNOW_KEY, INDEXNOW_MAX_URLS, indexNowBodies, indexNowDeps, submitIndexNow } from "./indexnow";

// Owner 2026-11-07: tell Bing about new bid pages after each sync.
test("the key file Bing checks is published with exactly the key", () => {
  expect(INDEXNOW_KEY).toMatch(/^[a-f0-9]{32}$/);
  const file = new URL(`../../public/${INDEXNOW_KEY}.txt`, import.meta.url);
  expect(existsSync(file)).toBe(true);
  expect(readFileSync(file, "utf8")).toBe(INDEXNOW_KEY);
});

test("bodies: our own https pages only, de-duplicated, split at the protocol limit", () => {
  const urls = ["https://www.contrax.company/bid/1", "https://www.contrax.company/bid/1", "https://evil.example/bid/2", "http://www.contrax.company/bid/3", "not a url"];
  const [b] = indexNowBodies(urls);
  expect(b).toEqual({ host: "www.contrax.company", key: INDEXNOW_KEY, keyLocation: `https://www.contrax.company/${INDEXNOW_KEY}.txt`, urlList: ["https://www.contrax.company/bid/1"] });
  const many = Array.from({ length: INDEXNOW_MAX_URLS + 5 }, (_, i) => `https://www.contrax.company/bid/${i}`);
  expect(indexNowBodies(many).map((x) => x.urlList.length)).toEqual([INDEXNOW_MAX_URLS, 5]);
  expect(indexNowBodies([])).toEqual([]);
});

test("submit: 200/202 count as accepted, errors are reported, never thrown", async () => {
  const saved = { ...indexNowDeps };
  const calls: { url: string; body: string }[] = [];
  try {
    indexNowDeps.fetch = async (url, init) => { calls.push({ url, body: String(init.body) }); return new Response(null, { status: 202 }); };
    expect(await submitIndexNow(["https://www.contrax.company/bid/7"])).toEqual({ sent: 1, accepted: 1, errors: [] });
    expect(calls[0].url).toBe(INDEXNOW_ENDPOINT);
    expect(JSON.parse(calls[0].body).urlList).toEqual(["https://www.contrax.company/bid/7"]);
    indexNowDeps.fetch = async () => new Response("bad key", { status: 403 });
    expect(await submitIndexNow(["https://www.contrax.company/bid/7"])).toEqual({ sent: 1, accepted: 0, errors: ["HTTP 403"] });
    indexNowDeps.fetch = async () => { throw new Error("offline"); };
    expect((await submitIndexNow(["https://www.contrax.company/bid/7"])).errors).toEqual(["offline"]);
  } finally { Object.assign(indexNowDeps, saved); }
});

// 2026-11-11 (search traffic work): after the bid, state and trade pages changed, Bing should be told.
import { INDEXNOW_SITEMAPS, sitemapLocs } from "./indexnow";
import { readFileSync as readFile } from "node:fs";

test("a sitemap's page addresses are read out, with &amp; turned back into &", () => {
  const xml = `<?xml version="1.0"?><urlset><url><loc>https://www.contrax.company/bid/1</loc><lastmod>2026-11-11</lastmod></url>
    <url><loc> https://www.contrax.company/radar?trade=hvac&amp;state=GA </loc></url></urlset>`;
  expect(sitemapLocs(xml)).toEqual(["https://www.contrax.company/bid/1", "https://www.contrax.company/radar?trade=hvac&state=GA"]);
  expect(sitemapLocs("")).toEqual([]);
});

test("the weekly resubmission leaves the bid pages out; the manual one can include them", () => {
  expect(INDEXNOW_SITEMAPS.pages).not.toContain("/sitemap-bids.xml");
  expect(INDEXNOW_SITEMAPS.all).toContain("/sitemap-bids.xml");
  const wf = readFile(".github/workflows/indexnow-resubmit.yml", "utf8");
  expect(wf).toContain('if [[ "$SCOPE" == "all" ]]; then bun run src/jobs/indexnow-submit.ts --all;');
  expect(wf).toContain('else bun run src/jobs/indexnow-submit.ts --pages; fi');
  expect(wf).not.toContain("DATABASE_URL"); // it reads the public sitemaps only
  const job = readFile("src/jobs/indexnow-submit.ts", "utf8");
  expect(job).toContain('if (process.argv.includes("--all")) return resubmit("all");');
});

test("the companies scope reads the company sitemap index and each state's sitemap", async () => {
    const { INDEXNOW_SITEMAPS, isSitemapIndex } = await import("./indexnow");
    const { readFileSync } = await import("node:fs");
    expect(INDEXNOW_SITEMAPS.companies).toEqual(["/sitemap-companies.xml"]);
    expect(isSitemapIndex('<?xml version="1.0"?><sitemapindex xmlns="x"><sitemap><loc>a</loc></sitemap></sitemapindex>')).toBe(true);
    expect(isSitemapIndex('<?xml version="1.0"?><urlset xmlns="x"><url><loc>a</loc></url></urlset>')).toBe(false);
    const job = readFileSync(new URL("../jobs/indexnow-submit.ts", import.meta.url), "utf8");
    expect(job).toContain('if (process.argv.includes("--companies")) return resubmit("companies");');
    expect(job).toContain("isSitemapIndex(xml)");
    const wf = readFileSync(new URL("../../.github/workflows/indexnow-resubmit.yml", import.meta.url), "utf8");
    expect(wf).toContain("--companies");
    expect(readFileSync(new URL("../../scripts/generate-sitemap.mjs", import.meta.url), "utf8")).toContain('["/company", "weekly", "0.7"]');
  });
