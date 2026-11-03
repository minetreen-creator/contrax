// Temporary look, pass 2 (owner 2026-11-03: "3"). Houston's Beacon open
// solicitations and Public Works bid sets (robots.txt + public list pages), and
// San Antonio's list page 2 (the grid's own "Page$2" postback, as a person's
// click). No logins, no detail pages or documents.
import { mkdirSync, writeFileSync } from "node:fs";
const UA = "Mozilla/5.0 (compatible; ContraxBot/1.0; +https://www.contrax.company)";
const dir = "src/jobs/sources/fixtures/tx-big-cities";
mkdirSync(dir, { recursive: true });
const log: string[] = [];
const get = async (name: string, url: string, init: RequestInit = {}) => {
  try {
    const r = await fetch(url, { ...init, headers: { "user-agent": UA, accept: "text/html,application/json,*/*", ...(init.headers ?? {}) }, redirect: "follow", signal: AbortSignal.timeout(25000) });
    const b = await r.text();
    log.push(`${url} | ${r.status} | final=${r.url} | ${b.length} | ${r.headers.get("content-type")}`);
    writeFileSync(`${dir}/${name}`, b.slice(0, 3_000_000));
    return b;
  } catch (e) { log.push(`${url} | ERR ${String(e).slice(0, 120)}`); return ""; }
};
const pause = () => new Promise((r) => setTimeout(r, 2000));
await get("beacon-robots.txt", "https://www.beaconbid.com/robots.txt"); await pause();
await get("beacon-houston-open.html", "https://www.beaconbid.com/solicitations/city-of-houston/open"); await pause();
await get("hpw-bidsets-robots.txt", "https://bidsets.publicworks.houstontx.gov/robots.txt"); await pause();
await get("hpw-bidsets.html", "https://bidsets.publicworks.houstontx.gov/"); await pause();
const p1 = await get("sa-page1.html", "https://webapp1.sanantonio.gov/BidContractOpps/Default.aspx"); await pause();
const field = (n: string) => (new RegExp(`id="${n}" value="([^"]*)"`).exec(p1)?.[1] ?? "");
const body = new URLSearchParams({
  __EVENTTARGET: "ctl00$ContentPlaceHolder1$gvBidContractOpps", __EVENTARGUMENT: "Page$2",
  __VIEWSTATE: field("__VIEWSTATE").replace(/&#43;/g, "+"), __VIEWSTATEGENERATOR: field("__VIEWSTATEGENERATOR"), __EVENTVALIDATION: field("__EVENTVALIDATION").replace(/&#43;/g, "+"),
});
await get("sa-page2.html", "https://webapp1.sanantonio.gov/BidContractOpps/Default.aspx", { method: "POST", body, headers: { "content-type": "application/x-www-form-urlencoded" } });
writeFileSync(`${dir}/look2.txt`, log.join("\n") + "\n");
console.log(log.join("\n"));
