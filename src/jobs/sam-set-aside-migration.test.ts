/**
 * The 065 / 066 set-aside migration RULES, pinned as invariants (no database, no
 * network).
 *
 * WHY: 065 and 066 are DATA migrations that rewrite `bids.set_aside` (and, in 066,
 * close one duplicate row) on production. They are hand-run, so nothing else stops
 * a careless future edit from widening their blast radius (a blanket relabel with
 * no exception list would delete 73 REAL 8(a)/8AN opportunities from an 8(a)
 * firm's Radar — the opposite error to the one 065 fixes). These assertions read
 * the shipped .sql files themselves and hold them to the shape the evidence
 * justifies:
 *
 *   * 065: exactly two statements, both `UPDATE bids`, no DDL/INSERT/DELETE;
 *   * 065: statement 1 keeps a named exception list of 100 ids, disjoint from
 *     statement 2's 15, each an exact `sam-<32 hex>` external_id;
 *   * 065: statement 1 is guarded by `set_aside = '8(a)'` AND a frozen created_at
 *     cut-off (the two devices that make a re-run a no-op);
 *   * 065: statement 1 writes the ONE label both SAM ingests agree on, taken from
 *     TOTAL_SMALL_BUSINESS_LABEL — not a hand-typed copy of it;
 *   * 065: statement 2 nulls the NONE rows rather than inventing a label for them;
 *   * 065's own run-065.ts verify() LIST RULE (added 2026-10-19, the first suite
 *     below): the overlap between statement 1's exception list and statement 2's
 *     NONE list is the DESIGN, not a defect — the check that asserted the two lists
 *     were disjoint failed on every correct run (see src/lib/set-aside-migration.ts);
 *   * 066: exactly three statements, both relabels writing the string the 4-hourly
 *     sync's own normalizeSetAside returns for that notice's SAM code, and the
 *     third closing the stale md_dc duplicate by id WITHOUT relabelling it.
 */
import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { normalizeSetAside, TOTAL_SMALL_BUSINESS_LABEL } from "~/jobs/sources/sam-gov";
import {
  SET_ASIDE_EVIDENCE_GROUPS,
  SET_ASIDE_EXCEPTION_COUNT,
  SET_ASIDE_KEPT_EIGHT_A_COUNT,
  SET_ASIDE_NONE_COUNT,
  SET_ASIDE_RELABEL_ROWS,
  checkSetAsideListShape,
  setAsideListOverlap,
} from "~/lib/set-aside-migration";

/**
 * The SAME split rule db/migrations/sql-statements.ts applies when the runner
 * executes the file (whole-line `--` comments dropped, split on `;`), written out
 * here so this test needs no import from outside `src/` and cannot be fooled by a
 * comment containing SQL.
 */
function splitStatements(sqlText: string): string[] {
  return sqlText
    .split("\n")
    .filter((line) => !line.trim().startsWith("--"))
    .join("\n")
    .split(";")
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}

/** Every `sam-<32 hex>` external_id literal in a statement, in file order. */
function idsIn(statement: string): string[] {
  return [...statement.matchAll(/'(sam-[0-9a-f]{32})'/g)].map((m) => m[1]!);
}

const FILE = new URL("../../db/migrations/065_bids_set_aside_relabel.sql", import.meta.url);
const SQL = readFileSync(FILE, "utf8");
const statements = splitStatements(SQL);

describe("migration 065 — relabel the SBA mislabels, keep the real 8(a) rows", () => {
  test("is exactly two UPDATE-bids statements", () => {
    expect(statements).toHaveLength(2);
    for (const s of statements) {
      expect(s.trimStart().startsWith("UPDATE bids")).toBe(true);
      // No DDL, no insert, no delete: this migration only rewrites one column.
      expect(/\b(delete|insert|truncate|drop|alter|create)\b/i.test(s)).toBe(false);
      // The column it writes is set_aside, and nothing else.
      expect(s).toMatch(/SET set_aside = /);
      expect(s.match(/SET /g)).toHaveLength(1);
    }
  });

  test("statement 1 relabels to the label BOTH SAM ingests agree on", () => {
    const [first] = statements;
    expect(first).toContain(`SET set_aside = '${TOTAL_SMALL_BUSINESS_LABEL}'`);
    expect(TOTAL_SMALL_BUSINESS_LABEL).toBe("Small Business Set Aside - Total");
    // ...and never to "8(a)" — the whole point of the migration.
    expect(first).not.toContain("SET set_aside = '8(a)'");
  });

  test("statement 1 is guarded so a re-run moves nothing", () => {
    const [first] = statements;
    expect(first).toMatch(/WHERE set_aside = '8\(a\)'/);
    // The frozen cut-off is what keeps a later re-run off rows that arrive once the
    // mapping fix ships (a genuine 8A notice stores a correct "8(a)" and is not in
    // the exception list, so the id guard alone would not protect it).
    expect(first).toMatch(/created_at < '2026-10-19 05:00:00\+00'::timestamptz/);
    expect(first).toMatch(/source LIKE 'sam%'/);
    expect(first.trimEnd().endsWith("RETURNING id")).toBe(true);
  });

  test("statement 1 names 100 exception ids, all distinct, and excludes them", () => {
    const ids = idsIn(statements[0]!);
    expect(ids).toHaveLength(100);
    expect(new Set(ids).size).toBe(100);
    expect(statements[0]).toMatch(/external_id NOT IN \(/);
  });

  test("statement 2 nulls the 15 NONE rows and nothing else", () => {
    const [, second] = statements;
    expect(second).toContain("SET set_aside = NULL");
    expect(second).toMatch(/WHERE set_aside = '8\(a\)'/);
    expect(second).toMatch(/external_id IN \(/);
    const ids = idsIn(second!);
    expect(ids).toHaveLength(15);
    expect(new Set(ids).size).toBe(15);
    // ALL 15 must ALSO be in statement 1's exception list: statement 1 runs first and
    // would otherwise stamp the total-small-business label on a notice SAM says has no
    // set-aside at all, and statement 2's `set_aside = '8(a)'` guard would then miss it.
    // The overlap is the design (85 kept + 15 nulled = the 100 non-SBA rows).
    const keep = new Set(idsIn(statements[0]!));
    expect(ids.filter((id) => keep.has(id))).toHaveLength(15);
    expect(second.trimEnd().endsWith("RETURNING id")).toBe(true);
  });

  test("the exception list is the 8A/8AN/unknown rows, i.e. the rows that are NOT mislabels", () => {
    // The measured split (see the .sql header): of the 4,234 stored "8(a)" rows, SAM's
    // own record says 4,127 are the SBA code (relabelled by statement 1) and 100 are
    // something else (the exception list). Statement 2 nulls 15 of those 100 — the
    // NONE rows — so 85 still read "8(a)" afterwards, every one a real 8(a)/8AN
    // opportunity. The remaining 7 rows whose notice aged out of SAM (404) are in the
    // relabel set: the header names that as the one prior-based part of the rule.
    expect(idsIn(statements[0]!).length).toBe(100);
    expect(idsIn(statements[1]!).length).toBe(15);
    expect(100 - 15).toBe(85);
    expect(4_234 - 100).toBe(4_134);
    // Every id is the SAM natural key shape, never a raw integer id.
    for (const s of statements) {
      for (const id of idsIn(s)) expect(id).toMatch(/^sam-[0-9a-f]{32}$/);
      expect(/\bIN \(\s*\d/.test(s)).toBe(false);
    }
  });

  test("the header records the evidence, the prior-based part and the ambiguity", () => {
    // A data migration the lead applies by hand must carry its own reasoning.
    expect(SQL).toContain("SetASideCode -> SetASide");
    expect(SQL).toContain("17,702");
    expect(SQL).toContain("IS A PRIOR, NOT A MEASUREMENT");
    expect(SQL).toContain("IDEMPOTENT BY CONSTRUCTION");
    // The md_dc hygiene line the brief asked for is deliberately NOT here, and the
    // file says why (the row is a stale duplicate of a live sam_gov row).
    expect(SQL).toContain("md_dc");
    expect(SQL).toContain("409899");
    expect(SQL).not.toMatch(/UPDATE bids\s+SET source/);
  });

  test("the header states the MEASURED split (73 real 8A/8AN), not the stale 65", () => {
    // 73 = 63 real 8A + 10 real 8AN; 73 + 15 NONE + 9 with no published value + 3
    // carrying another designation = the 100-row exception list.
    expect(SQL).toContain("63 8A + 10 8AN");
    expect(SQL).toContain("73 + 15 + 9 + 3 = 100");
    expect(SQL).not.toContain("the 65\n-- real 8A/8AN");
    expect(SQL).toContain("82"); // the '8(a)' bucket 066 leaves behind, cross-referenced
  });
});

/**
 * 065's run-065.ts verify() LIST RULE — the owner rule (2026-10-19) is that a check
 * must PASS when the migration is correct and fail only when something is actually
 * wrong. These three cases are the whole rule: the shipped lists pass with NO output,
 * an exception id statement 1 would keep reading "8(a)" forever but must not fails,
 * and a NONE id missing from the exception list fails.
 */
const LIST_SHAPE = { exceptionIds: idsIn(statements[0]!), noneIds: idsIn(statements[1]!) };

describe("migration 065's verify() list rule — passes on the shipped file", () => {
  test("(a) the designed overlap: ALL 15 NONE ids sit inside statement 1's exception list", () => {
    const overlap = setAsideListOverlap(LIST_SHAPE);
    expect(overlap).toHaveLength(SET_ASIDE_NONE_COUNT);
    expect([...overlap].sort()).toEqual([...LIST_SHAPE.noneIds].sort());
    // A correct migration produces ZERO problem output. The old check asserted the two
    // lists were disjoint and so failed on every correct run.
    expect(checkSetAsideListShape(LIST_SHAPE)).toEqual([]);
  });

  test("(b) an exception id statement 1 would keep forever but must not — FAILS", () => {
    const problems = checkSetAsideListShape({
      ...LIST_SHAPE,
      exceptionIds: [...LIST_SHAPE.exceptionIds, "sam-11111111111111111111111111111111"],
    });
    expect(problems.length).toBeGreaterThan(0);
    expect(problems.join(" | ")).toContain(
      `keeps 86 row(s) reading '8(a)' forever, expected ${SET_ASIDE_KEPT_EIGHT_A_COUNT}`,
    );
  });

  test("(c) a NONE id MISSING from statement 1's exception list — FAILS", () => {
    const problems = checkSetAsideListShape({
      ...LIST_SHAPE,
      exceptionIds: LIST_SHAPE.exceptionIds.filter((id) => id !== LIST_SHAPE.noneIds[0]),
    });
    expect(problems.length).toBeGreaterThan(0);
    expect(problems.join(" | ")).toContain(
      `only ${SET_ASIDE_NONE_COUNT - 1}/${SET_ASIDE_NONE_COUNT} NONE ids are protected`,
    );
  });

  test("the evidence arithmetic the frozen counts come from", () => {
    const groups = SET_ASIDE_EVIDENCE_GROUPS;
    expect(groups.eightA + groups.eightAN).toBe(73); // the figure 065's header states
    expect(SET_ASIDE_EXCEPTION_COUNT).toBe(100);
    expect(SET_ASIDE_KEPT_EIGHT_A_COUNT).toBe(85);
    expect(SET_ASIDE_RELABEL_ROWS).toBe(4_134);
    expect(4_234 - SET_ASIDE_EXCEPTION_COUNT).toBe(SET_ASIDE_RELABEL_ROWS);
    // 066 takes the 3 "other designation" rows out, leaving 82.
    expect(SET_ASIDE_KEPT_EIGHT_A_COUNT - groups.otherDesignation).toBe(82);
  });
});

/**
 * MIGRATION 066 — the three follow-ups: the 3 WOSB/WOSBSS/SBP rows (SAM's own record
 * re-read per id 2026-10-19, reproducing 065's split exactly: 63 8A, 10 8AN, 15 NONE,
 * 9 with no published value, 3 other) and the stale `md_dc` duplicate id 4384.
 * The target LABEL is not a judgement call: it is the string the 4-hourly sync's own
 * normalizeSetAside returns for that notice's SAM code, so the stored value cannot
 * drift from the next sync.
 */
const FILE_066 = new URL("../../db/migrations/066_bids_set_aside_other_designations.sql", import.meta.url);
const SQL_066 = readFileSync(FILE_066, "utf8");
const statements066 = splitStatements(SQL_066);
/** Measured 2026-10-19 (SAM detail API): WOSB, WOSBSS, SBP — in that file order. */
const WOSB_IDS = ["sam-f0c78ea349e342329b172564ad69ab4e", "sam-daab0dffa3044ad19e6d7ca610be2bc0"];
const SBP_IDS = ["sam-ecd2e2a033c147f0ba7f7de6fb14f528"];
/** The stale md_dc duplicate and the live twin the nightly CSV ingest created. */
const CLOSE_ID = 4384;
const MD_DC_EXTERNAL_ID = "mddc-dc-2412c3d99bcb4288a6e742a02b87129d";
const SAM_GOV_TWIN_ID = "sam-2412c3d99bcb4288a6e742a02b87129d";

describe("migration 066 — the WOSB/WOSBSS/SBP rows and the md_dc duplicate", () => {
  test("is exactly three UPDATE-bids statements, each writing one column group", () => {
    expect(statements066).toHaveLength(3);
    for (const statement of statements066) {
      expect(statement.trimStart().startsWith("UPDATE bids")).toBe(true);
      expect(/\b(delete|insert|truncate|drop|alter|create)\b/i.test(statement)).toBe(false);
      expect(statement.match(/SET /g)).toHaveLength(1);
      expect(statement.trimEnd().endsWith("RETURNING id")).toBe(true);
      // The close-out mirrors the nightly statement exactly, which writes ONLY
      // closed_at + updated_at — archive_date is the CSV's own column.
      expect(/\barchive_date\b/i.test(statement)).toBe(false);
    }
  });

  test("statements 1 and 2 write the string the SYNC's own normalizer returns", () => {
    expect(normalizeSetAside("WOSB")).toBe("WOSB");
    expect(normalizeSetAside("WOSBSS")).toBe("WOSB"); // the pre-existing sole-source collapse
    // SBP has no map entry, so the sync stores the CODE — NOT "WOSB". Labelling it
    // "WOSB" would drift from the next sync of the same notice.
    expect(normalizeSetAside("SBP")).toBe("SBP");
    const [wosb, sbp] = statements066;
    expect(wosb).toContain(`SET set_aside = '${normalizeSetAside("WOSB")}'`);
    expect(wosb).toContain(`SET set_aside = '${normalizeSetAside("WOSBSS")}'`);
    expect(sbp).toContain(`SET set_aside = '${normalizeSetAside("SBP")}'`);
    expect(sbp).not.toContain("SET set_aside = 'WOSB'");
    for (const statement of [wosb!, sbp!]) {
      expect(statement).toMatch(/WHERE set_aside = '8\(a\)'/); // the idempotency guard
      expect(statement).toMatch(/external_id IN \(/);
    }
    expect([...idsIn(wosb!)].sort()).toEqual([...WOSB_IDS].sort());
    expect(idsIn(sbp!)).toEqual(SBP_IDS);
  });

  test("statement 3 closes the md_dc duplicate WITHOUT relabelling it", () => {
    const close = statements066[2]!;
    expect(close).toMatch(/SET closed_at = NOW\(\), updated_at = NOW\(\)/);
    expect(close).not.toMatch(/SET set_aside/);
    expect(close).toContain(`WHERE id = ${CLOSE_ID}`);
    expect(close).toContain(`external_id = '${MD_DC_EXTERNAL_ID}'`);
    expect(close).toContain("source = 'md_dc'");
    expect(close).toMatch(/closed_at IS NULL/); // a re-run cannot re-stamp the timestamp
    expect(idsIn(close)).toHaveLength(0); // it closes a retired-label row by id
  });

  test("the 3 rows are exactly 3 of 065's exception list — nothing new is reachable", () => {
    const exception = new Set(idsIn(statements[0]!));
    for (const id of [...WOSB_IDS, ...SBP_IDS]) expect(exception.has(id)).toBe(true);
    expect([...WOSB_IDS, ...SBP_IDS]).toHaveLength(SET_ASIDE_EVIDENCE_GROUPS.otherDesignation);
    // Out of scope and left alone: the 15 NONE rows (already NULL), the 9 with no
    // published value, the 10 real 8AN rows and the other 225 md_dc rows.
    expect(SQL_066).not.toContain("sam-624e076337ab4f2a95d20421c810bc8d"); // a NONE id
  });

  test("the header records the evidence, the deviation and the idempotency story", () => {
    for (const id of [...WOSB_IDS, ...SBP_IDS]) expect(SQL_066).toContain(id);
    for (const fragment of [
      "WOSBSS",
      'NOT "WOSB"', // why SBP does not become WOSB
      "85 -> 82",
      "13,139", // the counter total WITH the duplicate
      "13,138", // ... and without it
      "225", // the other md_dc rows, untouched
      "overlap EQUALS", // the run-065 verify() design fix
      "IDEMPOTENT BY CONSTRUCTION",
      String(CLOSE_ID),
      MD_DC_EXTERNAL_ID,
      SAM_GOV_TWIN_ID,
    ]) {
      expect(SQL_066).toContain(fragment);
    }
  });
});
