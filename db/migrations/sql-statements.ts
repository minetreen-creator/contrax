/**
 * Splits a migration `.sql` file into individual statements.
 *
 * WHY THIS EXISTS: a migration file is the single source of truth for its DDL,
 * and two things consume it — `db/migrations/run-044.ts` (the idempotent runner)
 * and the real-DB test suite's schema provisioning. Both must execute EXACTLY the
 * statements in the file, so the split rule lives here rather than being copied.
 *
 * THE RULE (and the constraint it puts on a migration file):
 *   - whole-line `--` comments are dropped;
 *   - the file is split on `;`.
 *
 * Therefore a migration that must be splittable this way MAY NOT contain a
 * semicolon inside a statement — so no `DO $$ … $$` blocks and no string literal
 * containing `;`. That is why 044 swaps the UNIQUE constraint with
 * `DROP CONSTRAINT IF EXISTS` + `CREATE UNIQUE INDEX IF NOT EXISTS` (both plain,
 * re-runnable statements) instead of a PL/pgSQL block.
 */
export function migrationStatements(sqlText: string): string[] {
  return sqlText
    .split("\n")
    .filter((line) => !line.trim().startsWith("--"))
    .join("\n")
    .split(";")
    .map((statement) => statement.trim())
    .filter((statement) => statement.length > 0);
}
