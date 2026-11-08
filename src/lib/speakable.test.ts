import { describe, expect, test } from "bun:test";
import { speakable } from "./speakable";

// Owner 2026-11-08: "the mission control voice … doesn't pronounce state names".
describe("speakable", () => {
  test("spells out a state code after a comma or a place word", () => {
    expect(speakable("New visitor from Hampton, VA, on the Radar.")).toBe("New visitor from Hampton, Virginia, on the Radar.");
    expect(speakable("Someone in Tampa, FL is looking at pricing right now.")).toBe("Someone in Tampa, Florida is looking at pricing right now.");
    expect(speakable("New signup from Columbus, OH!")).toBe("New signup from Columbus, Ohio!");
    expect(speakable("Sale! Starter pass from Winchester, VA.")).toBe("Sale! Starter pass from Winchester, Virginia.");
    expect(speakable("12 searches in TX today")).toBe("12 searches in Texas today");
    expect(speakable("A visitor from DC")).toBe("A visitor from District of Columbia");
    expect(speakable("New search from Tulsa, OK: roofing.")).toBe("New search from Tulsa, Oklahoma: roofing.");
    expect(speakable("New visitor from St. Louis, MO")).toBe("New visitor from St. Louis, Missouri");
  });
  test("leaves everything else alone", () => {
    expect(speakable("VA hospital roof bid")).toBe("VA hospital roof bid");
    expect(speakable("Your user ID, OK?")).toBe("Your user ID, OK?");
    expect(speakable("Is that in OK?")).toBe("Is that in OK?");
    expect(speakable("Revenue is up, ZZ")).toBe("Revenue is up, ZZ");
    expect(speakable("Hello, sir.")).toBe("Hello, sir.");
  });
});
