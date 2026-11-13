// Read-only: BidNet Direct open-bid totals per state group (one page each, 3 s apart) and sub-group links. Removed after.
const UA = "Mozilla/5.0 (compatible; ContraxBot/1.0; +https://www.contrax.company)";
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const rb = await fetch("https://www.bidnetdirect.com/robots.txt", { headers: { "User-Agent": UA } });
const rt = await rb.text();
console.log("robots", rb.status, rt.slice(0, 700).replace(/\n/g, " | "));
const slugs = ["michigan", "mitn", "wyoming", "florida", "north-carolina", "new-jersey", "arizona", "texas", "georgia", "tennessee", "indiana", "alabama", "oklahoma"];
for (const s of slugs) {
  await sleep(3000);
  try {
    const r = await fetch(`https://www.bidnetdirect.com/${s}/solicitations/open-bids`, { headers: { "User-Agent": UA }, redirect: "follow", signal: AbortSignal.timeout(30000) });
    const h = await r.text();
    const total = h.match(/([\d,]+)\s+Open Solicitations/i)?.[1];
    const title = h.match(/<title>([^<]*)/i)?.[1]?.trim();
    const subs = [...new Set([...h.matchAll(new RegExp(`href="/(${s}/[a-z0-9-]+)"`, "g"))].map((m) => m[1]))].filter((x) => !/solicitations|login|register|about|contact/.test(x)).slice(0, 30);
    console.log(`GROUP ${s} ${r.status} final=${r.url.replace("https://www.bidnetdirect.com", "")} total=${total} title=${title}`);
    if (subs.length) console.log(`  subgroups: ${subs.join(" ")}`);
    if (r.status === 403 || r.status === 429) { console.log("STOP"); break; }
  } catch (e) { console.log(`GROUP ${s} ERR ${(e as Error).message}`); }
}
