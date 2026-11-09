// Read-only: Georgia open-bid coverage for property/facility service trades. Public bid data only (titles, buyers, dates); no user data.
import { sql } from "~/db";
import { LOW_CONTENT_SQL } from "~/lib/low-content";
import { AWARD_EXCLUSION_SQL } from "~/lib/source-class";

const TRADES: [string, string][] = [
  ["Pressure / soft washing", "(pressure wash|power wash|soft wash|pressure clean|power clean|washing of (building|exterior)|exterior cleaning)"],
  ["Pine straw & mulch", "(pine straw|mulch)"],
  ["Landscaping / grounds", "(landscap|grounds maint|mowing|lawn|turf maint|right[- ]of[- ]way maint|vegetation)"],
  ["Retention / storm ponds", "(retention pond|detention pond|stormwater pond|storm water pond|pond maint|bmp maint|stormwater (facility|bmp) maint)"],
  ["Gutter cleaning", "(gutter)"],
  ["Carpet, tile & floor care", "(carpet clean|floor care|floor maint|floor clean|strip and wax|strip & wax|tile clean|vct|floor finish)"],
];

const q = async (label: string, p: Promise<unknown>) => {
  try { console.log(label, JSON.stringify(await p)); } catch (e) { console.log(label, "ERR", (e as Error).message.slice(0, 200)); }
};
const GA = sql().unsafe(`(normalized_state = 'GA' OR location ~* '(,\\s*GA\\b|georgia)')`);
const OPEN = sql().unsafe(`due_date > NOW() AND ${LOW_CONTENT_SQL} AND ${AWARD_EXCLUSION_SQL}`);

for (const [name, re] of TRADES) {
  const text = sql().unsafe(`(title ~* '${re}' OR description ~* '${re}')`);
  await q(`${name} | open now in GA`, sql()`SELECT COUNT(*)::int AS open_now, COUNT(*) FILTER (WHERE title ~* ${re})::int AS in_title FROM bids WHERE ${GA} AND ${OPEN} AND ${text}`);
  await q(`${name} | posted in GA, last 90 days`, sql()`SELECT COUNT(*)::int AS n FROM bids WHERE ${GA} AND created_at > NOW() - INTERVAL '90 days' AND ${sql().unsafe(AWARD_EXCLUSION_SQL)} AND ${text}`);
  await q(`${name} | open now, by buyer`, sql()`SELECT agency, COUNT(*)::int AS n FROM bids WHERE ${GA} AND ${OPEN} AND ${text} GROUP BY 1 ORDER BY 2 DESC LIMIT 6`);
  await q(`${name} | open now, examples`, sql()`SELECT title, agency, to_char(due_date, 'Mon DD') AS due FROM bids WHERE ${GA} AND ${OPEN} AND title ~* ${re} ORDER BY due_date ASC LIMIT 4`);
}
await q("All GA open bids", sql()`SELECT COUNT(*)::int AS n FROM bids WHERE ${GA} AND ${OPEN}`);
await q("GA sources with open bids", sql()`SELECT source, COUNT(*)::int AS n FROM bids WHERE ${GA} AND ${OPEN} GROUP BY 1 ORDER BY 2 DESC LIMIT 15`);
process.exit(0);
