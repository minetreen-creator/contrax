// Temporary look (owner 2026-11-03: "3" = add Houston's and San Antonio's own
// bid sites). robots.txt and the public bid list pages only; no logins, no
// detail pages or documents.
import { mkdirSync, writeFileSync } from "node:fs";
const UA = "Mozilla/5.0 (compatible; ContraxBot/1.0; +https://www.contrax.company)";
const dir = "src/jobs/sources/fixtures/tx-big-cities";
mkdirSync(dir, { recursive: true });
const log: string[] = [];
const urls: [string, string][] = [
  ["houston-purchasing-robots.txt", "https://purchasing.houstontx.gov/robots.txt"],
  ["houston-www-robots.txt", "https://www.houstontx.gov/robots.txt"],
  ["houston-bids.html", "https://purchasing.houstontx.gov/bids.html"],
  ["houston-purchasing-home.html", "https://purchasing.houstontx.gov/"],
  ["houston-obo-current.html", "https://www.houstontx.gov/obo/current_contracting_opportunities.html"],
  ["sa-webapp1-robots.txt", "https://webapp1.sanantonio.gov/robots.txt"],
  ["sa-www-robots.txt", "https://www.sa.gov/robots.txt"],
  ["sa-bidcontractopps.html", "https://webapp1.sanantonio.gov/BidContractOpps/Default.aspx"],
  ["sa-bidcontractopps-root.html", "https://webapp1.sanantonio.gov/BidContractOpps/"],
  ["sa-bidding-contracting.html", "https://www.sa.gov/Directory/Departments/Finance/About/Divisions/Procurement/Bidding-Contracting"],
];
for (const [name, url] of urls) {
  try {
    const r = await fetch(url, { headers: { "user-agent": UA, accept: "text/html,*/*" }, redirect: "follow", signal: AbortSignal.timeout(25000) });
    const b = await r.text();
    log.push(`${url} | ${r.status} | final=${r.url} | ${b.length} | ${r.headers.get("content-type")}`);
    writeFileSync(`${dir}/${name}`, b.slice(0, 3_000_000));
  } catch (e) { log.push(`${url} | ERR ${String(e).slice(0, 120)}`); }
  await new Promise((r) => setTimeout(r, 2000));
}
writeFileSync(`${dir}/look.txt`, log.join("\n") + "\n");
console.log(log.join("\n"));
