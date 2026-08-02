/**
 * Migration runner — uses Node.js APIs (fs, path) so it's NOT imported by route code.
 * Only used by the setup script: `bun run src/db/setup.ts`
 */

import { readFile } from "node:fs/promises";
import path from "node:path";
import { sql } from "../db";

/**
 * Split a SQL file into individual statements, respecting:
 * - DO $$ ... END $$ blocks (don't split on semicolons inside)
 * - Single-line comments (-- ...)
 */
function splitSqlStatements(schema: string): string[] {
  const statements: string[] = [];
  let current = "";
  let inDollarBlock = false;

  for (let i = 0; i < schema.length; i++) {
    const ch = schema[i];

    // Track DO $$ ... END $$ blocks
    if (schema.substring(i, i + 3) === "DO " && schema.substring(i + 3).match(/^\s*\$\$/)) {
      inDollarBlock = true;
    }

    if (ch === ";" && !inDollarBlock) {
      const stmt = current.trim();
      // Skip empty statements and pure comments
      const cleaned = stmt
        .split("\n")
        .filter((line) => !line.trim().startsWith("--"))
        .join("\n")
        .trim();
      if (cleaned.length > 0) {
        statements.push(stmt);
      }
      current = "";
      continue;
    }

    current += ch;

    // Check for END $$ closing a DO block
    if (inDollarBlock && schema.substring(i - 5, i + 1) === "END $$") {
      inDollarBlock = false;
    }
  }

  // Don't forget the last statement
  const last = current.trim();
  if (last.length > 0) {
    const cleaned = last
      .split("\n")
      .filter((line) => !line.trim().startsWith("--"))
      .join("\n")
      .trim();
    if (cleaned.length > 0) {
      statements.push(last);
    }
  }

  return statements;
}

/**
 * Run all migrations from schema.sql.
 */
export async function runMigrations(): Promise<void> {
  const schemaPath = path.join(import.meta.dirname, "schema.sql");
  const schema = await readFile(schemaPath, "utf8");

  const statements = splitSqlStatements(schema);

  const db = sql();
  let count = 0;
  for (const statement of statements) {
    try {
      await db`${db.unsafe(statement)}`;
      count++;
    } catch (err) {
      const msg = (err as Error).message;
      // Skip duplicate constraint errors gracefully
      if (msg.includes("already exists") || msg.includes("duplicate")) {
        console.log(`  (skipping: ${msg.substring(0, 60)}...)`);
        count++;
        continue;
      }
      throw err;
    }
  }
  console.log(`✅ Migrations complete: ${count} statements executed`);
}
