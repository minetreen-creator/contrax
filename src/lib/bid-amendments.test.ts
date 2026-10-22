import { describe, expect, test } from "bun:test";
import { AMENDMENT_VALUE_MAX, detectAmendments, dropBulkDescriptionChanges } from "./bid-amendments";

const stored = {
  title: "Janitorial Services at City Hall",
  description: "Nightly custodial services for City Hall.",
  due_date: new Date("2026-11-10T21:00:00Z"),
  estimated_value: "$120,000",
};

describe("bid amendment detection (owner 2026-10-22)", () => {
  test("an unchanged re-read records nothing (whitespace and date type don't count)", () => {
    expect(
      detectAmendments(stored, {
        title: "  Janitorial Services   at City Hall ",
        description: stored.description,
        due_date: "2026-11-10T21:00:00.000Z",
        estimated_value: "$120,000",
      }),
    ).toEqual([]);
  });

  test("a moved deadline, retitle, new text and new value are each recorded", () => {
    const found = detectAmendments(stored, {
      title: "Janitorial Services at City Hall (REBID)",
      description: "Nightly custodial services for City Hall and the annex.",
      due_date: "2026-11-17T21:00:00.000Z",
      estimated_value: "$150,000",
    });
    expect(found.map((a) => a.change_type)).toEqual(["deadline", "title", "description", "value"]);
    expect(found[0]).toEqual({
      change_type: "deadline",
      old_value: "2026-11-10T21:00:00.000Z",
      new_value: "2026-11-17T21:00:00.000Z",
    });
    expect(found[3]).toEqual({ change_type: "value", old_value: "$120,000", new_value: "$150,000" });
  });

  test("a first fill or a missing incoming value is not an amendment", () => {
    expect(
      detectAmendments(
        { title: "T", description: "", due_date: null, estimated_value: null },
        { title: "T", description: "Now has text", due_date: "2026-11-10T21:00:00.000Z", estimated_value: "$5" },
      ),
    ).toEqual([]);
    expect(
      detectAmendments(stored, { title: stored.title, description: "", due_date: null, estimated_value: "" }),
    ).toEqual([]);
  });

  test("a deadline nudged by seconds is not a change; long text is clipped", () => {
    expect(
      detectAmendments(stored, { ...stored, due_date: "2026-11-10T21:00:30.000Z" } as never),
    ).toEqual([]);
    const long = "x".repeat(AMENDMENT_VALUE_MAX + 50);
    const [a] = detectAmendments(stored, { ...stored, due_date: null, description: long } as never);
    expect(a!.new_value.length).toBe(AMENDMENT_VALUE_MAX);
    expect(a!.new_value.endsWith("…")).toBe(true);
  });

  test("a chunk-wide description change is treated as a source reformat", () => {
    const desc = { change_type: "description" as const };
    const due = { change_type: "deadline" as const };
    const wave = [[desc], [desc], [desc, due], [desc]];
    const { kept, dropped } = dropBulkDescriptionChanges(wave, 5);
    expect(dropped).toBe(4);
    expect(kept.flat()).toEqual([due]);
    // A few real edits among many rows are kept.
    expect(dropBulkDescriptionChanges([[desc]], 10).kept).toEqual([[desc]]);
    // Tiny chunks are never judged as a wave.
    expect(dropBulkDescriptionChanges([[desc], [desc]], 3).dropped).toBe(0);
  });
});
