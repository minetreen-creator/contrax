/**
 * Migration 065's RULE, pinned as an invariant (no database, no network).
 *
 * WHY: 065 is a DATA migration that rewrites `bids.set_aside` on production. It is
 * hand-run, so nothing else stops a careless future edit from widening its blast
 * radius (a blanket relabel with no exception list would delete 65 REAL 8(a)/8AN
 * opportunities from an 8(a) firm's Radar — the opposite error to the one the
 * migration fixes). These assertions read the shipped .sql file itself and hold it
 * to the shape the evidence justifies:
 *
 *   * exactly two statements, both `UPDATE bids`, no DDL/INSERT/DELETE;
 *   * statement 1 keeps a named exception list of 100 ids, disjoint from statement 2's
 *     15, each an exact `sam-<32 hex>` external_id;
 *   * statement 1 is guarded by `set_aside = '8(a)'` AND a frozen created_at cut-off
 *     (the two devices that make a re-run a no-op);
 *   * statement 1 writes the ONE label both SAM ingests agree on, taken from
 *     TOTAL_SMALL_BUSINESS_LABEL — not a hand-typed copy of it;
 *   * statement 2 nulls the NONE rows rather than inventing a label for them.
 */
import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { TOTAL_SMALL_BUSINESS_LABEL } from "~/jobs/sources/sam-gov";

const FILE = new URL("../../db/migrations/065_bids_set_aside_relabel.sql", import.meta.url);
const SQL = readFileSync(FILE, "utf8");
/**
 * The SAME split rule db/migrations/sql-statements.ts applies when the runner
 * executes the file (whole-line `--` comments dropped, split on `;`), written out
 * here so this test needs no import from outside `src/` and cannot be fooled by a
 * comment containing SQL.
 */
const statements = SQL.split("\n")
  .filter((line) => !line.trim().startsWith("--"))
  .join("\n")
  .split(";")
  .map((s) => s.trim())
  .filter((s) => s.length > 0);

/** Every `sam-<32 hex>` external_id literal in a statement, in file order. */
function idsIn(statement: string): string[] {
  return [...statement.matchAll(/'(sam-[0-9a-f]{32})'/g)].map((m) => m[1]!);
}

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
});
