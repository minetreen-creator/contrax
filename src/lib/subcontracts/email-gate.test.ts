import { describe, expect, test } from "bun:test";
import { gateSplit } from "./email-gate";

describe("gateSplit", () => {
  test("locked: the first few, and how many are behind the gate", () => {
    expect(gateSplit([1, 2, 3, 4, 5], 3, false)).toEqual({ shown: [1, 2, 3], locked: 2 });
  });
  test("unlocked, or nothing to lock: everything", () => {
    expect(gateSplit([1, 2, 3, 4, 5], 3, true)).toEqual({ shown: [1, 2, 3, 4, 5], locked: 0 });
    expect(gateSplit([1, 2], 3, false)).toEqual({ shown: [1, 2], locked: 0 });
  });
});
