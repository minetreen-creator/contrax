import { expect, mock, test } from "bun:test";

// Owner 2026-11-07: the sync's per-match notification inserts pushed a run past the job time limit.
const calls: { text: string; values: unknown[] }[] = [];
mock.module("~/db", () => ({
  sql: () => async (strings: TemplateStringsArray, ...values: unknown[]) => {
    const text = strings.join("?");
    calls.push({ text, values });
    if (text.includes("INSERT INTO notifications")) return (values[0] as number[]).map((_, i) => ({ id: i + 1 }));
    return [];
  },
}));
const { createNotificationsBatch } = await import("./notifications");

test("one insert per 500 rows, in-batch duplicates dropped, the 24-hour repeat guard is in the SQL", async () => {
  const row = (userId: number, bidId: number) => ({ userId, type: "new_bid_match" as const, title: "New bid matches your profile", message: "m", bidId });
  const rows = [...Array.from({ length: 1200 }, (_, i) => row(i, 7)), row(0, 7)];
  expect(await createNotificationsBatch(rows)).toBe(1200);
  const inserts = calls.filter((c) => c.text.includes("INSERT INTO notifications"));
  expect(inserts.map((c) => (c.values[0] as number[]).length)).toEqual([500, 500, 200]);
  expect(inserts[0].text).toContain("NOT EXISTS");
  expect(inserts[0].text).toContain("INTERVAL '24 hours'");
  expect(await createNotificationsBatch([])).toBe(0);
});
