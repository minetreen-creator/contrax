// Read-only: how does Metro Nashville's public "current bidding opportunities" page (Oracle Fusion
// Sourcing, Negotiation Abstracts) publish its list? Saves the HTML as a fixture. No login.
import { mkdirSync, writeFileSync } from "node:fs";
const URL0 = "https://ibqhjb.fa.ocs.oraclecloud.com/fscmUI/faces/NegotiationAbstracts?prcBuId=300000006739049";
const dir = "src/jobs/sources/fixtures/tn-nashville-oracle"; mkdirSync(dir, { recursive: true });
const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36";
let url = URL0; let cookies = "";
for (let hop = 0; hop < 6; hop++) {
  const r = await fetch(url, { headers: { "user-agent": UA, accept: "text/html,application/xhtml+xml", cookie: cookies }, redirect: "manual", signal: AbortSignal.timeout(30000) });
  const set = r.headers.getSetCookie?.() ?? [];
  if (set.length) cookies = [cookies, ...set.map((c) => c.split(";")[0])].filter(Boolean).join("; ");
  const b = await r.text();
  console.log(`hop ${hop}: ${r.status} ${url.slice(0, 160)} bytes=${b.length} location=${(r.headers.get("location") ?? "-").slice(0, 160)} cookies=${set.length}`);
  writeFileSync(`${dir}/hop${hop}.html`, b);
  const loc = r.headers.get("location");
  const loop = /_afrLoop=(\d+)/.exec(b)?.[1];
  if (loc) { url = new URL(loc, url).href; continue; }
  if (loop && !url.includes("_afrLoop")) { url = URL0 + "&_afrLoop=" + loop; continue; }
  const text = b.replace(/<script[\s\S]*?<\/script>/gi, " ").replace(/<[^>]+>/g, " ").replace(/\s+/g, " ");
  console.log("title:", /<title>([^<]*)<\/title>/i.exec(b)?.[1]);
  for (const k of ["Negotiation", "Close Date", "Title", "Invitation", "RFP", "ITB", "Bid"]) { const i = text.indexOf(k); console.log(k, "=>", i < 0 ? "-" : text.slice(Math.max(0, i - 80), i + 220)); }
  break;
}
process.exit(0);
