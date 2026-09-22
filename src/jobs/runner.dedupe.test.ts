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
import { readFileSync } from "node:fs";
import { batchInsertNaturalKey, dedupeBatchByNaturalKey, isNaturalKeyViolation } from "./runner";
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

// ---------------------------------------------------------------------------
// Migration 048 — the natural key as a DB-layer UNIQUE index (owner 2026-09-22,
// run-level dedupe hardening for the concurrent Phase-2 sources).
//
// The index itself is rehearsed against a scratch PostgreSQL 18.6
// (shared/dedupe-run-level-harden-2026-09-22/). These are the DB-free pins:
// what the key is, why the DB layer is REQUIRED (the in-memory pass cannot see a
// sibling source), what the SQL file must contain, and how the runner classifies
// a 23505 that names the index.
// ---------------------------------------------------------------------------
describe("isNaturalKeyViolation — a 23505 on the 048 index is a DEDUPE, not a failure", () => {
  test("recognizes the natural-key index violation", () => {
    expect(
      isNaturalKeyViolation(
        new Error('duplicate key value violates unique constraint "idx_bids_natural_key_unique"'),
      ),
    ).toBe(true);
  });
  test("recognizes the real driver text (SQLSTATE + constraint name, as the scratch rehearsal produced)", () => {
    // PostgreSQL 18.6: ERROR 23505 duplicate key value violates unique constraint
    // "idx_bids_natural_key_unique" — the Neon HTTP driver surfaces it as an
    // Error whose message carries the constraint name.
    expect(
      isNaturalKeyViolation(
        new Error(
          'PostgresError: duplicate key value violates unique constraint "idx_bids_natural_key_unique"',
        ),
      ),
    ).toBe(true);
  });
  test("every OTHER failure still counts as failed (only the natural-key race is downgraded)", () => {
    // The (source, external_id) arbiter — handled by ON CONFLICT, must never be
    // swallowed as a dedupe.
    expect(
      isNaturalKeyViolation(
        new Error('duplicate key value violates unique constraint "bids_source_external_id_key"'),
      ),
    ).toBe(false);
    // Generic failures: a malformed row, a dropped connection, a timeout…
    expect(isNaturalKeyViolation(new Error("boom"))).toBe(false);
    expect(isNaturalKeyViolation(new Error("connection terminated"))).toBe(false);
    expect(isNaturalKeyViolation(new Error('relation "bids" does not exist'))).toBe(false);
    // A message that mentions the index name but is NOT a unique violation.
    expect(
      isNaturalKeyViolation(new Error('relation "idx_bids_natural_key_unique" does not exist')),
    ).toBe(false);
    // Non-Error throws and empty values.
    expect(isNaturalKeyViolation("boom")).toBe(false);
    expect(isNaturalKeyViolation(null)).toBe(false);
    expect(isNaturalKeyViolation(undefined)).toBe(false);
    expect(isNaturalKeyViolation("")).toBe(false);
  });
});

describe("the DB layer is required — the same notice from two sources (separate chunks, separate passes, concurrent runs)", () => {
  /** The shape a state-keyword collector emits: notice_type/psc are never set. */
  function stateKeywordRow(over: Partial<RawBid>): RawBid {
    return bid({
      notice_type: null,
      psc: null,
      due_date: null,
      solicitation_number: null,
      ...over,
    });
  }
  test("(e) the key has no `source` dimension: nc-abc and nj-abc are ONE key", () => {
    const nc = stateKeywordRow({ external_id: "nc-abc", source_label: "nc" });
    const nj = stateKeywordRow({ external_id: "nj-abc", source_label: "nj" });
    expect(batchInsertNaturalKey(nc)).toBe(batchInsertNaturalKey(nj));
  });
  test("(e2) each source's own batch KEEPS its row — the in-memory pass cannot see the sibling source", () => {
    // This is the executable statement of scope for migration 048: neither the
    // (source, external_id) arbiter (different prefixes) nor the per-source
    // in-memory pass can separate these two. ONLY the DB index can, which is why
    // the index + the 23505 classification ship together.
    const nc = stateKeywordRow({ external_id: "nc-abc", source_label: "nc" });
    const nj = stateKeywordRow({ external_id: "nj-abc", source_label: "nj" });
    expect(dedupeBatchByNaturalKey([nc]).length).toBe(1);
    expect(dedupeBatchByNaturalKey([nj]).length).toBe(1);
    // …and a Phase-2 batch of 5 keeps both, because they are in different
    // sources' batches (or, when one source fetches the same notice twice, in
    // different chunks of the same source — (e3)).
    expect(dedupeBatchByNaturalKey([nc, nj])[0].external_id).toBe("nc-abc");
  });
  test("(e3) two SEPARATE chunks / passes of the same source are deduped independently", () => {
    // dedupeBatchByNaturalKey is per-call: chunk 2's copy of a notice chunk 1
    // stored is NOT collapsed by it. In the serial Phase-1 path the table-level
    // WHERE NOT EXISTS catches that; between two CONCURRENT sources it cannot
    // (each statement's snapshot predates the other's commit) — the DB index is
    // the atomic closer for both.
    const chunkOne = [stateKeywordRow({ external_id: "oh-1" })];
    const chunkTwo = [stateKeywordRow({ external_id: "oh-2" })];
    expect(dedupeBatchByNaturalKey(chunkOne).length).toBe(1);
    expect(dedupeBatchByNaturalKey(chunkTwo).length).toBe(1);
    expect(dedupeBatchByNaturalKey([...chunkOne, ...chunkTwo]).length).toBe(1);
  });
  test("(e4) a NULL notice_type/psc/due_date is ONE key value, never a wildcard", () => {
    // The COALESCE(text,'') + NULLS NOT DISTINCT combination in the SQL index
    // mirrors this: two NULL-psc rows with the same title/agency are the SAME
    // key in TS and in SQL. Without either half, the two layers would disagree
    // and a pair could slip both.
    const a = stateKeywordRow({ external_id: "dc-1" });
    const b = stateKeywordRow({ external_id: "dc-2" });
    expect(batchInsertNaturalKey(a)).toBe(batchInsertNaturalKey(b));
    // An empty-string value and a NULL are the SAME dimension value too (the
    // in-memory key maps NULL -> "", and the index COALESCEs to '').
    expect(batchInsertNaturalKey(stateKeywordRow({ external_id: "dc-3", psc: "" }))).toBe(
      batchInsertNaturalKey(a),
    );
  });
});

describe("anti-collapse — the real near-miss pairs still survive the 5-dim key (5-dim census: neither is a duplicate group)", () => {
  test("(f) 139010/139012 shape: same title+agency+solicitation, Award Notice vs Justification", () => {
    const award = bid({
      external_id: "sam-d809babd6e85466daf5355fe880d3c81",
      title: "W--WA-LEAVENWORTH NFH-FISH TRANSPORTATION",
      agency: "FWS, SAT TEAM 1",
      notice_type: "Award Notice",
      due_date: null,
      psc: null,
      solicitation_number: "140FS126P0240",
    });
    const justification = bid({
      external_id: "sam-c14083bdd319407491d63352df7a8f8a",
      title: "W--WA-LEAVENWORTH NFH-FISH TRANSPORTATION",
      agency: "FWS, SAT TEAM 1",
      notice_type: "Justification",
      due_date: null,
      psc: null,
      solicitation_number: "140FS126P0240",
    });
    expect(batchInsertNaturalKey(award)).not.toBe(batchInsertNaturalKey(justification));
    expect(dedupeBatchByNaturalKey([award, justification]).length).toBe(2);
  });
  test("(f2) 138961/138971 shape: same title+agency+solicitation, Combined Synopsis/Solicitation vs Sources Sought, different due_date", () => {
    const combined = bid({
      external_id: "sam-ad93118784c44410b6077c6431b0744e",
      title: "JDMTA Custodial Services",
      agency: "FA2521 45 CONS LGC",
      notice_type: "Combined Synopsis/Solicitation",
      due_date: "2026-09-24T17:00:00.000Z",
      solicitation_number: "FA252126QB143",
    });
    const sourcesSought = bid({
      external_id: "sam-18232c0be28c45e8904d15f2ffa14773",
      title: "JDMTA Custodial Services",
      agency: "FA2521 45 CONS LGC",
      notice_type: "Sources Sought",
      due_date: "2026-09-18T20:00:00.000Z",
      solicitation_number: "FA252126QB143",
    });
    expect(batchInsertNaturalKey(combined)).not.toBe(batchInsertNaturalKey(sourcesSought));
    expect(dedupeBatchByNaturalKey([combined, sourcesSought]).length).toBe(2);
  });
});

describe("migration 048 — the SQL file is the contract (SQL and TS cannot drift)", () => {
  const sqlText = readFileSync(
    new URL("../../db/migrations/048_bids_natural_key_unique.sql", import.meta.url),
    "utf8",
  );
  const schemaText = readFileSync(new URL("../../src/db/schema.sql", import.meta.url), "utf8");
  test("index name, all five dimensions, NULLS NOT DISTINCT and the frozen grandfather predicate", () => {
    expect(sqlText).toContain("CREATE UNIQUE INDEX IF NOT EXISTS idx_bids_natural_key_unique");
    expect(sqlText).toContain("lower(btrim(title))");
    expect(sqlText).toContain("lower(btrim(agency))");
    expect(sqlText).toContain("COALESCE(notice_type, '')");
    expect(sqlText).toContain("due_date");
    expect(sqlText).toContain("COALESCE(psc, '')");
    // Required: due_date is the one dimension that can still be NULL.
    expect(sqlText).toContain("NULLS NOT DISTINCT");
    // The grandfather predicate — a FROZEN cutoff (design §7 item 4): never
    // edited by a later migration, because this statement is IF NOT EXISTS.
    expect(sqlText).toContain("WHERE created_at >= TIMESTAMPTZ '2026-09-22 00:00:00+00'");
    // One statement, splittable by the shared migration splitter (no `;` inside).
    expect(sqlText.split(";").filter((s) => s.trim().replace(/^--.*$/gm, "").trim()).length).toBe(1);
  });
  test("the index name in the SQL is exactly the one isNaturalKeyViolation matches on", () => {
    const match = /CREATE UNIQUE INDEX IF NOT EXISTS (\w+)/.exec(sqlText);
    expect(match?.[1]).toBe("idx_bids_natural_key_unique");
    expect(
      isNaturalKeyViolation(
        new Error(`duplicate key value violates unique constraint "${match?.[1]}"`),
      ),
    ).toBe(true);
  });
  test("src/db/schema.sql mirrors the same statement (a bootstrapped CI database carries the enforcement)", () => {
    const schemaStmt = schemaText
      .split("\n")
      .filter((line) => !line.trim().startsWith("--"))
      .join("\n");
    expect(schemaStmt).toContain("CREATE UNIQUE INDEX IF NOT EXISTS idx_bids_natural_key_unique");
    expect(schemaStmt).toContain("NULLS NOT DISTINCT");
    expect(schemaStmt).toContain("WHERE created_at >= TIMESTAMPTZ '2026-09-22 00:00:00+00'");
  });
});
