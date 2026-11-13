// Read-only: text of candidate co-op solicitation pages. Removed after.
const UA = "ContraxBot/1.0 (+https://www.contrax.company)";
const PAGES = [
  "https://www.tips-usa.com/contracts", "https://www.tips-usa.com/vendors/become",
  "https://www.omniapartners.com/for-suppliers/solicitations",
  "https://1gpa.org/solicitations/",
  "https://www.choicepartners.org/current-rfps", "https://www.choicepartners.org/upcoming-contracts",
];
const text = (h: string) => h.replace(/<script[\s\S]*?<\/script>|<style[\s\S]*?<\/style>/gi, " ").replace(/<[^>]+>/g, " ").replace(/&nbsp;|&#160;/g, " ").replace(/&amp;/g, "&").replace(/\s+/g, " ");
for (const u of PAGES) {
  try {
    const r = await fetch(u, { headers: { "User-Agent": UA }, signal: AbortSignal.timeout(20000) });
    const h = await r.text();
    const links = [...h.matchAll(/href="([^"]+)"[^>]*>([^<]{0,90})/g)].filter((m) => /solicit|rfp|rfq|bid|proposal|ifb|\.pdf|bonfire|ionwave|bidnet|jaggaer|event/i.test(m[1] + m[2])).map((m) => `${m[2].trim()} -> ${m[1]}`);
    const t = text(h);
    const i = Math.max(0, t.search(/solicitation|RFP|proposal/i) - 200);
    console.log(`\n===== ${u} ${r.status} len=${h.length}\nTEXT: ${t.slice(i, i + 3000)}\nLINKS:\n  ${[...new Set(links)].slice(0, 40).join("\n  ")}`);
    const next = h.match(/<script id="__NEXT_DATA__"[^>]*>([\s\S]{0,1500})/);
    if (next) console.log("NEXT_DATA: " + next[1]);
  } catch (e) { console.log(`\n===== ${u} ERR ${(e as Error).message}`); }
}
