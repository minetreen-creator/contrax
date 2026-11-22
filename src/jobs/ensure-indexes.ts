/**
 * Ensure indexes — CLI entrypoint (`bun run ensure-indexes`), run by hand from
 * .github/workflows/ensure-indexes.yml (owner 2026-11-22: "yes" to adding the missing indexes).
 * Creates the indexes in src/lib/db-indexes.ts if they are missing and refreshes the planner's
 * statistics for those tables. It adds and changes no rows and deletes nothing. Safe to run twice.
 *
 * It ends with two read-only counts the owner asked about: how the tables are being read now, and
 * how many match notifications sit beyond the newest 200 per account.
 */
import { sql } from "~/db";
import { DB_INDEXES, DB_INDEX_TABLES, indexStatement } from "~/lib/db-indexes";

async function main() {
  const s = sql();
  for (const [name, table, def] of DB_INDEXES) {
    const had = ((await s`SELECT 1 FROM pg_indexes WHERE schemaname = 'public' AND indexname = ${name}`) as unknown[]).length > 0;
    if (had) {
      console.log(`INDEX ${name} | already there`);
      continue;
    }
    const started = Date.now();
    try {
      await s.query(indexStatement(name, table, def, true));
    } catch (e) {
      // CONCURRENTLY cannot run inside a transaction; some drivers wrap one. An interrupted
      // concurrent build can also leave an invalid index behind, so drop that and build plainly.
      console.log(`INDEX ${name} | concurrent build not possible (${(e instanceof Error ? e.message : "").slice(0, 80)}), building plainly`);
      await s.query(`DROP INDEX IF EXISTS ${name}`);
      await s.query(indexStatement(name, table, def, false));
    }
    const ok = (await s`SELECT i.indisvalid FROM pg_class c JOIN pg_index i ON i.indexrelid = c.oid WHERE c.relname = ${name}`) as { indisvalid: boolean }[];
    console.log(`INDEX ${name} | created on ${table} ${def} in ${Math.round((Date.now() - started) / 1000)}s | valid ${ok[0]?.indisvalid ?? "?"}`);
  }
  for (const t of DB_INDEX_TABLES) {
    await s.query(`ANALYZE ${t}`);
    console.log(`ANALYZE ${t} | done`);
  }
  const sizes = (await s`
    SELECT relname, pg_size_pretty(pg_indexes_size(relid)) AS idx, seq_scan, idx_scan
    FROM pg_stat_user_tables WHERE relname = ANY(${[...DB_INDEX_TABLES]}) ORDER BY 1`) as any[];
  for (const r of sizes) console.log(`TABLE ${r.relname} | indexes ${r.idx} | full reads so far ${r.seq_scan} | index reads so far ${r.idx_scan}`);
  const extra = (await s`
    WITH ranked AS (SELECT user_id, ROW_NUMBER() OVER (PARTITION BY user_id ORDER BY created_at DESC, id DESC) AS rn FROM notifications WHERE type = 'new_bid_match')
    SELECT COUNT(*) FILTER (WHERE rn > 200)::int AS beyond, COUNT(*)::int AS total, COUNT(DISTINCT user_id) FILTER (WHERE rn > 200)::int AS accounts FROM ranked`) as any[];
  console.log(`NOTIF match notifications ${extra[0].total} | beyond the newest 200 per account ${extra[0].beyond} | accounts over 200: ${extra[0].accounts}`);
}

main().then(() => process.exit(0)).catch((e) => { console.error("ensure-indexes failed:", e instanceof Error ? e.message : e); process.exit(1); });
