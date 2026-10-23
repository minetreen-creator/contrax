// One-time probe (removed before merge): which SAM.gov search parameter
// filters an IT NAICS search to Virginia? Runs on GitHub's runners.
const H = {
  "User-Agent": "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
  Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
};
const BASE = "https://sam.gov/api/prod/sgs/v1/search/?page=0&size=25&sort=-modifiedDate&mode=opportunities&q=&is_active=true";
const variants = [
  "&naics=541512",
  "&state=VA",
  "&naics=541512&state=VA",
  "&naics=541512&state=Virginia",
  "&naics=541512&pop_state=VA",
  "&naics=541512&place_of_performance_state=VA",
  "&naics=541512&placeOfPerformance.state.code=VA",
  "&naics=541512&organization_state=VA",
  "&q=541512&state=VA",
  "&q=Virginia&naics=541512",
  "&naics=541511&state=VA",
  "&naics=541519&state=VA",
  "&psc=D399&state=VA",
  "&naics=561720&state=VA",
];
let printedKeys = false;
for (const v of variants) {
  try {
    const res = await fetch(BASE + v, { headers: H });
    const d = await res.json();
    const rows = d?._embedded?.results ?? [];
    if (!printedKeys && rows[0]) {
      console.log("RESULT KEYS:", Object.keys(rows[0]).join(","));
      console.log("SAMPLE:", JSON.stringify(rows[0]).slice(0, 1500));
      printedKeys = true;
    }
    const pops = rows.map((r) => r?.placeOfPerformance?.state?.code ?? r?.placeOfPerformance?.[0]?.state?.code ?? r?.organizationHierarchy?.at?.(-1)?.address?.state ?? "?");
    const counts = {};
    for (const p of pops) counts[p] = (counts[p] ?? 0) + 1;
    console.log(`PROBE ${v.padEnd(48)} HTTP ${res.status} total=${d?.page?.totalElements} rows=${rows.length} states=${JSON.stringify(counts)}`);
  } catch (e) {
    console.log(`PROBE ${v} ERROR ${e}`);
  }
  await new Promise((r) => setTimeout(r, 1500));
}
