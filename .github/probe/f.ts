// TEMP read-only probe. Bid records only (public pages): no IPs, visitor ids or emails.
import { neon } from "@neondatabase/serverless";
import { isScraperFingerprint } from "../../src/lib/scraper-evidence";
const sql = neon(process.env.DATABASE_URL!);
const raw = (await sql`SELECT path, user_agent FROM page_views WHERE created_at >= '2026-11-05T17:00:00Z' AND created_at < '2026-11-05T19:00:00Z'`) as any[];
const ids = [...new Set(raw.filter((r) => isScraperFingerprint(r.user_agent)).map((r) => Number(String(r.path).match(/^\/bid\/(\d+)/)?.[1])).filter((n) => n > 0))];
const rows = (await sql`SELECT id, title, agency, location, source, due_date, ai_summary FROM bids WHERE id = ANY(${ids}) ORDER BY id`) as any[];
console.log("taken bids found", rows.length, "with our summary", rows.filter((r) => r.ai_summary).length, "demo", rows.filter((r) => r.source === "contrax-demo").map((r) => `${r.id}:${r.title}`));
console.log("summary keys", JSON.stringify(Object.keys(rows.find((r) => r.ai_summary)?.ai_summary ?? {})));
const open = rows.filter((r) => r.ai_summary && r.due_date && new Date(r.due_date) > new Date() && r.source !== "contrax-demo");
const pick: any[] = []; const seen = new Set<string>();
for (const r of open) { const st = String(r.location ?? "").slice(-2); if (seen.has(r.source) && pick.length < 6) continue; seen.add(r.source); pick.push(r); if (pick.length >= 10) break; }
for (const r of pick) console.log("BID", JSON.stringify({ id: r.id, title: r.title, agency: r.agency, location: r.location, source: r.source, due: r.due_date, summary: JSON.stringify(r.ai_summary).slice(0, 500) }));
