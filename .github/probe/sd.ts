// Temp probe: school district Bonfire portals we don't read yet. One request per guess, one at a time,
// 1.2 s apart (gentle on one platform). Public JSON list only; prints hits with department names so each
// tenant can be checked by hand. Removed after.
import { readFileSync } from "node:fs";
const UA = "Mozilla/5.0 (compatible; ContraxBot/1.0; +https://www.contrax.company)";
const known = new Set(readFileSync(".github/probe/known-bonfire.txt", "utf8").split("\n").filter(Boolean));
const ST: Record<string, string> = { Alabama:"AL",Alaska:"AK",Arizona:"AZ",Arkansas:"AR",California:"CA",Colorado:"CO",Connecticut:"CT",Delaware:"DE",Florida:"FL",Georgia:"GA",Hawaii:"HI",Idaho:"ID",Illinois:"IL",Indiana:"IN",Iowa:"IA",Kansas:"KS",Kentucky:"KY",Louisiana:"LA",Maine:"ME",Maryland:"MD",Massachusetts:"MA",Michigan:"MI",Minnesota:"MN",Mississippi:"MS",Missouri:"MO",Montana:"MT",Nebraska:"NE",Nevada:"NV","New Hampshire":"NH","New Jersey":"NJ","New Mexico":"NM","New York":"NY","North Carolina":"NC","North Dakota":"ND",Ohio:"OH",Oklahoma:"OK",Oregon:"OR",Pennsylvania:"PA","Rhode Island":"RI","South Carolina":"SC","South Dakota":"SD",Tennessee:"TN",Texas:"TX",Utah:"UT",Vermont:"VT",Virginia:"VA",Washington:"WA","West Virginia":"WV",Wisconsin:"WI",Wyoming:"WY" };
const csv = readFileSync("/tmp/sub-est.csv", "latin1").split(/\r?\n/);
const head = csv[0]!.split(",");
const iS = head.indexOf("SUMLEV"), iN = head.indexOf("NAME"), iSt = head.indexOf("STNAME");
const iP = head.lastIndexOf(head.filter((h) => /^POPESTIMATE20\d\d$/.test(h)).pop()!);
const cities: { name: string; st: string; pop: number }[] = [];
for (const line of csv.slice(1)) {
  const f = line.split(",");
  if (f[iS] !== "162") continue;
  const st = ST[f[iSt]!]; const pop = Number(f[iP]);
  if (!st || !(pop >= 90000)) continue;
  cities.push({ name: f[iN]!.replace(/ (city|town|village|borough|municipality|township)( \(balance\))?$/i, "").trim(), st, pop });
}
cities.sort((a, b) => b.pop - a.pop);
const counties = (JSON.parse(readFileSync("src/lib/local-awards/counties.json", "utf8")) as { state: string; name: string }[])
  .filter((c) => ["FL", "GA", "NC", "SC", "TN", "AL", "VA", "MD", "KY", "WV", "LA", "MS", "NV", "UT"].includes(c.state));
const s = (n: string) => n.toLowerCase().replace(/[^a-z]/g, "");
const guesses = new Map<string, string>();
for (const c of cities) {
  const b = s(c.name);
  const pats = c.st === "TX" ? [`${b}isd`] : c.st === "CA" ? [`${b}usd`, `${b}unified`] : [`${b}schools`, `${b}publicschools`];
  for (const p of pats) guesses.set(p, `${c.name}, ${c.st}`);
}
for (const c of counties) {
  const b = s(c.name.replace(/ (County|Parish)$/i, ""));
  for (const p of [`${b}countyschools`, `${b}schools`]) if (!guesses.has(p)) guesses.set(p, `${c.name}, ${c.state}`);
}
const list = [...guesses].filter(([g]) => !known.has(g));
console.log("GUESSES", list.length);
let hits = 0;
for (const [slug, where] of list) {
  try {
    const r = await fetch(`https://${slug}.bonfirehub.com/PublicPortal/getOpenPublicOpportunitiesSectionData`, { headers: { "User-Agent": UA, Accept: "application/json" }, redirect: "manual", signal: AbortSignal.timeout(10000) });
    if (r.status === 403 || r.status === 429) { console.log("STOP", slug, r.status); break; }
    if (r.status === 200) {
      const t = await r.text();
      if (t.trim().startsWith("{")) {
        const j = JSON.parse(t);
        const projects = Object.values(j?.payload?.projects ?? {}) as any[];
        const depts = Object.values(j?.payload?.departments ?? {}).map((d: any) => d?.DepartmentName ?? d?.Name).filter(Boolean).slice(0, 4);
        const open = projects.filter((p) => String(p?.ProjectStatusID) === "2").length;
        hits++;
        console.log("HIT", JSON.stringify({ slug, where, open, depts, sample: projects[0]?.ProjectName ?? null }));
      }
    }
  } catch {}
  await new Promise((r) => setTimeout(r, 1200));
}
console.log("DONE hits", hits);
process.exit(0);
