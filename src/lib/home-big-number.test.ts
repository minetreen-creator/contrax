import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { bigNumber, dueShort, BIG_NUMBER_PRICE_NOTE, BIG_NUMBER_ROWS } from "./home-big-number";

test("the big number is the real count with commas, and nothing when the count is missing", () => {
  expect(bigNumber(12345)).toBe("12,345");
  expect(bigNumber(2940.7)).toBe("2,940");
  expect(bigNumber(0)).toBeNull();
  expect(bigNumber(42)).toBeNull();
  expect(bigNumber(undefined)).toBeNull();
  expect(bigNumber("abc")).toBeNull();
});

test("due dates read short, and a missing date prints nothing", () => {
  expect(dueShort("2026-12-09T21:00:00Z")).toBe("Due Dec 9");
  expect(dueShort(null)).toBe("");
  expect(dueShort("not a date")).toBe("");
});

test("the band sits above everything else on the homepage, with the page's one h1 and real rows", () => {
  const home = readFileSync(new URL("../routes/index.tsx", import.meta.url), "utf8");
  const band = home.indexOf("<HomeBigNumber ");
  expect(band).toBeGreaterThan(-1);
  expect(band).toBeLessThan(home.indexOf("<HomeSupplierHero "));
  expect(home.match(/<h1/g)?.length).toBe(1);
  expect(home).toContain('<h1 id="home-big-number-title"');
  // Rows come from the same real open bids as the rest of the page, never typed in.
  expect(home).toContain("sample.slice(0, BIG_NUMBER_ROWS)");
  expect(BIG_NUMBER_ROWS).toBe(3);
  expect(BIG_NUMBER_PRICE_NOTE).toBe("Starter is $9 a month, cancel anytime.");
});

test("the search sits directly under the band and before the supplier report, without repeating the count or the examples", () => {
  const home = readFileSync(new URL("../routes/index.tsx", import.meta.url), "utf8");
  const band = home.indexOf("<HomeBigNumber ");
  const search = home.indexOf('heading="h2" underBand />');
  expect(search).toBeGreaterThan(band);
  expect(search).toBeLessThan(home.indexOf("<HomeSupplierHero "));
  expect(home).not.toContain("Everything below is for you");
  const finder = readFileSync(new URL("../components/HomeContractFinder.tsx", import.meta.url), "utf8");
  expect(finder).toContain('className={underBand ? "sr-only" :');
  expect(finder).toContain("!busy && !underBand && sample.length > 0");
});
