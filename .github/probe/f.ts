// Read-only probe: which bids did the 2026-11-05 scraper read? Public bid fields only
// (no IPs, browsers or visitor ids are printed).
import { sql } from "~/db";
import { isScraperFingerprint } from "~/lib/scraper-evidence";
const s = sql();
const pv = (await s`SELECT path, user_agent FROM page_views WHERE created_at BETWEEN '2026-11-05T17:00:00Z' AND '2026-11-05T19:00:00Z' AND path LIKE '/bid/%'`) as { path: string; user_agent: string | null }[];
const ids = new Map<number, number>();
let scraperViews = 0;
for (const r of pv) {
  if (!isScraperFingerprint(r.user_agent)) continue;
  const id = Number(/^\/bid\/(\d+)/.exec(r.path)?.[1]);
  if (!id) continue;
  scraperViews++;
  ids.set(id, (ids.get(id) ?? 0) + 1);
}
console.log(`scraper bid-page views ${scraperViews}, distinct bids ${ids.size}`);
const rows = (await s`SELECT id, source, agency, title, location, due_date, created_at FROM bids WHERE id = ANY(${[...ids.keys()]})`) as { id: number; source: string; agency: string | null; title: string; location: string | null; due_date: Date | null; created_at: Date }[];
const bySource = new Map<string, number>();
for (const r of rows) bySource.set(r.source, (bySource.get(r.source) ?? 0) + 1);
console.log("by source:", [...bySource].sort((a, b) => b[1] - a[1]).map(([k, n]) => `${k} ${n}`).join(", "));
const states = new Map<string, number>();
for (const r of rows) { const st = /,\s*([A-Z]{2})\b/.exec(r.location ?? "")?.[1] ?? "?"; states.set(st, (states.get(st) ?? 0) + 1); }
console.log("by state:", [...states].sort((a, b) => b[1] - a[1]).map(([k, n]) => `${k} ${n}`).join(", "));
const firstSeen = rows.map((r) => new Date(r.created_at).toISOString().slice(0, 10)).sort();
console.log("bids first stored: earliest", firstSeen[0], "latest", firstSeen[firstSeen.length - 1]);
console.log("BIDS");
for (const r of rows.sort((a, b) => a.source.localeCompare(b.source))) console.log(JSON.stringify({ id: r.id, source: r.source, agency: r.agency, title: r.title, location: r.location, due: r.due_date ? new Date(r.due_date).toISOString().slice(0, 10) : null }));
process.exit(0);
