// Read-only: robots.txt and one public page per candidate source. Removed after.
const UA = "ContraxBot/1.0 (+https://www.contrax.company)";
const SITES: [string, string[]][] = [
  ["https://www.tips-usa.com", ["/", "/vendors/", "/solicitations/"]],
  ["https://www.omniapartners.com", ["/", "/suppliers/", "/solicitations"]],
  ["https://www.1gpa.org", ["/", "/solicitations", "/bids"]],
  ["https://www.choicepartners.org", ["/", "/vendors", "/solicitations"]],
  ["https://www.dibbs.bsm.dla.mil", ["/", "/Downloads/"]],
  ["https://www.dla.mil", ["/"]],
];
for (const [base, paths] of SITES) {
  try {
    const r = await fetch(base + "/robots.txt", { headers: { "User-Agent": UA }, signal: AbortSignal.timeout(15000) });
    const t = await r.text();
    console.log(`\n=== ${base}/robots.txt ${r.status}\n${t.slice(0, 1200)}`);
  } catch (e) { console.log(`\n=== ${base}/robots.txt ERR ${(e as Error).message}`); }
  for (const p of paths) {
    try {
      const r = await fetch(base + p, { headers: { "User-Agent": UA }, redirect: "follow", signal: AbortSignal.timeout(15000) });
      const t = await r.text();
      const links = [...t.matchAll(/href="([^"]+)"/g)].map((m) => m[1]).filter((h) => /solicit|bid|rfp|vendor|supplier|download|opportunit|contract/i.test(h));
      const title = t.match(/<title[^>]*>([^<]*)/i)?.[1]?.trim();
      console.log(`--- ${p} -> ${r.status} ${r.url} len=${t.length} title=${title}\n  ${[...new Set(links)].slice(0, 25).join("\n  ")}`);
      if (/captcha|cf-chl|access denied|consent/i.test(t)) console.log("  [page mentions captcha/consent/access denied]");
    } catch (e) { console.log(`--- ${p} ERR ${(e as Error).message}`); }
  }
}
