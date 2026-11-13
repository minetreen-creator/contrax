// Read-only: newsroom contact emails published on local news sites' own contact/staff pages. robots.txt respected.
const UA = "Mozilla/5.0 (compatible; ContraxBot/1.0; +https://www.contrax.company)";
const PAGES: Record<string, string[]> = {
  "www.progress-index.com": ["/contact-us/", "/contact/", "/staff/"],
  "richmondbizsense.com": ["/about-us/contributorsstaff/", "/about-us/", "/contact/"],
  "www.chesterfieldobserver.com": ["/contact", "/contact-us", "/about"],
  "virginiabusiness.com": ["/contact-us/", "/contact/", "/about-us/"],
  "www.richmond.com": ["/site/contact.html", "/contact/", "/site/staff.html"],
  "www.wtvr.com": ["/contact-us", "/news-tips", "/about-us"],
  "www.wric.com": ["/contact-us/", "/report-it/", "/about-8news/"],
  "www.nbc12.com": ["/about-us/contact-us/", "/contact-us/", "/station/contact-us/"],
  "richmondmagazine.com": ["/contact/", "/about/", "/about/contact-us/"],
  "www.vpm.org": ["/newsroom", "/contact", "/news/tips"],
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
  console.log("NEWS", host, JSON.stringify({ emails: keep.slice(0, 40), pages: seen.join(" ") }));
}
process.exit(0);
