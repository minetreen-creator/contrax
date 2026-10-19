import { describe, expect, test } from "bun:test";
import { gunzipSync } from "node:zlib";
import { readFileSync } from "node:fs";
import {
  countyFor,
  filtersFor,
  parseAction,
  summarize,
  windowFor,
  type Snapshot,
} from "./model";
import { fetchSnapshot, reconciliationToleranceCents } from "./source.server";
function fixture(fips: string) {
  return JSON.parse(
    gunzipSync(
      readFileSync(new URL(`./fixtures/${fips}.json.gz`, import.meta.url)),
    ).toString(),
  );
}
describe("County identity and accounting", () => {
  test("Census independent cities never collapse into similarly named counties", () => {
    expect(countyFor("51570")?.name).toBe("Colonial Heights city");
    expect(countyFor("51730")?.name).toBe("Petersburg city");
    expect(countyFor("51760")?.name).toBe("Richmond city");
    expect(countyFor("51159")?.name).toBe("Richmond County");
    expect(countyFor("Richmond")).toBeNull();
    expect(
      filtersFor(countyFor("51760")!, "2025-10-17", "2026-10-16")
        .place_of_performance_locations,
    ).toEqual([{ country: "USA", state: "VA", county: "760" }]);
  });
  test("rolling window uses complete days and handles leap years", () => {
    expect(windowFor("2026-10-17")).toEqual({
      start: "2025-10-17",
      end: "2026-10-16",
    });
    expect(windowFor("2024-02-29")).toEqual({
      start: "2023-02-28",
      end: "2024-02-28",
    });
  });
  for (const fips of ["51570", "51760", "51730"]) {
    test(`live captured ${fips}: all amendments including negatives reconcile exactly to category spending`, () => {
      const f = fixture(fips);
      const snapshot: Snapshot = {
        county: countyFor(fips)!,
        start: "2025-10-17",
        end: "2026-10-16",
        fetchedAt: "2026-10-17T19:30:00Z",
        categoryCents: f.summary.categoryCents,
        actions: f.rows.map((r: any) =>
          parseAction(r, "2025-10-17", "2026-10-16"),
        ),
      };
      const s = summarize(snapshot);
      expect(s.totalCents).toBe(f.summary.categoryCents);
      expect(s.actionCount).toBe(f.summary.actions);
      expect(s.recipientCount).toBe(f.summary.recipientUEIs);
      expect(s.negativeActions).toBe(f.summary.negativeActions);
      expect(s.awards[0].cents).toBe(f.summary.largest[0][1]);
      expect(s.awards[0].id).toBe(f.summary.largest[0][0]);
    });
  }
  test("UEIs, not names, identify recipients; repeated award ids are amendments, not duplicates", () => {
    const actions = [
      {
        award: "CONT_AWD_a",
        awardId: "a",
        recipient: "A Co",
        uei: "ONE",
        naics: "561720",
        industry: "Cleaning",
        cents: 10000,
      },
      {
        award: "CONT_AWD_a",
        awardId: "a",
        recipient: "A COMPANY",
        uei: "ONE",
        naics: "561720",
        industry: "Cleaning",
        cents: -2000,
      },
      {
        award: "CONT_AWD_b",
        awardId: "b",
        recipient: "A Co",
        uei: "TWO",
        naics: "238220",
        industry: "HVAC",
        cents: 5000,
      },
      {
        award: "CONT_AWD_c",
        awardId: "c",
        recipient: "Unknown",
        uei: null,
        naics: "561720",
        industry: "Cleaning",
        cents: 300,
      },
    ];
    const snapshot = {
      county: countyFor("51570")!,
      start: "2025-10-17",
      end: "2026-10-16",
      fetchedAt: "2026-10-17",
      categoryCents: 13300,
      actions,
    };
    const s = summarize(snapshot);
    expect(s.totalCents).toBe(13300);
    expect(s.recipientCount).toBe(2);
    expect(s.awards[0].cents).toBe(8000);
    expect(s.missingUeiActions).toBe(1);
    expect(summarize(snapshot, "561720").totalCents).toBe(8300);
  });
  test("missing amounts and IDV parent identities fail instead of becoming fake zeros", () => {
    const row = fixture("51570").rows[0];
    expect(() =>
      parseAction(
        { ...row, "Transaction Amount": null },
        "2025-10-17",
        "2026-10-16",
      ),
    ).toThrow();
    expect(() =>
      parseAction(
        { ...row, generated_internal_id: "CONT_IDV_parent" },
        "2025-10-17",
        "2026-10-16",
      ),
    ).toThrow();
  });
});
describe("Complete fetching and reconciliation", () => {
  test("fetches every page before producing totals, with explicit transaction-level category spending", async () => {
    const f = fixture("51570");
    const row = f.rows[0];
    const requests: any[] = [];
    const fetcher = async (path: string, body: any) => {
      requests.push({ path, body });
      if (path.includes("spending_by_transaction"))
        return {
          results:
            body.page === 1 ? [row] : [{ ...row, "Transaction Amount": -100 }],
          page_metadata: { hasNext: body.page === 1 },
        };
      return {
        results: [{ amount: row["Transaction Amount"] - 100 }],
        page_metadata: { hasNext: false },
      };
    };
    const s = await fetchSnapshot(
      countyFor("51570")!,
      "2025-10-17",
      "2026-10-16",
      undefined,
      fetcher,
    );
    expect(s.actions.length).toBe(2);
    expect(requests.length).toBe(3);
    expect(requests[2].body.spending_level).toBe("transactions");
    expect(requests[0].body.filters.award_type_codes).toEqual([
      "A",
      "B",
      "C",
      "D",
    ]);
  });
  test("mismatched category totals are never published", async () => {
    const row = fixture("51570").rows[0];
    const fetcher = async (path: string) =>
      path.includes("spending_by_transaction")
        ? { results: [row], page_metadata: { hasNext: false } }
        : { results: [{ amount: 0 }], page_metadata: { hasNext: false } };
    await expect(
      fetchSnapshot(
        countyFor("51570")!,
        "2025-10-17",
        "2026-10-16",
        undefined,
        fetcher,
      ),
    ).rejects.toThrow("Reconciliation failed");
  });
  test("a category-rounding gap of a cent still publishes; a real gap does not", async () => {
    const row = fixture("51570").rows[0];
    const run = (categoryAmount: number) =>
      fetchSnapshot(
        countyFor("51570")!,
        "2025-10-17",
        "2026-10-16",
        undefined,
        async (path: string) =>
          path.includes("spending_by_transaction")
            ? { results: [row], page_metadata: { hasNext: false } }
            : { results: [{ amount: categoryAmount }], page_metadata: { hasNext: false } },
      );
    const amount = row["Transaction Amount"] as number;
    await expect(run(amount - 0.01)).resolves.toBeDefined();
    await expect(run(amount - 1)).rejects.toThrow("Reconciliation failed");
    expect(reconciliationToleranceCents(1)).toBe(1);
    expect(reconciliationToleranceCents(40)).toBe(20);
  });
  test("truncated and missing pagination cannot masquerade as complete data", async () => {
    await expect(
      fetchSnapshot(
        countyFor("51570")!,
        "2025-10-17",
        "2026-10-16",
        undefined,
        async () => ({ results: [], page_metadata: { hasNext: true } }),
      ),
    ).rejects.toThrow("Empty incomplete");
    await expect(
      fetchSnapshot(
        countyFor("51570")!,
        "2025-10-17",
        "2026-10-16",
        undefined,
        async () => ({ results: [] }),
      ),
    ).rejects.toThrow("Invalid transaction pagination");
  });
});
