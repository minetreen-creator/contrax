/** Additive, repeatable paid entitlement migration. */
import { readFileSync } from "node:fs";
import { neon } from "@neondatabase/serverless";
import { migrationStatements } from "./sql-statements";

const url = process.env.DATABASE_URL;
if (!url) throw new Error("DATABASE_URL is required");
const sql = neon(url);
const before = await sql`SELECT count(*)::int AS n FROM users`;
for (const statement of migrationStatements(readFileSync(new URL("./056_contractor_operations_subscription.sql", import.meta.url), "utf8"))) {
  await sql.query(statement);
}
const after = await sql`SELECT count(*)::int AS n FROM users`;
if (Number(before[0].n) !== Number(after[0].n)) throw new Error("Migration changed users");
console.log("[run-056] entitlement table ready; users unchanged");
