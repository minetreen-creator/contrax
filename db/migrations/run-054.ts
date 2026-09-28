/** Apply the additive DOT review-ledger migration before deploying its read path. */
import { readFileSync } from "node:fs";
import { neon } from "@neondatabase/serverless";
import { migrationStatements } from "./sql-statements";

const url = process.env.DATABASE_URL;
if (!url) throw new Error("DATABASE_URL is required");
const sql = neon(url);
const file = new URL("./054_dot_directory.sql", import.meta.url);
const statements = migrationStatements(readFileSync(file, "utf8"));
const count = async (table: string): Promise<number> => {
  const rows = await sql.query(`SELECT count(*)::int AS n FROM ${table}`) as { n: number }[];
  return Number(rows[0]?.n ?? 0);
};
const primeCount = await count("subcontract_primes");
const noticeCount = await count("subcontract_opportunities");
console.log(`[run-054] target ${new URL(url).hostname}; primes ${primeCount}; notices ${noticeCount}`);
for (const statement of statements) await sql.query(statement);
if (await count("subcontract_primes") !== primeCount ||
    await count("subcontract_opportunities") !== noticeCount) {
  throw new Error("Migration changed existing directory/notice counts");
}
console.log(`[run-054] ${statements.length} statements applied; existing row counts unchanged`);
