// Read-only probe: at what clock times are open bids' deadlines stored? Counts only.
import { sql } from "~/db";
const s = sql();
const row = (l: string, o: unknown) => console.log(l + " " + JSON.stringify(o));
row("TOTAL", await s`SELECT COUNT(*)::int AS open_bids FROM bids WHERE due_date > NOW()`);
row("BY UTC TIME", await s`SELECT to_char(due_date AT TIME ZONE 'UTC', 'HH24:MI') AS utc_time, COUNT(*)::int AS n, COUNT(DISTINCT source)::int AS sources FROM bids WHERE due_date > NOW() GROUP BY 1 ORDER BY 2 DESC LIMIT 30`);
row("DAY DIFFERS (UTC day vs Eastern day)", await s`SELECT COUNT(*)::int AS n, COUNT(DISTINCT source)::int AS sources FROM bids WHERE due_date > NOW() AND (due_date AT TIME ZONE 'UTC')::date <> (due_date AT TIME ZONE 'America/New_York')::date`);
row("DAY DIFFERS by source", await s`SELECT source, to_char(due_date AT TIME ZONE 'UTC', 'HH24:MI') AS utc_time, COUNT(*)::int AS n FROM bids WHERE due_date > NOW() AND (due_date AT TIME ZONE 'UTC')::date <> (due_date AT TIME ZONE 'America/New_York')::date GROUP BY 1, 2 ORDER BY 3 DESC LIMIT 45`);
row("DAY DIFFERS by time", await s`SELECT to_char(due_date AT TIME ZONE 'UTC', 'HH24:MI') AS utc_time, COUNT(*)::int AS n, COUNT(DISTINCT source)::int AS sources FROM bids WHERE due_date > NOW() AND (due_date AT TIME ZONE 'UTC')::date <> (due_date AT TIME ZONE 'America/New_York')::date GROUP BY 1 ORDER BY 2 DESC LIMIT 20`);
process.exit(0);
