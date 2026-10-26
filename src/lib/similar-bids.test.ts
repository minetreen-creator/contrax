import { describe, expect, test } from "bun:test";
import { similarNaicsPrefixes, similarRadarHref } from "./similar-bids";

describe("similar bids", () => {
  test("tries the exact NAICS, then its industry group", () => {
    expect(similarNaicsPrefixes("561720")).toEqual(["561720", "5617"]);
    expect(similarNaicsPrefixes(" 238220 ")).toEqual(["238220", "2382"]);
  });
  test("no usable code means no similar search", () => {
    expect(similarNaicsPrefixes(null)).toEqual([]);
    expect(similarNaicsPrefixes("5617")).toEqual([]);
    expect(similarNaicsPrefixes("abc123")).toEqual([]);
    expect(similarRadarHref(null, "VA")).toBe(null);
  });
  test("Radar link carries the code and state", () => {
    expect(similarRadarHref("561720", "VA")).toBe("/radar?trade=561720&state=VA");
    expect(similarRadarHref("561720", null)).toBe("/radar?trade=561720");
  });
});
