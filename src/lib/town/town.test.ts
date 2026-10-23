import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { categoryEmoji, lookupZip, milesBetween, nearbyTowns, normalizeZip, shareText, townRegex, type ZipTable } from "./town";

const zips = JSON.parse(readFileSync("public/data/town-zips.json", "utf8")) as ZipTable;

describe("What's Your Town Buying? (owner 2026-10-23)", () => {
  test("ZIP input is normalized; ZIP+4 accepted, junk rejected", () => {
    expect(normalizeZip(" 23834 ")).toBe("23834");
    expect(normalizeZip("23834-1234")).toBe("23834");
    expect(normalizeZip("2383")).toBeNull();
    expect(normalizeZip("abcde")).toBeNull();
    expect(normalizeZip(null)).toBeNull();
  });

  test("a ZIP resolves to its town and state", () => {
    expect(lookupZip(zips, "23834")).toEqual({ zip: "23834", town: "Colonial Heights", state: "VA" });
    expect(lookupZip(zips, "00000")).toBeNull();
    expect(Object.keys(zips).length).toBeGreaterThan(40000);
  });

  test("nearby towns: own town first, then nearest, all within the radius", () => {
    const towns = nearbyTowns(zips, "23834");
    expect(towns[0]!.town).toBe("Colonial Heights");
    const names = towns.map((t) => t.town);
    expect(names).toContain("Petersburg");
    expect(names).toContain("Hopewell");
    expect(towns.every((t) => t.miles <= 25)).toBe(true);
    expect(names).not.toContain("Norfolk"); // ~80 miles away
  });

  test("distance math", () => {
    expect(milesBetween(37.27, -77.4, 37.27, -77.4)).toBe(0);
    expect(Math.round(milesBetween(37.54, -77.44, 36.85, -76.29))).toBeGreaterThan(70);
  });

  test("town regex matches whole town names only and skips generic words", () => {
    const re = townRegex([
      { town: "Colonial Heights", state: "VA", miles: 0 },
      { town: "Petersburg", state: "VA", miles: 3 },
      { town: "Center", state: "VA", miles: 5 },
      { town: "Ai", state: "VA", miles: 5 },
    ])!;
    expect(re).toBe("\\m(colonial heights|petersburg)\\M");
    const js = new RegExp(re.replace(/\\m/g, "\\b").replace(/\\M/g, "\\b"), "i");
    expect(js.test("City of Petersburg Purchasing")).toBe(true);
    expect(js.test("St. Petersburg College")).toBe(true); // whole-word; state filter keeps FL out
    expect(js.test("Petersburgh")).toBe(false);
    expect(townRegex([{ town: "Center", state: "TX", miles: 0 }])).toBeNull();
  });

  test("share text and emoji", () => {
    expect(shareText("Colonial Heights", "VA", 14)).toContain("is buying 14 things");
    expect(shareText("Colonial Heights", "VA", 1)).toContain("is buying 1 thing ");
    expect(categoryEmoji("Janitorial")).toBe("🧹");
    expect(categoryEmoji("Landscaping")).toBe("🌳");
    expect(categoryEmoji(null)).toBe("📋");
  });
});
