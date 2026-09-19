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

/** The `$tag$` that opens/closes a dollar-quoted body, or null. */
const DOLLAR_TAG = /^\$[A-Za-z_0-9]*\$/;

/**
 * Splits the CANONICAL merged schema (src/db/schema.sql) into statements.
 *
 * WHY A SECOND SPLITTER. `migrationStatements()` above can split on `;` alone
 * because the rule it enforces on a migration file is exactly "no `;` inside a
 * statement". src/db/schema.sql is not a migration: it is the merged schema, and
 * it contains guarded `DO $$ … END $$;` blocks (the optional pgvector setup), so a
 * naive split would cut those statements in half and a bootstrap would run a
 * fragment. The rules here are the migration rules PLUS dollar-quote awareness:
 * whole-line `--` comments are dropped, and `;` only terminates a statement when
 * it is OUTSIDE a `$$ … $$` body (any tag — `$$`, `$do$`, …).
 *
 * Used by src/lib/state-grants/state-grants-bootstrap.test.ts, which builds a
 * database from src/db/schema.sql ALONE and then runs the part 2 search + coverage
 * surface on it — that test is what proves the schema.sql mirror of migrations
 * 043 + 044 is complete.
 */
export function schemaStatements(sqlText: string): string[] {
  const text = sqlText
    .split("\n")
    .filter((line) => !line.trim().startsWith("--"))
    .join("\n");
  const statements: string[] = [];
  let current = "";
  let openTag: string | null = null;
  for (let i = 0; i < text.length; i++) {
    const char = text[i];
    if (char === "$") {
      const tag = DOLLAR_TAG.exec(text.slice(i));
      if (tag) {
        // Opening a body, closing the one we opened, or a nested/quoted use.
        if (openTag === null) openTag = tag[0];
        else if (openTag === tag[0]) openTag = null;
        current += tag[0];
        i += tag[0].length - 1;
        continue;
      }
    }
    if (char === ";" && openTag === null) {
      const statement = current.trim();
      if (statement.length > 0) statements.push(statement);
      current = "";
      continue;
    }
    current += char;
  }
  const last = current.trim();
  if (last.length > 0) statements.push(last);
  return statements;
}
