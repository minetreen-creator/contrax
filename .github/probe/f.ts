// TEMP read-only: the robots.txt of each IonWave board Contrax reads (one small request each).
const UA = "Mozilla/5.0 (compatible; ContraxBot/1.0; +https://www.contrax.company)";
const origins = ["arkansas", "cityofirving", "columbiasc", "douglascountypurchasing", "fayetteville-ar", "gtowntx", "leegov", "planotx", "cityofdubuque"];
for (const o of origins) {
  try {
    const r = await fetch(`https://${o}.ionwave.net/robots.txt`, { headers: { "user-agent": UA }, signal: AbortSignal.timeout(30_000) });
    const t = r.ok ? (await r.text()).replace(/\s+/g, " ").trim().slice(0, 200) : "";
    console.log(`ROBOTS ${o} -> ${r.status}: ${t}`);
  } catch (e) { console.log(`ROBOTS ${o} FAILED ${(e as Error).message}`); }
  await new Promise((r) => setTimeout(r, 1500));
}
process.exit(0);
