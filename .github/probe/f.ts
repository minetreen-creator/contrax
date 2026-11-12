// Temp probe: generic contact emails published on suppliers' own websites (owner 2026-11-12, "lift it for
// suppliers"). Reads robots.txt first and skips disallowed paths. Prints role addresses only (info@, sales@ ...);
// a named person's address is counted, never printed. Removed after.
const UA = "Mozilla/5.0 (compatible; ContraxBot/1.0; +https://www.contrax.company)";
const DOMAINS = ["tidewaterblock.com", "frackeltonblock.com", "valleybuildingsupply.com", "fredblock.com", "luckstone.com", "757brick.com", "pvbrick.com", "colonial-materials.com", "essexconcrete.com"];
const PATHS = ["/", "/contact", "/contact-us", "/contact.html", "/contact-us.html", "/about", "/about-us", "/locations"];
const ROLE = /^(info|sales|office|contact|dispatch|orders?|quotes?|estimating|hello|admin|customerservice|service|rentals?|inquiries|marketing|cs)$/i;
const get = async (u: string) => { try { const r = await fetch(u, { headers: { "User-Agent": UA }, redirect: "follow", signal: AbortSignal.timeout(15000) }); return { status: r.status, text: r.ok ? await r.text() : "" }; } catch (e) { return { status: 0, text: "" }; } };
function disallowed(robots: string): string[] {
  const out: string[] = []; let applies = false;
  for (const raw of robots.split(/\r?\n/)) { const line = raw.replace(/#.*/, "").trim(); const [k, ...v] = line.split(":"); const val = v.join(":").trim();
    if (/^user-agent$/i.test(k ?? "")) applies = val === "*" || /contraxbot/i.test(val);
    else if (applies && /^disallow$/i.test(k ?? "") && val) out.push(val); }
  return out;
}
const cf = (hex: string) => { const key = parseInt(hex.slice(0, 2), 16); let s = ""; for (let i = 2; i < hex.length; i += 2) s += String.fromCharCode(parseInt(hex.slice(i, i + 2), 16) ^ key); return s; };
for (const d of DOMAINS) {
  const base = `https://www.${d}`;
  const rb = await get(`${base}/robots.txt`);
  const dis = disallowed(rb.text);
  const roles = new Set<string>(); let named = 0; const seen: string[] = [];
  for (const p of PATHS) {
    if (dis.some((x) => x === "/" || p.startsWith(x))) { seen.push(`${p}:robots`); continue; }
    const r = await get(base + p); seen.push(`${p}:${r.status}`);
    if (!r.text) continue;
    const found = new Set<string>([...(r.text.match(/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g) ?? [])]);
    for (const m of r.text.matchAll(/data-cfemail="([0-9a-f]+)"/g)) found.add(cf(m[1]!));
    for (const e of found) { const [local, dom] = e.toLowerCase().split("@"); if (!dom || /\.(png|jpg|gif|webp|svg)$/.test(dom) || /sentry|wixpress|example|godaddy|squarespace/.test(dom)) continue;
      if (ROLE.test(local!)) roles.add(`${local}@${dom}`); else named++; }
    await new Promise((r) => setTimeout(r, 800));
  }
  console.log("MAIL", d, JSON.stringify({ roles: [...roles], named, pages: seen.join(" ") }));
}
process.exit(0);
