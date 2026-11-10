// Read-only probe: are Bridgeport's and New Haven's OpenGov portals, Hartford's purchasing page and the
// CT State Contracting Portal public and robots-allowed? One GET each as ContraxBot, 2 s apart.
const UA = "Mozilla/5.0 (compatible; ContraxBot/1.0; +https://www.contrax.company)";
const URLS = [
  "https://procurement.opengov.com/robots.txt",
  "https://procurement.opengov.com/portal/bridgeportct",
  "https://procurement.opengov.com/portal/newhavenct",
  "https://procurement.opengov.com/portal/new-haven-ct",
  "https://www.hartford.gov/robots.txt",
  "https://www.hartford.gov/procurement/purchasing",
  "https://biznet.ct.gov/robots.txt",
  "https://biznet.ct.gov/SCP_Search/BidResults.aspx",
  "https://www.newhavenct.gov/government/departments-divisions/purchasing-division/general-information/procurement-web-portal",
];
const strip = (h: string) => h.replace(/<script[\s\S]*?<\/script>|<style[\s\S]*?<\/style>/gi, " ").replace(/<[^>]+>/g, " ").replace(/&nbsp;|&amp;/g, " ").replace(/\s+/g, " ");
for (const url of URLS) {
  await new Promise((r) => setTimeout(r, 2000));
  try {
    const res = await fetch(url, { headers: { "user-agent": UA, accept: "text/html,text/plain,application/json" }, redirect: "follow", signal: AbortSignal.timeout(20000) });
    const raw = await res.text();
    const bot = /<title>\s*just a moment|cf-chl-|challenge-platform|captcha/i.test(raw.slice(0, 8000));
    console.log(`\n== ${url} → HTTP ${res.status} ${res.url !== url ? `(→ ${res.url})` : ""} ${raw.length}b${bot ? " BOT CHECK" : ""}`);
    if (url.endsWith("robots.txt")) { console.log(raw.slice(0, 900)); continue; }
    if (!res.ok || bot) continue;
    console.log("TEXT:", strip(raw).slice(0, 1500));
    const apis = [...new Set([...raw.matchAll(/["'](\/?api\/[^"'\s]{3,120}|https:\/\/[a-z0-9.-]*opengov[^"'\s]{0,120})["']/g)].map((m) => m[1]))].slice(0, 25);
    console.log("API-LIKE:", apis.join(" | "));
    const links = [...raw.matchAll(/href="([^"]+)"[^>]*>([^<]{4,100})</g)].map((m) => `${m[2].trim()} -> ${m[1]}`).filter((l) => /bid|rfp|rfq|solicit|opengov|bonfire|portal|procure/i.test(l)).slice(0, 20);
    console.log("LINKS:", links.join(" || "));
  } catch (e) {
    console.log(`\n== ${url} → no answer (${(e as Error).name}: ${(e as Error).message})`);
  }
}
process.exit(0);
