/**
 * In-batch natural-key dedupe — regression pins (owner-authorized 2026-09-21).
 *
 * WHY THIS FILE EXISTS: the batch INSERT in src/jobs/runner.ts carries a
 * table-level `WHERE NOT EXISTS (title, agency)` guard, but that guard reads the
 * table as it was BEFORE the statement — so duplicate rows INSIDE one VALUES
 * list all pass it. Measured live on the first post-merge sync (run 35665413705):
 * 76 rows across the 11 SAM trade passes, only 69 distinct → 5 duplicate groups
 * / 7 excess rows (see shared/pr414-post-sync-verify/). The fix is
 * `dedupeBatchByNaturalKey` in src/jobs/runner.ts, applied per batch before the
 * VALUES list is built.
 *
 * ANTI-COLLAPSE PINS (the owner's hard requirement — "verify no legitimate
 * amendments, separate notices or same-title opportunities were collapsed"):
 * the key MUST include notice_type, due_date AND psc. The live case
 * 36C26126Q0795 has an "Award Notice" and an "Amendment 0001 …" Combined
 * Synopsis/Solicitation for the same solicitation/title/agency; both must
 * survive. On (title, agency) alone they would be collapsed — the test below is
 * therefore written with the SAME title on both rows, so it can only pass if
 * notice_type/due_date participate in the key.
 *
 * DETERMINISTIC, ZERO NETWORK, NO DATABASE: these tests exercise the exported
 * pure helper only; importing runner.ts is side-effect-free (its CLI entrypoint
 * is behind `import.meta.main`) and nothing here calls the Neon driver.
 */
import { describe, expect, test } from "bun:test";
import { batchInsertNaturalKey, dedupeBatchByNaturalKey } from "./runner";
import type { RawBid } from "./sources/sam-gov";

/** Minimal valid RawBid; override only the fields a case cares about. */
function bid(over: Partial<RawBid> = {}): RawBid {
  return {
    external_id: "sam-100000",
    title: "S201--HAMPTON VA EVS CLEANING CONTRACT Base Plus 4 | 1 Sept 26 - 31 Aug 31",
    agency: "VETERANS AFFAIRS, DEPARTMENT OF",
    description: "Janitorial services at the Hampton VA Medical Center.",
    location: "HAMPTON, VA",
    category: "services",
    due_date: "2026-09-30T00:00:00.000Z",
    estimated_value: "",
    source_url: "https://sam.gov/opp/abc",
    set_aside: null,
    psc: "S201",
    notice_type: "Award Notice",
    solicitation_number: "36C24626Q0647",
    source_label: "sam_naics_561720",
    ...over,
  };
}

describe("batchInsertNaturalKey", () => {
  test("key is the 5 owner-specified dimensions, \\u0001-joined", () => {
    expect(batchInsertNaturalKey(bid())).toBe(
      [
        "s201--hampton va evs cleaning contract base plus 4 | 1 sept 26 - 31 aug 31",
        "veterans affairs, department of",
        "Award Notice",
        "2026-09-30T00:00:00.000Z",
        "S201",
      ].join("\u0001"),
    );
  });

  test("title/agency are compared case- and padding-insensitively (lower(btrim))", () => {
    expect(
      batchInsertNaturalKey(
        bid({ title: "  JANITORIAL SERVICES  ", agency: "City of Dayton " }),
      ),
    ).toBe(
      batchInsertNaturalKey(
        bid({ title: "janitorial services", agency: "city of dayton" }),
      ),
    );
  });

  test("missing notice_type / due_date / psc normalize to the empty string (never 'null')", () => {
    expect(
      batchInsertNaturalKey(
        bid({ notice_type: null, due_date: null, psc: null }),
      ),
    ).toBe(
      batchInsertNaturalKey(
        bid({ notice_type: undefined, due_date: undefined, psc: undefined }),
      ),
    );
    expect(
      batchInsertNaturalKey(bid({ notice_type: null, due_date: null, psc: null })),
    ).toContain("\u0001\u0001");
  });
});

describe("dedupeBatchByNaturalKey — same-batch duplicates collapse", () => {
  test("(a) 3 byte-identical rows with different external_id collapse to exactly 1", () => {
    // The live HAMPTON VA EVS CLEANING shape: one award notice returned three
    // times by the same SAM pass, with three different SAM `_id` values.
    const rows = [
      bid({ external_id: "sam-24254497" }),
      bid({ external_id: "sam-24255001" }),
      bid({ external_id: "sam-24249888" }),
    ];
    const out = dedupeBatchByNaturalKey(rows);
    expect(out.length).toBe(1);
    // Canonical row = the LOWEST external_id, deterministically.
    expect(out[0].external_id).toBe("sam-24249888");
  });

  test("(a2) the retained row is deterministic regardless of fetch order", () => {
    const a = bid({ external_id: "sam-900" });
    const b = bid({ external_id: "sam-100" });
    const c = bid({ external_id: "sam-500" });
    for (const order of [
      [a, b, c],
      [c, a, b],
      [b, c, a],
      [a, c, b],
    ]) {
      const out = dedupeBatchByNaturalKey(order);
      expect(out.length).toBe(1);
      expect(out[0].external_id).toBe("sam-100");
    }
  });

  test("(a3) the helper is pure: input array and row objects are untouched", () => {
    const rows = [
      bid({ external_id: "sam-2" }),
      bid({ external_id: "sam-1" }),
      bid({ external_id: "sam-3" }),
    ];
    const snapshot = JSON.stringify(rows);
    const out = dedupeBatchByNaturalKey(rows);
    expect(out).not.toBe(rows); // a NEW array
    expect(rows.length).toBe(3);
    expect(JSON.stringify(rows)).toBe(snapshot);
    expect(out.length).toBe(1);
  });

  test("different sources/rows keep their own row when keys differ", () => {
    const rows = [
      bid({ external_id: "sam-1", psc: "S201" }),
      bid({ external_id: "sam-2", psc: "V112", notice_type: "Solicitation" }),
    ];
    expect(dedupeBatchByNaturalKey(rows).length).toBe(2);
  });
});

describe("dedupeBatchByNaturalKey — ANTI-COLLAPSE guarantees", () => {
  test("(b) LIVE CASE 36C26126Q0795: Award Notice + Amendment 0001 both survive", () => {
    // Same solicitation number, same title, same agency — the ONLY differences
    // are notice_type and due_date. On title+agency alone (the SQL guard's key)
    // these would be collapsed; the owner requires BOTH to survive.
    const award1 = bid({
      external_id: "sam-2401144",
      title: "R602--Medical Courier Services VASNHCS",
      agency: "VETERANS AFFAIRS, DEPARTMENT OF",
      psc: "R602",
      solicitation_number: "36C26126Q0795",
      notice_type: "Award Notice",
      due_date: "2026-05-01T00:00:00.000Z",
    });
    const award2 = bid({
      external_id: "sam-2401145",
      title: "R602--Medical Courier Services VASNHCS",
      agency: "VETERANS AFFAIRS, DEPARTMENT OF",
      psc: "R602",
      solicitation_number: "36C26126Q0795",
      notice_type: "Award Notice",
      due_date: "2026-05-01T00:00:00.000Z",
    });
    const amendment = bid({
      external_id: "sam-2401999",
      title: "R602--Medical Courier Services VASNHCS",
      agency: "VETERANS AFFAIRS, DEPARTMENT OF",
      psc: "R602",
      solicitation_number: "36C26126Q0795",
      notice_type: "Combined Synopsis/Solicitation",
      due_date: "2026-08-04T00:00:00.000Z",
    });

    const out = dedupeBatchByNaturalKey([award1, award2, amendment]);
    expect(out.length).toBe(2); // the two identical award notices collapse…
    const ids = out.map((r) => r.external_id).sort();
    // …but the amendment SURVIVES, with the canonical (lowest-id) award row.
    expect(ids).toEqual(["sam-2401144", "sam-2401999"]);
    const survivors = out.filter(
      (r) => r.notice_type === "Combined Synopsis/Solicitation",
    );
    expect(survivors.length).toBe(1);
    expect(survivors[0].due_date).toBe("2026-08-04T00:00:00.000Z");
  });

  test("(b2) an amendment whose title differs only by the 'Amendment 0001' prefix also survives", () => {
    const award = bid({
      external_id: "sam-1",
      notice_type: "Award Notice",
      solicitation_number: "36C26126Q0795",
    });
    const amendment = bid({
      external_id: "sam-2",
      title: "Amendment 0001 R602--Medical Courier Services VASNHCS",
      notice_type: "Combined Synopsis/Solicitation",
      due_date: "2026-08-04T00:00:00.000Z",
      solicitation_number: "36C26126Q0795",
    });
    expect(dedupeBatchByNaturalKey([award, amendment]).length).toBe(2);
  });

  test("(c) two SEPARATE notices under one title+agency (different solicitation_number) both survive", () => {
    // Deliberately NOT keyed on solicitation_number: the owner-specified key is
    // (title, agency, notice_type, due_date, psc), which is strictly FINER than
    // the table-level guard's (title, agency) — so no row this keeps is a row the
    // existing cross-source guard would have rejected.
    const first = bid({
      external_id: "sam-501",
      title: "Janitorial and Carpet Cleaning Services",
      agency: "INTERIOR, DEPARTMENT OF THE",
      solicitation_number: "140P1026Q0011",
      notice_type: "Solicitation",
      due_date: "2026-10-05T00:00:00.000Z",
      psc: "S201",
    });
    const second = bid({
      external_id: "sam-502",
      title: "Janitorial and Carpet Cleaning Services",
      agency: "INTERIOR, DEPARTMENT OF THE",
      solicitation_number: "140P1026Q0042",
      notice_type: "Combined Synopsis/Solicitation",
      due_date: "2026-11-20T00:00:00.000Z",
      psc: "S201",
    });
    const out = dedupeBatchByNaturalKey([first, second]);
    expect(out.length).toBe(2);
    expect(out.map((r) => r.solicitation_number).sort()).toEqual([
      "140P1026Q0011",
      "140P1026Q0042",
    ]);
  });

  test("(c2) a different notice_type alone is enough to keep a separate notice", () => {
    const a = bid({ external_id: "sam-1", notice_type: "Award Notice" });
    const b = bid({ external_id: "sam-2", notice_type: "Solicitation" });
    expect(dedupeBatchByNaturalKey([a, b]).length).toBe(2);
  });

  test("(c3) a different due_date alone is enough to keep a separate notice", () => {
    const a = bid({ external_id: "sam-1", due_date: "2026-10-05T00:00:00.000Z" });
    const b = bid({ external_id: "sam-2", due_date: "2026-11-20T00:00:00.000Z" });
    expect(dedupeBatchByNaturalKey([a, b]).length).toBe(2);
    // …and a null due_date is its own dimension value, never a wildcard.
    const c = bid({ external_id: "sam-3", due_date: null });
    expect(dedupeBatchByNaturalKey([a, c]).length).toBe(2);
  });

  test("(c4) a different psc alone is enough to keep a separate notice", () => {
    const a = bid({ external_id: "sam-1", psc: "S201" });
    const b = bid({ external_id: "sam-2", psc: "Z1DA" });
    expect(dedupeBatchByNaturalKey([a, b]).length).toBe(2);
  });
});

describe("dedupeBatchByNaturalKey — per-batch, not global", () => {
  test("(d) two batches are deduped INDEPENDENTLY (no cross-batch collapse)", () => {
    // The helper is called per chunk inside one source. A row that repeats in a
    // LATER chunk is not this call's business: the table-level WHERE NOT EXISTS
    // already handles that case, because each chunk is its own statement.
    const batchOne = [bid({ external_id: "sam-1" }), bid({ external_id: "sam-2" })];
    const batchTwo = [
      bid({ external_id: "sam-3" }),
      bid({ external_id: "sam-4" }),
      bid({ external_id: "sam-4-dup-key" }),
    ];
    const outOne = dedupeBatchByNaturalKey(batchOne);
    const outTwo = dedupeBatchByNaturalKey(batchTwo);
    expect(outOne.length).toBe(1);
    expect(outOne[0].external_id).toBe("sam-1");
    expect(outTwo.length).toBe(1);
    expect(outTwo[0].external_id).toBe("sam-3");

    // Applying it to the CONCATENATED batches would (correctly, for that input)
    // collapse across them — which is exactly why it is applied per batch.
    expect(dedupeBatchByNaturalKey([...batchOne, ...batchTwo]).length).toBe(1);
  });

  test("(d2) identical rows in DIFFERENT sources are not each other's problem (key has no source)", () => {
    // Same batch ⇒ same source by construction. The key therefore omits `source`,
    // mirroring the cross-source SQL guard. Two same-key rows fetched by two
    // different sources are deduped by that guard, not by this helper.
    const row = bid({ external_id: "sam-1" });
    const other = bid({ external_id: "oh-1", source_label: "oh" });
    const out = dedupeBatchByNaturalKey([row, other]);
    expect(out.length).toBe(1);
    // `source` is not a key dimension, so these two still share one key; the
    // survivor is simply the LOWEST external_id ("oh-1" < "sam-1"). In the real
    // runner this cannot drop provenance, because a batch is one source's rows.
    expect(out[0].external_id).toBe("oh-1");
  });
});
