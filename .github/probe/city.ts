// Temp probe: find city CivicEngage bid boards (Census population estimates, places of 8,000+) we don't read yet. robots.txt respected; read-only; one
// request per candidate (plus robots on a hit). Prints hits only. Removed after.
import { readFileSync } from "node:fs";
import { parseCivicEngageBoard, CIVICENGAGE_NOT_A_BID_GROUP } from "../../src/jobs/sources/civicengage-bids";
const UA = "Mozilla/5.0 (compatible; ContraxBot/1.0; +https://www.contrax.company)";
const known = new Set(readFileSync(".github/probe/known-hosts.txt", "utf8").split("\n").filter(Boolean));
const ST: Record<string, string> = { Alabama:"AL",Alaska:"AK",Arizona:"AZ",Arkansas:"AR",California:"CA",Colorado:"CO",Connecticut:"CT",Delaware:"DE",Florida:"FL",Georgia:"GA",Hawaii:"HI",Idaho:"ID",Illinois:"IL",Indiana:"IN",Iowa:"IA",Kansas:"KS",Kentucky:"KY",Louisiana:"LA",Maine:"ME",Maryland:"MD",Massachusetts:"MA",Michigan:"MI",Minnesota:"MN",Mississippi:"MS",Missouri:"MO",Montana:"MT",Nebraska:"NE",Nevada:"NV","New Hampshire":"NH","New Jersey":"NJ","New Mexico":"NM","New York":"NY","North Carolina":"NC","North Dakota":"ND",Ohio:"OH",Oklahoma:"OK",Oregon:"OR",Pennsylvania:"PA","Rhode Island":"RI","South Carolina":"SC","South Dakota":"SD",Tennessee:"TN",Texas:"TX",Utah:"UT",Vermont:"VT",Virginia:"VA",Washington:"WA","West Virginia":"WV",Wisconsin:"WI",Wyoming:"WY" };
const csv = readFileSync("/tmp/sub-est.csv", "latin1").split(/\r?\n/);
const head = csv[0]!.split(",");
const iS = head.indexOf("SUMLEV"), iN = head.indexOf("NAME"), iSt = head.indexOf("STNAME"), iP = head.findIndex((h) => /^POPESTIMATE20\d\d$/.test(h));
const places = new Map<string, { name: string; state: string; pop: number }>();
for (const line of csv.slice(1)) {
  const f = line.split(",");
  if (f[iS] !== "162") continue; // incorporated places
  const st = ST[f[iSt]!]; const pop = Number(f[head.lastIndexOf(head.filter((h) => /^POPESTIMATE20\d\d$/.test(h)).pop()!)]);
  if (!st || !(pop >= 8000)) continue;
  const name = f[iN]!.replace(/ (city|town|village|borough|municipality|township|CDP)( \(balance\))?$/i, "").trim();
  places.set(`${name}|${st}`, { name, state: st, pop });
}
console.log("PLACES", places.size, iP);
const slug = (n: string) => n.toLowerCase().replace(/^st\.? /, "saint").replace(/[^a-z]/g, "");
const slug2 = (n: string) => n.toLowerCase().replace(/[^a-z]/g, "");
const cands: { host: string; county: string; state: string; fips: string }[] = [];
for (const p of places.values()) {
  const st = p.state.toLowerCase();
  const hs = new Set<string>();
  for (const s of new Set([slug(p.name), slug2(p.name)])) {
    for (const h of [`www.${s}${st}.gov`, `www.cityof${s}.com`, `www.cityof${s}.org`, `www.${s}.gov`, `www.${s}${st}.org`, `www.cityof${s}${st}.gov`]) hs.add(h);
  }
  for (const h of hs) if (!known.has(h.replace(/^www\./, ""))) cands.push({ host: h, county: p.name, state: p.state, fips: String(p.pop) });
}
console.log("CANDIDATES", cands.length);
const get = async (u: string, ms = 9000) => { try { const r = await fetch(u, { headers: { "User-Agent": UA }, redirect: "follow", signal: AbortSignal.timeout(ms) }); return { status: r.status, url: r.url, text: r.ok ? await r.text() : "" }; } catch { return { status: 0, url: u, text: "" }; } };
const disallowed = (robots: string, path: string) => { let on = false; for (const raw of robots.split(/\r?\n/)) { const l = raw.replace(/#.*/, "").trim(); const [k, ...v] = l.split(":"); const val = v.join(":").trim(); if (/^user-agent$/i.test(k ?? "")) on = val === "*" || /contraxbot/i.test(val); else if (on && /^disallow$/i.test(k ?? "") && val && (val === "/" || path.toLowerCase().startsWith(val.toLowerCase()))) return true; } return false; };
const seen = new Set<string>(); let done = 0, hits = 0;
const now = Date.now();
async function check(c: (typeof cands)[number]) {
  const r = await get(`https://${c.host}/bids.aspx`);
  done++;
  if (r.status !== 200 || !/bidID=/i.test(r.text)) return;
  const finalHost = new URL(r.url).host;
  if (seen.has(finalHost) || known.has(finalHost.replace(/^www\./, ""))) return;
  seen.add(finalHost);
  const robots = await get(`https://${finalHost}/robots.txt`, 6000);
  const blocked = disallowed(robots.text, "/bids.aspx");
  let open = -1;
  try {
    const res = parseCivicEngageBoard(r.text, { source: "probe", endpoint: `https://${finalHost}/bids.aspx`, host: finalHost, agency: `City of ${c.county}`, location: `${c.county}, ${c.state}`, idPrefix: "probe", excludeGroup: CIVICENGAGE_NOT_A_BID_GROUP }, now);
    open = res.rows.length;
  } catch (e) { open = -2; }
  hits++;
  console.log("HIT", JSON.stringify({ pop: c.fips, city: c.county, state: c.state, host: finalHost, open, robotsBlocked: blocked }));
}
let i = 0;
await Promise.all(Array.from({ length: 40 }, async () => { while (i < cands.length) { const c = cands[i++]!; await check(c); } }));
console.log("DONE", done, "hits", hits);
process.exit(0);
