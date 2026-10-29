import { describe, expect, test } from "bun:test";
import { shortDollars } from "./ending-near-you";

describe("shortDollars", () => {
  test("reads like a headline", () => {
    expect(shortDollars(412_000)).toBe("$412K");
    expect(shortDollars(1_250_000)).toBe("$1.3M");
    expect(shortDollars(2_000_000)).toBe("$2M");
    expect(shortDollars(14_600_000)).toBe("$15M");
    expect(shortDollars(9_500)).toBe("$9,500");
  });
});
