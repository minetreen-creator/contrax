// Read-only: open bids in Tampa Bay in our database (public bid titles and agencies only).
import { sql } from "~/db";
import { LOW_CONTENT_SQL } from "~/lib/low-content";
import { AWARD_EXCLUSION_SQL } from "~/lib/source-class";
import { TAMPA_PLACES, isBuildWork, isTampaBay } from "~/lib/tampa";
const s = sql();
const like = TAMPA_PLACES.map((p) => `%${p}%`);
const rows = (await s`
  SELECT title, agency, location, due_date FROM bids
  WHERE due_date > NOW() AND ${s.unsafe(LOW_CONTENT_SQL)} AND ${s.unsafe(AWARD_EXCLUSION_SQL)}
    AND (LOWER(COALESCE(location,'')) LIKE ANY(${like}) OR LOWER(COALESCE(agency,'')) LIKE ANY(${like}))
  ORDER BY due_date`) as { title: string; agency: string | null; location: string | null; due_date: string }[];
const here = rows.filter((r) => isTampaBay(r.location, r.agency));
const build = here.filter((r) => isBuildWork(r.title));
console.log(`open Tampa Bay bids: ${here.length}; construction/trade/facility: ${build.length}`);
const by = new Map<string, number>();
for (const r of here) by.set(r.agency ?? "?", (by.get(r.agency ?? "?") ?? 0) + 1);
console.log("buyers (all):", [...by.entries()].sort((a, b) => b[1] - a[1]).slice(0, 10).map(([a, n]) => `${a} ${n}`).join("; "));
for (const r of build) console.log(" -", String(r.due_date).slice(0, 10), "|", r.agency, "|", r.location, "|", r.title.slice(0, 90));
