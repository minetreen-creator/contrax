/** Run manually before shipping the bid workspace: bun run db/migrations/run-052.ts */
import { readFileSync } from "node:fs";
import { neon } from "@neondatabase/serverless";
import { migrationStatements } from "./sql-statements";

const url = process.env.DATABASE_URL;
if (!url) throw new Error("DATABASE_URL is not set");
const db = neon(url);
const file = new URL("./052_bid_workspace.sql", import.meta.url);
console.log(`Applying bid workspace migration to ${new URL(url).hostname}`);
for (const statement of migrationStatements(readFileSync(file, "utf8"))) {
  await db.query(statement);
}
console.log("Bid workspace migration complete");
