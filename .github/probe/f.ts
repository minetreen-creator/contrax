// Read-only probe: the CT State Contracting Portal search form (robots allow /SCP_Search). One or two GETs.
const UA = "Mozilla/5.0 (compatible; ContraxBot/1.0; +https://www.contrax.company)";
const strip = (h: string) => h.replace(/<script[\s\S]*?<\/script>|<style[\s\S]*?<\/style>/gi, " ").replace(/<[^>]+>/g, " ").replace(/&nbsp;|&amp;/g, " ").replace(/\s+/g, " ");
for (const url of ["https://biznet.ct.gov/SCP_Search/Default.aspx", "https://biznet.ct.gov/SCP_Search/BidResults.aspx?Status=Open"]) {
  await new Promise((r) => setTimeout(r, 2000));
  const res = await fetch(url, { headers: { "user-agent": UA }, signal: AbortSignal.timeout(20000) });
  const raw = await res.text();
  console.log(`\n== ${url} → ${res.status} ${raw.length}b`);
  console.log("TEXT:", strip(raw).slice(0, 1200));
  console.log("FORM:", [...raw.matchAll(/<(input|select)\b[^>]*name="([^"]+)"[^>]*>/gi)].map((m) => m[2]).filter((n) => !/^__/.test(n)).join(", "));
  console.log("OPTIONS:", [...raw.matchAll(/<option[^>]*value="([^"]*)"[^>]*>([^<]{2,60})</gi)].slice(0, 60).map((m) => `${m[1]}=${m[2].trim()}`).join("; "));
}
process.exit(0);
