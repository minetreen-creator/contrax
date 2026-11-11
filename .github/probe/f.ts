// TEMP read-only probe: public sales contact emails on housing companies' own contact pages.
// Respects robots.txt; a 403, captcha or "Just a moment" page stops that site. No forms are submitted.
const UA = "Mozilla/5.0 (compatible; ContraxBot/1.0; +https://www.contrax.company)";
const SITES: { name: string; base: string; paths: string[] }[] = [
  { name: "National Corporate Housing", base: "https://www.nationalcorporatehousing.com", paths: ["/contact-us", "/contact", "/Furnished-Housing/Corporate-Housing/north-america/United-States-of-America/Virginia/Norfolk"] },
  { name: "Preferred Corporate Housing", base: "https://www.corporates.com", paths: ["/contactus.php", "/corporate-housing/VA/Norfolk.php", "/construction.php"] },
  { name: "Key Housing", base: "https://www.keyhousing.com", paths: ["/contact-us/", "/contact/", "/construction-crew-housing/"] },
  { name: "StayAtStoz", base: "https://www.stayatstoz.com", paths: ["/", "/contact", "/contact-us"] },
  { name: "Travelers Haven", base: "https://www.travelershaven.com", paths: ["/contact", "/contact-us", "/"] },
  { name: "HouseStay", base: "https://www.housestay.com", paths: ["/contact", "/contact-us", "/"] },
  { name: "stayAPT Suites", base: "https://www.stayapt.com", paths: ["/hotels/stayapt-suites-san-antonio-lackland/", "/contact/", "/group-sales/"] },
];
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const get = async (url: string) => {
  const res = await fetch(url, { headers: { "User-Agent": UA, Accept: "text/html,*/*" }, redirect: "follow", signal: AbortSignal.timeout(20_000) });
  return { status: res.status, text: res.ok ? await res.text() : "" };
};
/** Paths disallowed for * or ContraxBot. A simple reading: prefix rules only. */
function disallowed(robots: string): string[] {
  const out: string[] = [];
  let applies = false;
  for (const raw of robots.split(/\r?\n/)) {
    const line = raw.replace(/#.*/, "").trim();
    const m = /^([A-Za-z-]+):\s*(.*)$/.exec(line);
    if (!m) continue;
    const k = m[1].toLowerCase();
    const v = m[2].trim();
    if (k === "user-agent") applies = v === "*" || /contraxbot/i.test(v);
    else if (k === "disallow" && applies && v) out.push(v);
  }
  return out;
}
for (const site of SITES) {
  const host = new URL(site.base).host.replace(/^www\./, "");
  let rules: string[] = [];
  try {
    const r = await get(`${site.base}/robots.txt`);
    if (r.status === 403) { console.log(`PROSPECT ${site.name}: robots.txt 403, stopped`); continue; }
    rules = r.status === 200 ? disallowed(r.text) : [];
  } catch (e) { console.log(`PROSPECT ${site.name}: robots.txt failed (${(e as Error).message}), stopped`); continue; }
  const found = new Map<string, string>();
  for (const path of site.paths) {
    if (rules.some((d) => d === "/" || path.startsWith(d.replace(/\*.*$/, "")))) { console.log(`PROSPECT ${site.name}: ${path} disallowed by robots.txt, skipped`); continue; }
    await sleep(1500);
    try {
      const r = await get(`${site.base}${path}`);
      if (r.status === 403 || /Just a moment|captcha|cf-challenge|Access Denied/i.test(r.text.slice(0, 3000))) { console.log(`PROSPECT ${site.name}: ${path} blocked (${r.status}), stopped`); break; }
      if (r.status !== 200) { console.log(`PROSPECT ${site.name}: ${path} -> ${r.status}`); continue; }
      const emails = new Set((r.text.match(/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g) ?? []).map((e) => e.toLowerCase()));
      const phones = [...new Set(r.text.match(/\(?\b\d{3}\)?[-. ]\d{3}[-. ]\d{4}\b/g) ?? [])].slice(0, 3);
      // Company addresses only: the site's own domain, and role-style mailboxes.
      for (const e of emails) if (e.endsWith(`@${host}`) && !/\.(png|jpg|gif|webp|svg)$/.test(e)) found.set(e, path);
      console.log(`PROSPECT ${site.name}: ${path} -> 200, ${r.text.length} bytes, company emails on page: ${[...emails].filter((e) => e.endsWith(`@${host}`)).join(", ") || "none"}; phones: ${phones.join(", ") || "none"}`);
    } catch (e) { console.log(`PROSPECT ${site.name}: ${path} failed (${(e as Error).message})`); }
  }
  console.log(`PROSPECT ${site.name} RESULT: ${[...found.entries()].map(([e, p]) => `${e} (on ${p})`).join("; ") || "no email published on the pages read"}`);
}
process.exit(0);
