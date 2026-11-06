// Read-only: follow Oracle ADF's loopback step for Metro Nashville's public Negotiation Abstracts page
// (the same parameters the page's own script adds), then save what comes back. No login.
import { mkdirSync, writeFileSync } from "node:fs";
const URL0 = "https://ibqhjb.fa.ocs.oraclecloud.com/fscmUI/faces/NegotiationAbstracts?prcBuId=300000006739049";
const dir = "src/jobs/sources/fixtures/tn-nashville-oracle"; mkdirSync(dir, { recursive: true });
const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36";
let cookies = "";
const get = async (u: string) => {
  const r = await fetch(u, { headers: { "user-agent": UA, accept: "text/html,application/xhtml+xml", cookie: cookies }, redirect: "manual", signal: AbortSignal.timeout(30000) });
  const set = r.headers.getSetCookie?.() ?? [];
  if (set.length) cookies = [cookies, ...set.map((c) => c.split(";")[0])].filter(Boolean).join("; ");
  return { r, b: await r.text() };
};
const h0 = await get(URL0);
const loop = /"_afrLoop", *"(\d+)"/.exec(h0.b)?.[1];
console.log("hop0", h0.r.status, h0.b.length, "loop", loop);
const params = new URLSearchParams({ _afrLoop: loop ?? "", _afrWindowMode: "0", _afrWindowId: "null", _afrMT: "all", _afrFS: "16", _afrMFW: "1280", _afrMFH: "900", _afrMFDW: "1280", _afrMFDH: "900", _afrMFC: "8", _afrMFCI: "0", _afrMFM: "0", _afrMFR: "96", _afrMFG: "0", _afrMFS: "0", _afrMFO: "0" });
let u = `${URL0}&${params}`;
for (let hop = 1; hop < 5; hop++) {
  const { r, b } = await get(u);
  writeFileSync(`${dir}/hop${hop}.html`, b);
  const loc = r.headers.get("location");
  console.log(`hop${hop}`, r.status, b.length, "location", (loc ?? "-").slice(0, 160));
  if (loc) { u = new URL(loc, u).href; continue; }
  const text = b.replace(/<script[\s\S]*?<\/script>/gi, " ").replace(/<[^>]+>/g, " ").replace(/&nbsp;/g, " ").replace(/\s+/g, " ");
  writeFileSync(`${dir}/hop${hop}.txt`, text);
  console.log("title:", /<title>([^<]*)<\/title>/i.exec(b)?.[1]);
  for (const k of ["Negotiation", "Close Date", "Title", "Open Date", "RFQ", "RFP", "ITB", "Construction"]) { const i = text.indexOf(k); console.log(k, "=>", i < 0 ? "-" : text.slice(Math.max(0, i - 100), i + 300)); }
  break;
}
process.exit(0);
