import { mkdirSync, writeFileSync } from "node:fs";
// Read-only capture: Texas cities' public IonWave "Current Bid Opportunities" boards, fetched as
// ContraxBot, saved as test fixtures. Several host guesses for cities whose IonWave name is unknown.
const UA = "Mozilla/5.0 (compatible; ContraxBot/1.0; +https://www.contrax.company)";
const CANDIDATES: Record<string, string[]> = {
  plano: ["planotx"],
  irving: ["cityofirving"],
  georgetown: ["gtowntx"],
  pearland: ["pearland"],
  carrollton: ["carrolltontx", "cityofcarrollton", "carrollton", "carrollton-tx"],
  garland: ["garlandtx", "garland", "cityofgarland", "garland-tx", "gptx"],
  allen: ["cityofallen", "allentx", "allen"],
};
const dir = "src/jobs/sources/fixtures/tx-ionwave";
mkdirSync(dir, { recursive: true });
for (const [city, hosts] of Object.entries(CANDIDATES)) {
  for (const h of hosts) {
    const url = `https://${h}.ionwave.net/SourcingEvents.aspx?SourceType=1`;
    try {
      const r = await fetch(url, { headers: { "user-agent": UA }, redirect: "follow", signal: AbortSignal.timeout(20000) });
      const html = await r.text();
      const ok = r.status === 200 && html.includes("Current Bid Opportunities");
      const count = /<strong>(\d+)<\/strong>\s*items in\s*<strong>(\d+)<\/strong>\s*pages/i.exec(html);
      const org = /<title>([^<]*)<\/title>/i.exec(html)?.[1]?.trim();
      console.log(`${city} | ${h} | ${r.status} | board ${ok} | ${count ? `${count[1]} items, ${count[2]} pages` : "-"} | ${org ?? ""}`);
      if (ok) {
        writeFileSync(`${dir}/${h}-2026-11-09.html`, html);
        break;
      }
    } catch (e) {
      console.log(`${city} | ${h} | ERR ${(e as Error).message.slice(0, 60)}`);
    }
  }
}
