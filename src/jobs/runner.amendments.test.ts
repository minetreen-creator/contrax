/**
 * The sync records bid amendments (bid-amendments.ts) through its real batch
 * upsert path: a fake `sql` answers the stored-version read, the upsert's
 * RETURNING and the bid_amendments INSERT. Zero network, no database.
 */
import { describe, expect, test } from "bun:test";
import { syncSource } from "./runner";
import type { RawBid } from "./sources/sam-gov";

function fakeSql(stored: Record<string, unknown>[], returning: Record<string, unknown>[]) {
  const amendments: unknown[][] = [];
  const statements: string[] = [];
  const sql = ((strings: TemplateStringsArray) => {
    statements.push(strings.join("?"));
    return Promise.resolve([]);
  }) as any;
  sql.query = async (text: string, params: unknown[] = []) => {
    statements.push(text);
    if (/^SELECT source, external_id, title/.test(text.trim())) return stored;
    if (/^INSERT INTO bids/.test(text.trim())) return returning;
    if (/INSERT INTO bid_amendments/.test(text)) {
      for (let i = 0; i < params.length; i += 4) amendments.push(params.slice(i, i + 4));
      return [];
    }
    return [];
  };
  return { sql, amendments, statements };
}

const bid = (over: Partial<RawBid> = {}): RawBid => ({
  external_id: "x-1",
  title: "Janitorial Services at City Hall",
  agency: "City of Example",
  description: "Nightly custodial services.",
  location: "Example, TX",
  category: "Janitorial",
  due_date: "2026-11-17T21:00:00.000Z",
  estimated_value: "",
  source_url: "https://example.gov/bids/1",
  set_aside: null,
  ...over,
});

describe("sync → bid amendment history", () => {
  test("a rewritten existing bid whose deadline moved gets a deadline amendment", async () => {
    const { sql, amendments } = fakeSql(
      [{ source: "test_src", external_id: "x-1", title: "Janitorial Services at City Hall", description: "Nightly custodial services.", due_date: new Date("2026-11-10T21:00:00Z"), estimated_value: "" }],
      [{ id: 42, external_id: "x-1", inserted: false }],
    );
    await syncSource(sql, { name: "test_src", fetchFn: async () => [bid()] });
    expect(amendments).toEqual([["42", "deadline", "2026-11-10T21:00:00.000Z", "2026-11-17T21:00:00.000Z"]]);
  });

  test("a brand-new bid, or one the upsert did not rewrite, records nothing", async () => {
    const fresh = fakeSql([], [{ id: 43, external_id: "x-1", inserted: true }]);
    await syncSource(fresh.sql, { name: "test_src", fetchFn: async () => [bid()] });
    expect(fresh.amendments).toEqual([]);
    expect(fresh.statements.some((s) => s.includes("bid_amendments"))).toBe(false);

    const noop = fakeSql(
      [{ source: "test_src", external_id: "x-1", title: "Old", description: "", due_date: new Date("2026-11-10T21:00:00Z"), estimated_value: "" }],
      [], // compute-saver skipped the rewrite: no RETURNING row
    );
    await syncSource(noop.sql, { name: "test_src", fetchFn: async () => [bid()] });
    expect(noop.amendments).toEqual([]);
  });

  test("a failing amendment write never fails the sync", async () => {
    const { sql } = fakeSql(
      [{ source: "test_src", external_id: "x-1", title: "Old title", description: "", due_date: null, estimated_value: "" }],
      [{ id: 44, external_id: "x-1", inserted: false }],
    );
    const original = sql.query;
    sql.query = async (text: string, params: unknown[]) => {
      if (/bid_amendments/.test(text)) throw new Error("boom");
      return original(text, params);
    };
    const result = await syncSource(sql, { name: "test_src", fetchFn: async () => [bid()] });
    expect(result.errors).toEqual([]);
  });
});
