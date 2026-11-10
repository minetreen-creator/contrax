// Temp probe: can a GitHub runner reach Montgomery County MD's open-data API? Honest UA, 3 requests, read-only.
const URL_ = "https://data.montgomerycountymd.gov/resource/eeq6-nnwe.json?status=Active&$limit=5000";
const UA = "Mozilla/5.0 (compatible; ContraxBot/1.0; +https://www.contrax.company)";
for (let i = 0; i < 3; i++) {
  const t = Date.now();
  try {
    const r = await fetch(URL_, { headers: { "User-Agent": UA, Accept: "application/json" }, signal: AbortSignal.timeout(60000) });
    const b = await r.text();
    console.log(`try ${i + 1}: HTTP ${r.status} in ${Date.now() - t}ms, ${b.length} bytes, array=${b.trim().startsWith("[")}`);
  } catch (e) {
    console.log(`try ${i + 1}: failed after ${Date.now() - t}ms: ${(e as Error).message}`);
  }
  await new Promise((r) => setTimeout(r, 5000));
}
