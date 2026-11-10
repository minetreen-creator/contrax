// Read-only probe: are the purchasing co-ops' own solicitation lists public and readable? One GET each
// as ContraxBot (plus robots.txt); a refusal or bot check means leave that site alone.
const UA = "Mozilla/5.0 (compatible; ContraxBot/1.0; +https://www.contrax.company)";
const URLS = [
  "https://tips.ionwave.net/robots.txt",
  "https://tips.ionwave.net/SourcingEvents.aspx?SourceType=1",
  "https://www.sourcewell-mn.gov/robots.txt",
  "https://www.sourcewell-mn.gov/solicitations",
  "https://www.buyboard.com/robots.txt",
  "https://www.buyboard.com/vendor",
  "https://www.buyboard.com/vendor/current-proposal-invitations",
  "https://www.naspovaluepoint.org/robots.txt",
  "https://www.naspovaluepoint.org/?p=5322",
  "https://hgacbuy.org/robots.txt",
  "https://hgacbuy.org/bid-notices",
  "https://www.omniapartners.com/robots.txt",
  "https://www.omniapartners.com/for-suppliers/solicitations",
];
const strip = (h: string) => h.replace(/<script[\s\S]*?<\/script>|<style[\s\S]*?<\/style>/gi, " ").replace(/<[^>]+>/g, " ").replace(/&nbsp;|&amp;/g, " ").replace(/\s+/g, " ");
for (const url of URLS) {
  await new Promise((r) => setTimeout(r, 1500));
  try {
    const res = await fetch(url, { headers: { "user-agent": UA, accept: "text/html,text/plain" }, redirect: "follow", signal: AbortSignal.timeout(20000) });
    const raw = await res.text();
    const bot = /just a moment|cf-chl|captcha|access denied/i.test(raw.slice(0, 6000));
    console.log(`\n== ${url} → HTTP ${res.status} ${res.url !== url ? `(→ ${res.url})` : ""} ${raw.length}b${bot ? " BOT CHECK" : ""}`);
    if (url.endsWith("robots.txt")) { console.log(raw.slice(0, 600)); continue; }
    if (!res.ok || bot) continue;
    const t = strip(raw);
    console.log(t.slice(0, 1800));
    const links = [...raw.matchAll(/href="([^"]+)"[^>]*>([^<]{6,120})</g)].map((m) => `${m[2].trim()} -> ${m[1]}`).filter((l) => /rfp|proposal|solicit|bid|invitation|\.pdf/i.test(l)).slice(0, 25);
    console.log("LINKS:\n" + links.join("\n"));
  } catch (e) {
    console.log(`\n== ${url} → no answer (${(e as Error).name}: ${(e as Error).message})`);
  }
}
process.exit(0);
