import { describe, expect, test } from "bun:test";
import { mergeScanRows, runKeywordScanQuery, stateHintPatterns } from "./radar-scan-query";

describe("Radar state pass (owner 2026-10-03: only 5 NC janitorial matches)", () => {
  test("hint patterns: full name LIKE + standalone code regex", () => {
    const h = stateHintPatterns("nc")!;
    expect(h.name).toBe("%north carolina%");
    expect(h.token).toBe("(^|[[:space:],/()])NC($|[[:space:],.)/])");
    expect(stateHintPatterns("")).toBeNull();
    expect(stateHintPatterns(null)).toBeNull();
    expect(stateHintPatterns("ZZ")).toBeNull();
  });

  test("the code regex matches the same standalone tokens resolveStateFromText reads", () => {
    // POSIX [[:space:]] ≈ JS \s for this check.
    const re = new RegExp(stateHintPatterns("NC")!.token.replaceAll("[:space:]", "\\s"), "i");
    expect(re.test("Camp Lejeune, NC 28542")).toBe(true);
    expect(re.test("Jacksonville, nc")).toBe(true);
    expect(re.test("NC")).toBe(true);
    expect(re.test("Lincoln, NE")).toBe(false);
    expect(re.test("Fence services inc")).toBe(false);
  });

  test("merge de-duplicates by id and keeps due-date order", () => {
    const a = [{ id: 1, due_date: "2026-10-20" }, { id: 2, due_date: "2026-10-05" }];
    const b = [{ id: 2, due_date: "2026-10-05" }, { id: 3, due_date: "2026-10-10" }, { id: 4, due_date: null }];
    expect(mergeScanRows(a, b).map((r) => r.id)).toEqual([2, 3, 1, 4]);
  });

  test("runs one query without a state, two with a state, and merges", async () => {
    let calls = 0;
    const fake: any = (strings: TemplateStringsArray) => {
      calls++;
      const text = strings.join("?");
      return Promise.resolve(
        text.includes("LIKE")
          ? [{ id: 9, due_date: "2026-10-04" }, { id: 1, due_date: "2026-10-30" }]
          : [{ id: 1, due_date: "2026-10-30" }],
      );
    };
    fake.unsafe = (x: string) => x;
    expect((await runKeywordScanQuery(fake, { certFrag: "", tradeFrag: "" }, "TRUE")).map((r) => r.id)).toEqual([1]);
    expect(calls).toBe(1);
    calls = 0;
    expect((await runKeywordScanQuery(fake, { certFrag: "", tradeFrag: "" }, "TRUE", "NC")).map((r) => r.id)).toEqual([9, 1]);
    expect(calls).toBe(2);
  });
});
