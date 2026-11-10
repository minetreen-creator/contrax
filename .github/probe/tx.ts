// Read-only, counts only: Texas construction Radar search after the certification fix (run 2).
import { sql } from "~/db";
import { defaultRadarMatches, fetchStrictRadarRows, radarGeoPasses, splitByGeography } from "~/lib/radar-candidates";
import { certMatches } from "~/lib/cert-matching";
import { isStrongTradeMatch } from "~/lib/trade-registry";
import { resolveBidState } from "~/lib/location-state";

for (const certId of ["sdvosb", "sb", "8a", "wosb", "hubzone"]) {
  try {
    const m = await defaultRadarMatches(sql, { trade: "construction", state: "TX", certId });
    const s = splitByGeography(m, "TX");
    console.log(`cert=${certId}: ${m.length} matches (${s.local.length} in Texas, ${s.nationwide.length} nationwide)`);
  } catch (e) { console.log(certId, "ERR", (e as Error).message.slice(0, 150)); }
}
// Where rows drop out, for the default certification the search box uses.
for (const certId of ["sdvosb", "sb"]) {
  const { rows, expansion } = await fetchStrictRadarRows(sql, { trade: "construction", state: "TX", certId });
  let cert = 0, geo = 0, strong = 0;
  const certOut: Record<string, number> = {};
  for (const r of rows) {
    const c = certMatches(r.set_aside, [r.source], certId as any);
    if (c !== "include") { const k = String(r.set_aside ?? "(none)").slice(0, 40); certOut[k] = (certOut[k] ?? 0) + 1; continue; }
    cert++;
    if (!radarGeoPasses(r, "TX")) continue;
    geo++;
    if (isStrongTradeMatch(String(r.title ?? ""), r.category ?? null, r.description ?? null, r.naics_code ?? null, expansion)) strong++;
  }
  console.log(`cert=${certId}: ${rows.length} keyword rows -> ${cert} pass cert -> ${geo} pass Texas -> ${strong} strong`);
  console.log("  cert drops by set-aside:", JSON.stringify(Object.entries(certOut).sort((a, b) => b[1] - a[1]).slice(0, 8)));
}
// Texas open bids overall, and how many have construction words in the title.
const open = (await sql()`SELECT title, location, agency, set_aside, source FROM bids WHERE due_date > NOW()`) as any[];
const tx = open.filter((b) => resolveBidState(b.location, b.agency) === "TX");
const re = /construct|renovat|repair|paving|resurfac|roof|hvac|mechanical|electric|plumb|demolition|concrete|bridge|drainage|building|facility|remodel/i;
const txc = tx.filter((b) => re.test(String(b.title ?? "")));
console.log(`open Texas bids: ${tx.length}; construction-type titles: ${txc.length}`);
const bySetAside: Record<string, number> = {};
for (const b of txc) { const k = b.set_aside ? String(b.set_aside).slice(0, 30) : "(none)"; bySetAside[k] = (bySetAside[k] ?? 0) + 1; }
console.log("  their set-asides:", JSON.stringify(Object.entries(bySetAside).sort((a, b) => b[1] - a[1]).slice(0, 8)));
const bySrc: Record<string, number> = {};
for (const b of txc) bySrc[String(b.source)] = (bySrc[String(b.source)] ?? 0) + 1;
console.log("  top sources:", JSON.stringify(Object.entries(bySrc).sort((a, b) => b[1] - a[1]).slice(0, 10)));
// Recent Texas construction searches (no visitor ids).
const log = (await sql()`SELECT cert, size_pref, matched, shown, related, created_at::date AS day FROM radar_search_log WHERE state = 'TX' AND LOWER(trade) LIKE '%construct%' ORDER BY created_at DESC LIMIT 12`) as any[];
for (const l of log) console.log(`  search ${String(l.day).slice(0, 10)} cert=${l.cert} size=${l.size_pref} matched=${l.matched} shown=${l.shown} related=${l.related}`);
