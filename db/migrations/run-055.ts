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
console.log(`[run-055] ${statements.length} statements applied; users unchanged`);
