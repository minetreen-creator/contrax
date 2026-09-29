/** Apply the additive contractor payment pilot migration before deploying its routes. */
import { readFileSync } from "node:fs";
import { neon } from "@neondatabase/serverless";
import { migrationStatements } from "./sql-statements";

const url = process.env.DATABASE_URL;
if (!url) throw new Error("DATABASE_URL is required");
const sql = neon(url);
const file = new URL("./055_contract_payments.sql", import.meta.url);
const statements = migrationStatements(readFileSync(file, "utf8"));
const existing = await sql`SELECT count(*)::int AS n FROM users`;
const usersBefore = Number(existing[0]?.n ?? 0);
console.log(`[run-055] target ${new URL(url).hostname}; users ${usersBefore}`);
for (const statement of statements) await sql.query(statement);
const after = await sql`SELECT count(*)::int AS n FROM users`;
if (Number(after[0]?.n ?? 0) !== usersBefore) throw new Error("Migration changed user count");
const columns = await sql`
  SELECT table_name, column_name FROM information_schema.columns
  WHERE table_schema = 'public' AND table_name IN ('contract_payments', 'contract_labor_entries')
`;
const actual = new Set(columns.map((row) => `${row.table_name}.${row.column_name}`));
for (const field of [
  'contract_payments.user_id', 'contract_payments.amount_cents', 'contract_payments.follow_up_date',
  'contract_payments.status', 'contract_payments.archived_at',
  'contract_labor_entries.user_id', 'contract_labor_entries.work_date',
  'contract_labor_entries.hours_hundredths', 'contract_labor_entries.hourly_rate_cents',
  'contract_labor_entries.reviewed', 'contract_labor_entries.archived_at',
]) {
  if (!actual.has(field)) throw new Error(`Migration 055 missing ${field}`);
}
console.log(`[run-055] ${statements.length} statements applied; users unchanged`);
