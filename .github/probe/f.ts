// Temp probe: find county CivicEngage bid boards we don't read yet. robots.txt respected; read-only; one
// request per candidate (plus robots on a hit). Prints hits only. Removed after.
import { readFileSync } from "node:fs";
import { parseCivicEngageBoard, CIVICENGAGE_NOT_A_BID_GROUP } from "../../src/jobs/sources/civicengage-bids";
const UA = "Mozilla/5.0 (compatible; ContraxBot/1.0; +https://www.contrax.company)";
const counties = JSON.parse(readFileSync("src/lib/local-awards/counties.json", "utf8")) as { fips: string; state: string; name: string }[];
const known = new Set(readFileSync(".github/probe/known-hosts.txt", "utf8").split("\n").filter(Boolean));
const slug = (n: string) => n.toLowerCase().replace(/\b(county|parish|borough|census area|city and borough|municipality)\b/g, "").replace(/[^a-z]/g, "");
const cands: { host: string; county: string; state: string; fips: string }[] = [];
for (const c of counties) {
  if (/ city$/i.test(c.name)) continue; // independent cities: no reliable pattern
  const s = slug(c.name); const st = c.state.toLowerCase();
  if (!s) continue;
  const kind = /parish/i.test(c.name) ? "parish" : "county";
  for (const h of [`www.${s}${kind}${st}.gov`, `www.${s}${kind}.org`, `www.co.${s}.${st}.us`, `www.${s}${kind}.gov`, `www.${s}${kind}${st}.org`]) {
    if (known.has(h.replace(/^www\./, ""))) continue;
    cands.push({ host: h, county: c.name, state: c.state, fips: c.fips });
  }
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
    const res = parseCivicEngageBoard(r.text, { source: "probe", endpoint: `https://${finalHost}/bids.aspx`, host: finalHost, agency: c.county, location: `${c.county}, ${c.state}`, idPrefix: "probe", excludeGroup: CIVICENGAGE_NOT_A_BID_GROUP }, now);
    open = res.rows.length;
  } catch (e) { open = -2; }
  hits++;
  console.log("HIT", JSON.stringify({ fips: c.fips, county: c.county, state: c.state, host: finalHost, open, robotsBlocked: blocked }));
}
let i = 0;
await Promise.all(Array.from({ length: 40 }, async () => { while (i < cands.length) { const c = cands[i++]!; await check(c); } }));
console.log("DONE", done, "hits", hits);
process.exit(0);
