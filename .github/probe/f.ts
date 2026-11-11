// Read-only probe: what the 2026-11-05 scraper opened. Counts by state, board and trade, plus public
// bid titles for the ones that were already closed or are gone from our table. No IPs or visitor ids.
import { sql } from "~/db";
import { isScraperFingerprint } from "~/lib/scraper-evidence";
const s = sql();
const row = (l: string, o: unknown) => console.log(l + " " + JSON.stringify(o));
const pv = (await s`SELECT path, user_agent, created_at FROM page_views WHERE created_at BETWEEN '2026-11-05T17:00:00Z' AND '2026-11-05T19:00:00Z' AND path LIKE '/bid/%'`) as { path: string; user_agent: string | null; created_at: Date }[];
const hits = pv.filter((r) => isScraperFingerprint(r.user_agent));
const ids = [...new Set(hits.map((r) => Number(/^\/bid\/(\d+)/.exec(r.path)?.[1])).filter(Boolean))];
row("SCRAPE", { pageViews: hits.length, differentBids: ids.length });
const bids = (await s`SELECT id, title, source, normalized_state AS st, category, location, due_date, created_at FROM bids WHERE id = ANY(${ids})`) as { id: number; title: string; source: string; st: string | null; category: string | null; location: string | null; due_date: Date | null; created_at: Date }[];
row("FOUND IN TABLE NOW", { found: bids.length, goneFromTable: ids.length - bids.length });
const tally = (f: (b: (typeof bids)[number]) => string) => Object.entries(bids.reduce<Record<string, number>>((m, b) => ((m[f(b)] = (m[f(b)] ?? 0) + 1), m), {})).sort((a, b) => b[1] - a[1]);
row("BY STATE", tally((b) => b.st ?? "?").slice(0, 25));
const kind = (src: string) => (src === "sam_gov" || /^sam|^fed|usaspending|grants/.test(src) ? "federal" : /bidnet/.test(src) ? "BidNet group" : "state or local board");
row("BY KIND", tally((b) => kind(b.source)));
row("BY BOARD", tally((b) => b.source).slice(0, 25));
row("BY TRADE", tally((b) => b.category ?? "?").slice(0, 15));
row("BY PLACE", tally((b) => (b.location ?? "?").slice(0, 40)).slice(0, 15));
const t0 = Date.parse("2026-11-05T18:00:00Z");
const closed = bids.filter((b) => b.due_date && new Date(b.due_date).getTime() < t0);
row("ALREADY CLOSED WHEN SCRAPED", { n: closed.length });
for (const b of closed.slice(0, 15)) console.log(`CLOSED bid ${b.id} | ${b.source} | ${b.st} | due ${new Date(b.due_date!).toISOString().slice(0, 10)} | ${b.title.slice(0, 90)}`);
// Order: did it walk ids in sequence, or one state/trade at a time?
const seq = hits.sort((a, b) => +new Date(a.created_at) - +new Date(b.created_at)).map((r) => Number(/^\/bid\/(\d+)/.exec(r.path)?.[1]));
let asc = 0; for (let i = 1; i < seq.length; i++) if (seq[i] > seq[i - 1]) asc++;
row("ORDER", { steps: seq.length - 1, idWentUp: asc, first12: seq.slice(0, 12) });
const byId = new Map(bids.map((b) => [b.id, b]));
let sameState = 0, n = 0; for (let i = 1; i < seq.length; i++) { const a = byId.get(seq[i - 1]), b = byId.get(seq[i]); if (a && b) { n++; if (a.st === b.st) sameState++; } }
row("NEIGHBOURS", { pairs: n, sameStateAsPrevious: sameState });
// A few distinctive open local titles to look for elsewhere.
const pick = bids.filter((b) => !/bidnet|sam_gov/.test(b.source) && b.title.length > 35).slice(0, 8);
for (const b of pick) console.log(`LOCAL bid ${b.id} | ${b.source} | ${b.title.slice(0, 100)}`);
process.exit(0);
