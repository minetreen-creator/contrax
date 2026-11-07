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
