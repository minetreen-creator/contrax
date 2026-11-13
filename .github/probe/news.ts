// Read-only: newsroom contact emails published on local news sites' own contact/staff pages. robots.txt respected.
const UA = "Mozilla/5.0 (compatible; ContraxBot/1.0; +https://www.contrax.company)";
const PAGES: Record<string, string[]> = {
  "henrico.gov": ["/finance/divisions/purchasing/", "/locations/purchasing/"],
  "www.arlingtonva.us": ["/Government/Programs/Budget-Finance/Purchasing", "/Government/Programs/Budget-Finance/Purchasing/Purchasing-Team"],
  "www.henrycountyva.gov": ["/226/Purchasing", "/bids.aspx"],
  "www.loudoun.gov": ["/933/Doing-Business-with-the-County", "/Directory.aspx?did=14", "/procurement"],
  "www.lynchburgva.gov": ["/procurement", "/219/Procurement", "/bids.aspx"],
  "www.vbgov.com": ["/government/departments/finance/purchasing/Pages/default.aspx", "/government/departments/finance/purchasing/Pages/contact-us.aspx"],
  "hampton.gov": ["/procurement", "/180/Procurement-Services", "/bids.aspx"],
  "www.fauquiercounty.gov": ["/government/departments-h-z/procurement", "/government/departments-a-g/finance/procurement"],
  "www.cityofchesapeake.net": ["/government/city-departments/departments/purchasing", "/purchasing"],
  "www.suffolkva.us": ["/219/Purchasing", "/purchasing", "/bids.aspx"],
  "www.danville-va.gov": ["/222/Purchasing", "/bids.aspx"],
  "www.alexandriava.gov": ["/procurement", "/Procurement"],
};
const get = async (u: string) => { try { const r = await fetch(u, { headers: { "User-Agent": UA }, redirect: "follow", signal: AbortSignal.timeout(15000) }); return { status: r.status, text: r.ok ? await r.text() : "" }; } catch { return { status: 0, text: "" }; } };
const disallowed = (robots: string) => { const out: string[] = []; let on = false; for (const raw of robots.split(/\r?\n/)) { const l = raw.replace(/#.*/, "").trim(); const [k, ...v] = l.split(":"); const val = v.join(":").trim(); if (/^user-agent$/i.test(k ?? "")) on = val === "*" || /contraxbot/i.test(val); else if (on && /^disallow$/i.test(k ?? "") && val) out.push(val); } return out; };
const cf = (hex: string) => { const key = parseInt(hex.slice(0, 2), 16); let s = ""; for (let i = 2; i < hex.length; i += 2) s += String.fromCharCode(parseInt(hex.slice(i, i + 2), 16) ^ key); return s; };
for (const [host, paths] of Object.entries(PAGES)) {
  const dis = disallowed((await get(`https://${host}/robots.txt`)).text);
  const found = new Set<string>(); const seen: string[] = [];
  for (const p of paths) {
    if (dis.some((x) => x === "/" || p.startsWith(x))) { seen.push(`${p}:robots`); continue; }
    const r = await get(`https://${host}${p}`); seen.push(`${p}:${r.status}`);
    if (r.status === 403) break;
    for (const e of r.text.match(/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g) ?? []) found.add(e.toLowerCase());
    for (const m of r.text.matchAll(/data-cfemail="([0-9a-f]+)"/g)) found.add(cf(m[1]!).toLowerCase());
    await new Promise((r) => setTimeout(r, 800));
  }
  const keep = [...found].filter((e) => !/\.(png|jpg|gif|webp|svg)$|sentry|wixpress|example\./.test(e));
  console.log("PURCH", host, JSON.stringify({ emails: keep.slice(0, 40), pages: seen.join(" ") }));
}
process.exit(0);
