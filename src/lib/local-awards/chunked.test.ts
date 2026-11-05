import { describe, expect, test } from "bun:test";
import { splitWindow, countyFor } from "./model";
import { CHUNK_PARTS, fetchSnapshotInChunks } from "./source.server";

// Owner 2026-11-05: Fulton County, GA failed three hourly runs in a row because
// its year of actions took longer to page through than USAspending keeps
// connections open → "Yes" to fetching big counties a quarter at a time.

const action = (day: string, amount: number, mod: string) => ({
  "Award ID": `A-${day}`,
  "Recipient Name": "Acme",
  "Recipient UEI": "ABC123",
  "Transaction Amount": amount,
  "Action Date": day,
  Mod: mod,
  NAICS: { code: "236220", description: "Commercial building" },
  generated_internal_id: `CONT_AWD_${day}`,
});

/** A fake USAspending that answers per requested window (one action on its first day). */
function fakeApi(failFirst: Set<string> = new Set()) {
  const calls: string[] = [];
  const fetcher = async (path: string, body: any) => {
    const w = body.filters.time_period[0];
    calls.push(`${path.includes("transaction") ? "t" : "c"}:${w.start_date}`);
    if (failFirst.has(w.start_date)) {
      failFirst.delete(w.start_date);
      throw new Error("The socket connection was closed unexpectedly.");
    }
    if (path.includes("spending_by_transaction"))
      return { results: [action(w.start_date, 100, "0")], page_metadata: { hasNext: false } };
    return { results: [{ amount: 100 }], page_metadata: { hasNext: false } };
  };
  return { fetcher, calls };
}

describe("big counties fetch a quarter at a time", () => {
  test("a year splits into back-to-back quarters that share no day", () => {
    const w = splitWindow("2025-11-05", "2026-11-04", 4);
    expect(w).toHaveLength(4);
    expect(w[0].start).toBe("2025-11-05");
    expect(w[3].end).toBe("2026-11-04");
    for (let i = 1; i < w.length; i++) {
      const prevEnd = Date.parse(`${w[i - 1].end}T00:00:00Z`);
      expect(Date.parse(`${w[i].start}T00:00:00Z`) - prevEnd).toBe(86_400_000);
    }
    expect(splitWindow("2026-01-01", "2026-01-02", 4)).toHaveLength(2);
    expect(() => splitWindow("2026-02-01", "2026-01-01", 4)).toThrow();
  });

  test("the quarters add up to one year's snapshot", async () => {
    const { fetcher } = fakeApi();
    const s = await fetchSnapshotInChunks(countyFor("51570")!, "2025-11-05", "2026-11-04", undefined, fetcher, async () => {});
    expect(s.start).toBe("2025-11-05");
    expect(s.end).toBe("2026-11-04");
    expect(s.actions).toHaveLength(CHUNK_PARTS);
    expect(s.categoryCents).toBe(CHUNK_PARTS * 10_000);
  });

  test("a dropped quarter is retried on its own, not the whole year", async () => {
    const w = splitWindow("2025-11-05", "2026-11-04", CHUNK_PARTS);
    // The third quarter drops once (after post()'s own retries would have given up).
    const { fetcher, calls } = fakeApi(new Set([w[2].start]));
    const pauses: number[] = [];
    const s = await fetchSnapshotInChunks(countyFor("51570")!, "2025-11-05", "2026-11-04", undefined, fetcher, async (ms) => { pauses.push(ms); });
    expect(s.actions).toHaveLength(CHUNK_PARTS);
    expect(calls.filter((c) => c === `t:${w[0].start}`)).toHaveLength(1);
    expect(calls.filter((c) => c === `t:${w[2].start}`)).toHaveLength(2);
    expect(pauses.length).toBe(CHUNK_PARTS - 1 + 1); // between quarters + one retry wait
  });

  test("a quarter that keeps failing fails the county; nothing partial is returned", async () => {
    const fetcher = async () => { throw new Error("The socket connection was closed unexpectedly."); };
    await expect(
      fetchSnapshotInChunks(countyFor("51570")!, "2025-11-05", "2026-11-04", undefined, fetcher as any, async () => {}),
    ).rejects.toThrow("socket");
  });
});
