// Read-only probe: do other bid sites carry Contrax's hidden bid-page watermark or our wording of the
// bids the 2026-11-05 scraper read? One polite GET per page as ContraxBot; a refusal or bot check
// means stop for that site. Prints site names, counts and bid ids only (no IPs or browsers).
import { sql } from "~/db";
import { decodeWatermarks } from "~/lib/bid-watermark";
import { jobSummary } from "~/lib/bid-job-summary";
import { isScraperFingerprint } from "~/lib/scraper-evidence";
const URLS = [
  "https://publicbidtracker.com/georgia/open-bids/",
  "https://publicbidtracker.com/pennsylvania/open-bids/",
  "https://publicbidtracker.com/massachusetts/open-bids/",
  "https://publicbidtracker.com/texas/open-bids/",
  "https://publicbidtracker.com/north-carolina/open-bids/",
  "https://www.instantmarkets.com/q/mecklenburg_county",
  "https://www.instantmarkets.com/q/Boat",
  "https://bidbanana.com/closed-bids/alaska-construction-bids-rfp",
  "https://bidbanana.thebidlab.com/bid/pgfP6fhh2fYNoWHNjbvx",
  "https://contractradar.io/posts/5a4b2b7d-e731-400f-ae20-1603791ee656",
  "https://starbridge.ai/buyer/lower-saucon-township",
  "https://govdirections.com/rfp/glynn-county-georgia-annual-general-engineering-services-pool-multi-year-contract-1066790742",
  "https://bidscopeai.com/opportunities/8d8c669e-4094-4f0e-a379-66b8acc0f15c",
  "https://www.lightrfp.com/marketplace/bid/SEPTA-26-00236-AVZH%20GC/bristol-station-ada-improvements-gc",
  "https://www.govcb.com/government-bids/CHUGIAK-POOL-RENOVATION-22669341.htm",
];
const UA = "Mozilla/5.0 (compatible; ContraxBot/1.0; +https://www.contrax.company)";
const s = sql();
const pv = (await s`SELECT path, user_agent FROM page_views WHERE created_at BETWEEN '2026-11-05T17:00:00Z' AND '2026-11-05T19:00:00Z' AND path LIKE '/bid/%'`) as { path: string; user_agent: string | null }[];
const ids = [...new Set(pv.filter((r) => isScraperFingerprint(r.user_agent)).map((r) => Number(/^\/bid\/(\d+)/.exec(r.path)?.[1])).filter(Boolean))];
const bids = (await s`SELECT id, title, description FROM bids WHERE id = ANY(${ids})`) as { id: number; title: string; description: string | null }[];
const norm = (t: string) => t.toLowerCase().replace(/[⁠​‌]/g, "").replace(/&amp;/g, "&").replace(/<[^>]*>/g, " ").replace(/\s+/g, " ");
console.log(`scraped bids ${bids.length}`);
for (const url of URLS) {
  const host = new URL(url).host;
  let res: Response;
  try {
    res = await fetch(url, { headers: { "user-agent": UA, accept: "text/html" }, redirect: "follow", signal: AbortSignal.timeout(20000) });
  } catch (e) {
    console.log(`${host}: no answer (${(e as Error).name})`);
    continue;
  }
  const raw = await res.text();
  if (!res.ok || /just a moment|cf-chl|captcha/i.test(raw.slice(0, 5000))) {
    console.log(`${host} ${new URL(url).pathname}: HTTP ${res.status}${res.ok ? " bot check" : ""} (not read further)`);
    continue;
  }
  const marks = (raw.match(/⁠/g) ?? []).length;
  const zw = (raw.match(/[​‌]/g) ?? []).length;
  const tokens = decodeWatermarks(raw);
  const text = norm(raw);
  const titleHits = bids.filter((b) => b.title.length >= 18 && text.includes(norm(b.title)));
  const summaryHits = titleHits.filter((b) => {
    const sum = jobSummary(b.description, b.title);
    return sum && sum.length >= 60 && text.includes(norm(sum.slice(0, 80)));
  });
  console.log(`${host} ${new URL(url).pathname}: HTTP ${res.status}, ${raw.length} bytes, word-joiners ${marks}, zero-width ${zw}, watermark tokens ${tokens.length}, scraped-bid titles ${titleHits.length} [${titleHits.map((b) => b.id).join(",")}], with our summary text ${summaryHits.length} [${summaryHits.map((b) => b.id).join(",")}]`);
  if (tokens.length) {
    const rows = (await s`SELECT w.token, w.bid_id, w.created_at FROM bid_watermarks w WHERE w.token = ANY(${tokens})`) as { token: string; bid_id: number; created_at: Date }[];
    for (const r of rows) console.log(`   token matches Contrax bid ${r.bid_id}, served ${new Date(r.created_at).toISOString()}`);
    console.log(`   ${tokens.length - rows.length} token(s) not in our records`);
  }
}
process.exit(0);
// rerun
