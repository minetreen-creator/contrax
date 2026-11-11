// TEMP read-only probe. Counts only: never prints an IP, visitor id or email.
import { neon } from "@neondatabase/serverless";
import { isScraperFingerprint } from "../../src/lib/scraper-evidence";
const sql = neon(process.env.DATABASE_URL!);
const tally = (xs: string[]) => { const m = new Map<string, number>(); for (const x of xs) m.set(x, (m.get(x) ?? 0) + 1); return [...m.entries()].sort((a, b) => b[1] - a[1]); };
const q = async (label: string, f: () => Promise<unknown>) => { try { console.log(label, JSON.stringify(await f())); } catch (e) { console.log(label, "ERR", (e as Error).message.slice(0, 120)); } };
const host = (r: string) => { try { return new URL(r).host; } catch { return r ? "(not a url)" : "(none)"; } };

const raw = (await sql`SELECT created_at, ip, path, user_agent, region, browser_label, visitor_id, referrer, source, medium
  FROM page_views WHERE created_at >= '2026-11-05T17:00:00Z' AND created_at < '2026-11-05T19:00:00Z' ORDER BY created_at`) as any[];
const b = raw.filter((r) => isScraperFingerprint(r.user_agent));
console.log("A burst rows", b.length, "of", raw.length, "in window");
const ips = tally(b.map((r) => String(r.ip ?? "")));
console.log("A distinct addresses", ips.length, "used once", ips.filter((x) => x[1] === 1).length, "twice", ips.filter((x) => x[1] === 2).length, "3+", ips.filter((x) => x[1] >= 3).length, "max per address", ips[0]?.[1]);
const v4 = ips.map((x) => x[0]).filter((x) => /^\d+\.\d+\.\d+\.\d+$/.test(x));
const n16 = tally(v4.map((x) => x.split(".").slice(0, 2).join(".")));
const n8 = tally(v4.map((x) => x.split(".")[0]));
console.log("A ipv4", v4.length, "ipv6/other", ips.length - v4.length, "distinct /16 networks", n16.length, "largest /16 holds", n16[0]?.[1], "top5 /16 sizes", n16.slice(0, 5).map((x) => x[1]), "distinct /8", n8.length);
console.log("A distinct browser strings", new Set(b.map((r) => r.user_agent)).size, "labels", tally(b.map((r) => String(r.browser_label ?? "?"))).slice(0, 8));
console.log("A os split", tally(b.map((r) => (/Windows/.test(r.user_agent) ? "Windows" : /Mac/.test(r.user_agent) ? "Mac" : "other"))));
console.log("A regions", tally(b.map((r) => String(r.region ?? "?"))).slice(0, 15), "distinct regions", new Set(b.map((r) => r.region)).size);
console.log("A visitor ids distinct", new Set(b.map((r) => r.visitor_id)).size, "null", b.filter((r) => !r.visitor_id).length);
console.log("A referrer hosts", tally(b.map((r) => host(String(r.referrer ?? "")))).slice(0, 8), "source", tally(b.map((r) => String(r.source ?? "(none)"))).slice(0, 5));
const kind = (p: string) => (p.startsWith("/bid/") ? "/bid/" : "/" + (p.split("/")[1] ?? ""));
console.log("A page kinds", tally(b.map((r) => kind(String(r.path)))).slice(0, 8));
const paths = tally(b.map((r) => String(r.path)));
console.log("A distinct pages", paths.length, "fetched once", paths.filter((x) => x[1] === 1).length, "max repeats", paths[0]?.[1]);
const t = b.map((r) => new Date(r.created_at).getTime());
const gaps = t.slice(1).map((x, i) => (x - t[i]) / 1000).sort((x, y) => x - y);
const pct = (p: number) => gaps[Math.floor(gaps.length * p)]?.toFixed(1);
console.log("A first", new Date(t[0]).toISOString(), "last", new Date(t[t.length - 1]).toISOString(), "gap seconds p10/p50/p90/max", pct(0.1), pct(0.5), pct(0.9), gaps[gaps.length - 1]?.toFixed(0));
const per5 = tally(t.map((x) => new Date(Math.floor(x / 300000) * 300000).toISOString().slice(11, 16))).sort((x, y) => x[0].localeCompare(y[0]));
console.log("A per 5 min (UTC)", per5.map((x) => `${x[0]}=${x[1]}`).join(" "));
const ids = b.map((r) => Number(String(r.path).match(/^\/bid\/(\d+)/)?.[1])).filter((n) => n > 0);
let asc = 0; for (let i = 1; i < ids.length; i++) if (ids[i] > ids[i - 1]) asc++;
console.log("A bid ids", ids.length, "share ascending steps", (asc / Math.max(1, ids.length - 1)).toFixed(2), "min", Math.min(...ids), "max", Math.max(...ids));

// B. Were the burst addresses ever seen outside the burst, or tied to an account? Counts only.
const ipList = ips.map((x) => x[0]).filter(Boolean);
await q("B same addresses outside the burst", async () => (await sql`SELECT count(*)::int views, count(DISTINCT ip)::int addresses, min(created_at) first, max(created_at) last,
  count(*) FILTER (WHERE user_id IS NOT NULL)::int signed_in_views FROM page_views WHERE ip = ANY(${ipList}) AND NOT (created_at >= '2026-11-05T17:00:00Z' AND created_at < '2026-11-05T19:00:00Z')`)[0]);
await q("B those outside views by day/kind", async () => (await sql`SELECT created_at::date d, count(*)::int n, count(DISTINCT ip)::int addresses FROM page_views WHERE ip = ANY(${ipList})
  AND NOT (created_at >= '2026-11-05T17:00:00Z' AND created_at < '2026-11-05T19:00:00Z') GROUP BY 1 ORDER BY 1 LIMIT 40`));

// C. Any BidBanana / The Bid Lab trace in our own records, all time. Counts only.
const pat = "%(bidbanana|bid banana|thebidlab|bid lab)%";
await q("C page_views mentioning them (referrer/browser/source/campaign)", async () => (await sql`SELECT count(*)::int n, min(created_at) first, max(created_at) last,
  count(*) FILTER (WHERE referrer SIMILAR TO ${pat})::int by_referrer, count(*) FILTER (WHERE lower(user_agent) SIMILAR TO ${pat})::int by_browser,
  count(*) FILTER (WHERE lower(coalesce(source,'')||' '||coalesce(campaign,'')||' '||coalesce(medium,'')) SIMILAR TO ${pat})::int by_tag
  FROM page_views WHERE lower(coalesce(referrer,'')) SIMILAR TO ${pat} OR lower(coalesce(user_agent,'')) SIMILAR TO ${pat} OR lower(coalesce(source,'')||' '||coalesce(campaign,'')||' '||coalesce(medium,'')) SIMILAR TO ${pat}`)[0]);
await q("C accounts with their email domain", async () => (await sql`SELECT count(*)::int n, min(created_at) first FROM users WHERE lower(email) SIMILAR TO ${pat}`)[0]);
await q("C radar leads with their email domain", async () => (await sql`SELECT count(*)::int n, min(created_at) first FROM radar_leads WHERE lower(email) SIMILAR TO ${pat}`)[0]);
await q("C leads with their email domain", async () => (await sql`SELECT count(*)::int n FROM leads WHERE lower(email) SIMILAR TO ${pat}`)[0]);
await q("C page_views signed in with their email", async () => (await sql`SELECT count(*)::int n FROM page_views WHERE lower(coalesce(user_email,'')) SIMILAR TO ${pat}`)[0]);
await q("C total page_views on record / since", async () => (await sql`SELECT count(*)::int n, min(created_at) first FROM page_views`)[0]);
