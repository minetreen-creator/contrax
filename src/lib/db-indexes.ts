/**
 * The lookup indexes the busiest tables were missing (owner 2026-11-22, "yes"). The database had
 * read 208 billion `bids` rows by full scan: the table had no index on state, due date, date
 * added or NAICS code, so every state page, search and count read all 130,000 rows, and crawlers
 * open bid pages about 32,000 times a day. `notifications` (418,616 rows) had no index at all
 * beyond its id, and each batch of new ones checks for duplicates by user.
 *
 * Adding an index changes no data and no page. [name, table, definition]. PURE.
 */
export const DB_INDEXES: readonly (readonly [string, string, string])[] = [
  ["idx_bids_state_due", "bids", "(normalized_state, due_date)"],
  ["idx_bids_due_date", "bids", "(due_date)"],
  ["idx_bids_created_at", "bids", "(created_at DESC)"],
  ["idx_bids_naics_prefix", "bids", "(naics_code text_pattern_ops)"],
  ["idx_notifications_user_read", "notifications", "(user_id, read)"],
  ["idx_notifications_user_created", "notifications", "(user_id, created_at DESC)"],
  ["idx_award_leads_state_awarded", "award_leads", "(pop_state, awarded_on DESC)"],
];

/** Tables whose statistics are refreshed afterwards so the planner uses the new indexes. */
export const DB_INDEX_TABLES: readonly string[] = [...new Set(DB_INDEXES.map((i) => i[1]))];

const NAME = /^[a-z_][a-z0-9_]*$/;
const DEF = /^\([a-z0-9_ ,]+\)$/i;

/** The statement for one index; throws on anything that is not a plain name and column list. */
export function indexStatement(name: string, table: string, def: string, concurrently: boolean): string {
  if (!NAME.test(name) || !NAME.test(table) || !DEF.test(def)) throw new Error(`refusing index ${name}`);
  return `CREATE INDEX ${concurrently ? "CONCURRENTLY " : ""}IF NOT EXISTS ${name} ON ${table} ${def}`;
}
