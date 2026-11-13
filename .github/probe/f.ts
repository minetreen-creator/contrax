// Read-only discovery: which candidate Bonfire tenants have a public open-opportunities list. Removed after.
import { readFileSync } from "node:fs";
import { BONFIRE_USER_AGENT } from "../../src/jobs/sources/bonfire-public";
const cands: string[] = JSON.parse(readFileSync(".github/probe/cands.json", "utf8"));
const robots = await (await fetch("https://www.bonfirehub.com/robots.txt", { headers: { "User-Agent": BONFIRE_USER_AGENT } })).text().catch(() => "");
console.log("robots www:", robots.slice(0, 400).replace(/\n/g, " | "));
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
let hits = 0, n = 0;
for (const c of cands) {
  n++;
  const host = `https://${c}.bonfirehub.com`;
  try {
    const r = await fetch(`${host}/PublicPortal/getOpenPublicOpportunitiesSectionData?_=${Date.now()}`, {
      headers: { "User-Agent": BONFIRE_USER_AGENT, Accept: "application/json", Referer: `${host}/portal/?tab=openOpportunities` },
      redirect: "manual", signal: AbortSignal.timeout(20000),
    });
    if (r.status === 200) {
      const j: any = await r.json().catch(() => null);
      const projects = Object.values(j?.payload?.projects ?? j?.projects ?? {}) as any[];
      if (j) {
        const open = projects.filter((p) => String(p.ProjectStatusID) === "2" && Date.parse(String(p.DateClose).replace(" ", "T") + "Z") > Date.now()).length;
        const pr = await fetch(`${host}/portal/?tab=openOpportunities`, { headers: { "User-Agent": BONFIRE_USER_AGENT }, signal: AbortSignal.timeout(20000) }).then((x) => x.text()).catch(() => "");
        const title = pr.match(/<title>([^<]*)/i)?.[1]?.trim();
        console.log(`HIT ${c} open=${open} total=${projects.length} title=${title}`);
        hits++;
        await sleep(1200);
      }
    } else if (r.status === 429 || r.status === 403) {
      console.log(`STOP ${c} status=${r.status}`); break;
    }
  } catch (e) { /* no tenant */ }
  if (n % 250 === 0) console.log(`progress ${n}/${cands.length} hits=${hits}`);
  await sleep(1100);
}
console.log(`DONE ${n} checked, ${hits} tenants`);
