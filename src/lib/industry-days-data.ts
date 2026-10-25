import { createServerFn } from "@tanstack/react-start";
import { dedupeEvents, INDUSTRY_DAY_PATTERN, type IndustryDayRow } from "./industry-days";

/** Server side of /industry-days (industry-days.ts). null rows = the store couldn't be read. */
export const getIndustryDays = createServerFn({ method: "GET" }).handler(async (): Promise<{ rows: IndustryDayRow[] | null }> => {
  try {
    const { sql } = await import("~/db");
    const { AWARD_EXCLUSION_SQL } = await import("~/lib/source-class");
    const rows = (await sql().query(
      `SELECT id, title, agency, location, normalized_state AS state,
              to_char(due_date AT TIME ZONE 'America/New_York', 'YYYY-MM-DD') AS date, source_url AS url
       FROM bids
       WHERE title ~* $1
         AND (due_date >= NOW() - INTERVAL '12 hours' OR (due_date IS NULL AND created_at > NOW() - INTERVAL '45 days'))
         AND ${AWARD_EXCLUSION_SQL}
       ORDER BY due_date ASC NULLS LAST, id DESC
       LIMIT 500`,
      [INDUSTRY_DAY_PATTERN],
    )) as IndustryDayRow[];
    return { rows: dedupeEvents(rows.map((r) => ({ ...r, id: Number(r.id) }))) };
  } catch (err) {
    console.error("[industry-days] query failed:", err);
    return { rows: null };
  }
});
