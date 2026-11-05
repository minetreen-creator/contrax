// Temporary capture: Connecticut town bid boards (owner 2026-11-05: CT landscaping visitor).
// CivicEngage bids.aspx and Bonfire public open-opportunities only. A board is kept
// only when live; a second fetch 6 s later confirms it. No logins, detail pages or documents.
import { mkdirSync, writeFileSync } from "node:fs";
const H = { "user-agent": "Mozilla/5.0 (compatible; ContraxBot/1.0; +https://www.contrax.company)", accept: "application/json, text/html", "x-requested-with": "XMLHttpRequest" };
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const D = "2026-11-05";
const OUT = "src/jobs/sources/fixtures/ct-capture";
mkdirSync(OUT, { recursive: true });
const towns = "Andover,Ansonia,Ashford,Avon,Barkhamsted,Beacon Falls,Berlin,Bethany,Bethel,Bethlehem,Bloomfield,Bolton,Bozrah,Branford,Bridgeport,Bridgewater,Bristol,Brookfield,Brooklyn,Burlington,Canaan,Canterbury,Canton,Chaplin,Cheshire,Chester,Clinton,Colchester,Colebrook,Columbia,Cornwall,Coventry,Cromwell,Danbury,Darien,Deep River,Derby,Durham,East Granby,East Haddam,East Hampton,East Hartford,East Haven,East Lyme,East Windsor,Eastford,Easton,Ellington,Enfield,Essex,Fairfield,Farmington,Franklin,Glastonbury,Goshen,Granby,Greenwich,Griswold,Groton,Guilford,Haddam,Hamden,Hampton,Hartford,Hartland,Harwinton,Hebron,Kent,Killingly,Killingworth,Lebanon,Ledyard,Lisbon,Litchfield,Lyme,Madison,Manchester,Mansfield,Marlborough,Meriden,Middlebury,Middlefield,Middletown,Milford,Monroe,Montville,Morris,Naugatuck,New Britain,New Canaan,New Fairfield,New Hartford,New Haven,New London,New Milford,Newington,Newtown,Norfolk,North Branford,North Canaan,North Haven,North Stonington,Norwalk,Norwich,Old Lyme,Old Saybrook,Orange,Oxford,Plainfield,Plainville,Plymouth,Pomfret,Portland,Preston,Prospect,Putnam,Redding,Ridgefield,Rocky Hill,Roxbury,Salem,Salisbury,Scotland,Seymour,Sharon,Shelton,Sherman,Simsbury,Somers,South Windsor,Southbury,Southington,Sprague,Stafford,Stamford,Sterling,Stonington,Stratford,Suffield,Thomaston,Thompson,Tolland,Torrington,Trumbull,Union,Vernon,Voluntown,Wallingford,Warren,Washington,Waterbury,Waterford,Watertown,West Hartford,West Haven,Westbrook,Weston,Westport,Wethersfield,Willington,Wilton,Winchester,Windham,Windsor,Windsor Locks,Wolcott,Woodbridge,Woodbury,Woodstock".split(",");
console.log("towns:", towns.length);
const slug = (t: string) => t.toLowerCase().replace(/[^a-z]/g, "");
const hosts = towns.flatMap((t) => { const s = slug(t); return [`www.${s}ct.gov`, `www.${s}-ct.gov`, `www.${s}ct.org`, `www.${s}-ct.org`, `www.townof${s}.com`, `www.townof${s}ct.org`, `www.${s}.ct.us`, `www.${s}ct.com`]; });
const tenants = ["hartford","cityofhartford","hartfordct","newhaven","cityofnewhaven","newhavenct","bridgeport","bridgeportct","waterbury","waterburyct","stamford","danbury","norwalk","newbritain","westhartford","greenwich","hamden","manchesterct","uconn","ctdot","ctstate","ccsu","scsu","wcsu","ecsu","bristolct","meriden","milfordct","middletownct","shelton","stratford","westhaven","eastHartford".toLowerCase(),"ctwater","mdc","cttransit","ctrides"];
async function pool<T>(items: T[], n: number, fn: (x: T) => Promise<void>) {
  let i = 0;
  await Promise.all(Array.from({ length: n }, async () => { while (i < items.length) { const x = items[i++]; await fn(x); } }));
}
const bl: string[] = [];
async function bonfire() {
  await pool(tenants, 3, async (t) => {
    const host = `https://${t}.bonfirehub.com`;
    try {
      const r1 = await fetch(`${host}/PublicPortal/getOpenPublicOpportunitiesSectionData`, { headers: H, signal: AbortSignal.timeout(20000) });
      const b1 = r1.ok ? await r1.text() : `HTTP ${r1.status}`;
      let open = -1;
      try { open = Object.keys(JSON.parse(b1).payload.projects).length; } catch {}
      if (open < 0) { bl.push(`${t} | open=-1`); await sleep(300); return; }
      const page = await (await fetch(`${host}/portal/?tab=openOpportunities`, { headers: H, signal: AbortSignal.timeout(20000) })).text();
      const title = (/<title>([^<]*)<\/title>/i.exec(page)?.[1] ?? "").trim();
      await sleep(6000);
      const r2 = await fetch(`${host}/PublicPortal/getOpenPublicOpportunitiesSectionData`, { headers: H, signal: AbortSignal.timeout(20000) });
      const b2 = r2.ok ? await r2.text() : `HTTP ${r2.status}`;
      bl.push(`${t} | title=${title} | open=${open} | same=${b1 === b2}`);
      if (open > 0) {
        const dir = `src/jobs/sources/fixtures/county-bonfire/${t}`;
        mkdirSync(dir, { recursive: true });
        writeFileSync(`${dir}/open-${D}-fetch1.json`, b1);
        writeFileSync(`${dir}/open-${D}-fetch2.json`, b2);
      }
    } catch (e) { bl.push(`${t} | ERR ${String(e).slice(0, 80)}`); }
    await sleep(300);
  });
}
const cl: string[] = [];
const seenFinal = new Set<string>();
async function civic() {
  await pool([...new Set(hosts)], 12, async (h) => {
    try {
      const r = await fetch(`https://${h}/bids.aspx`, { headers: { "user-agent": H["user-agent"], accept: "text/html" }, redirect: "follow", signal: AbortSignal.timeout(12000) });
      const b1 = await r.text();
      const isCivic = b1.includes('<div class="bidItems listItems">');
      const items = (b1.match(/class="bidTitle"|BidDetail\.aspx|bids\.aspx\?bidID=/gi) ?? []).length;
      const finalHost = new URL(r.url).host;
      cl.push(`${h} | status=${r.status} | final=${finalHost} | civicengage=${isCivic} | itemsLinks=${items}`);
      if (isCivic && !seenFinal.has(finalHost)) {
        seenFinal.add(finalHost);
        await sleep(6000);
        const b2 = await (await fetch(`https://${finalHost}/bids.aspx`, { headers: { "user-agent": H["user-agent"], accept: "text/html" }, redirect: "follow", signal: AbortSignal.timeout(20000) })).text();
        const dir = `src/jobs/sources/fixtures/county-civicengage/${finalHost.replace(/^www\./, "").replace(/\./g, "-")}`;
        mkdirSync(dir, { recursive: true });
        writeFileSync(`${dir}/open-${D}-fetch1.html`, b1);
        writeFileSync(`${dir}/open-${D}-fetch2.html`, b2);
      }
    } catch { /* no such host */ }
    await sleep(100);
  });
}
await Promise.all([bonfire(), civic()]);
writeFileSync(`${OUT}/bonfire-${D}.txt`, bl.join("\n") + "\n");
writeFileSync(`${OUT}/civicengage-${D}.txt`, cl.join("\n") + "\n");
console.log(bl.filter((l) => !l.includes("open=-1")).join("\n"));
console.log(cl.filter((l) => l.includes("civicengage=true")).join("\n"));
process.exit(0);
