/** Additive, repeatable: visitors.country. */
import { readFileSync } from "node:fs";
import { neon } from "@neondatabase/serverless";
import { migrationStatements } from "./sql-statements";

const url = process.env.DATABASE_URL;
if (!url) throw new Error("DATABASE_URL is required");
const sql = neon(url);
for (const statement of migrationStatements(readFileSync(new URL("./057_visitors_country.sql", import.meta.url), "utf8"))) {
  await sql.query(statement);
}
console.log("[run-057] visitors.country ready");
