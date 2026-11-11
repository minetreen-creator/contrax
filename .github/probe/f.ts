// TEMP read-only: is vendornet.wi.gov reachable from a runner? One request per check, ContraxBot UA.
const UA = "Mozilla/5.0 (compatible; ContraxBot/1.0; +https://www.contrax.company)";
for (const url of ["https://vendornet.wi.gov/robots.txt", "https://vendornet.wi.gov/Bids", "https://doa.wi.gov/"]) {
  const t0 = Date.now();
  try {
    const r = await fetch(url, { headers: { "User-Agent": UA }, signal: AbortSignal.timeout(45_000) });
    const body = await r.text();
    console.log(`WI ${url} -> ${r.status} in ${Date.now() - t0}ms, ${body.length} bytes, server=${r.headers.get("server")}`);
  } catch (e) { console.log(`WI ${url} FAILED in ${Date.now() - t0}ms: ${(e as Error).name} ${(e as Error).message}`); }
}
process.exit(0);
