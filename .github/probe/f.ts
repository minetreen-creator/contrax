// TEMP read-only: where did the City of Dubuque's bid page go? ContraxBot UA, robots first, stop on 403.
const UA = "Mozilla/5.0 (compatible; ContraxBot/1.0; +https://www.contrax.company)";
const base = "https://www.cityofdubuque.org";
const get = async (path: string) => {
  const t0 = Date.now();
  try {
    const r = await fetch(path.startsWith("http") ? path : base + path, { headers: { "User-Agent": UA, Accept: "text/html,*/*" }, redirect: "follow", signal: AbortSignal.timeout(30_000) });
    const text = await r.text();
    const title = (/<title[^>]*>([^<]*)/i.exec(text)?.[1] ?? "").trim().slice(0, 80);
    console.log(`DBQ ${path} -> ${r.status} final=${r.url} bytes=${text.length} ${Date.now() - t0}ms title="${title}"`);
    return { status: r.status, text, url: r.url };
  } catch (e) { console.log(`DBQ ${path} FAILED ${(e as Error).message}`); return { status: 0, text: "", url: "" }; }
};
const robots = await get("/robots.txt");
if (robots.status === 403) { console.log("DBQ robots 403, stopped"); process.exit(0); }
console.log("DBQ robots: " + robots.text.split(/\r?\n/).filter((l) => /^(user-agent|disallow|allow|sitemap)/i.test(l)).slice(0, 25).join(" | "));
const home = await get("/");
if (home.status === 403) { console.log("DBQ home 403, stopped"); process.exit(0); }
const links = [...home.text.matchAll(/<a[^>]+href="([^"]+)"[^>]*>([\s\S]{0,120}?)<\/a>/gi)].map((m) => [m[1], m[2].replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim()]).filter(([h, t]) => /bid|rfp|procure|purchas|solicit/i.test(h + " " + t));
console.log("DBQ home links: " + JSON.stringify([...new Map(links.map((l) => [l[0], l])).values()].slice(0, 25)));
for (const p of ["/bids.aspx", "/Bids.aspx", "/Bids", "/bids", "/list.aspx", "/RFPs", "/Purchasing", "/CivicAlerts.aspx", "/sitemap.xml"]) {
  const r = await get(p);
  if (r.status === 403) { console.log("DBQ 403, stopped"); break; }
  if (r.status === 200 && /bid/i.test(p + r.text.slice(0, 4000))) {
    const l2 = [...r.text.matchAll(/href="([^"]*(?:bid|rfp|procure|purchas|solicit)[^"]*)"/gi)].map((m) => m[1]);
    console.log(`DBQ   links on ${p}: ${JSON.stringify([...new Set(l2)].slice(0, 15))}`);
  }
  await new Promise((r) => setTimeout(r, 1200));
}
process.exit(0);
