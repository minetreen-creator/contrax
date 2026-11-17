/** Branch-only read-only probe, part 2: Public Purchase's agency list for a state and an agency's public open-bid table. */
const UA = "Mozilla/5.0 (compatible; ContraxBot/1.0; +https://www.contrax.company)";
const one = (s: string) => s.replace(/\r?\n/g, " ¶ ").replace(/\s+/g, " ");
const strip = (h: string) => h.replace(/<script[\s\S]*?<\/script>/gi, " ").replace(/<[^>]+>/g, " ").replace(/&nbsp;/g, " ").replace(/\s+/g, " ").trim();
const get = async (u: string, init: RequestInit = {}) => { try { const r = await fetch(u, { ...init, headers: { "User-Agent": UA, ...(init.headers ?? {}) }, signal: AbortSignal.timeout(25000) }); return { status: r.status, body: await r.text() }; } catch (e) { return { status: 0, body: `ERR ${(e as Error).message}` }; } };
const B = "https://www.publicpurchase.com";
const home = await get(`${B}/gems/browse/home`);
const i = home.body.indexOf("getAgenciesByRegion");
const scripts = [...home.body.matchAll(/<script[^>]*src="([^"]+)"/gi)].map((m) => m[1]);
console.log("SCRIPTS", scripts.join("  "));
const def = home.body.search(/getAgenciesByRegion\s*[:=]\s*function|function\s+getAgenciesByRegion/);
console.log("INLINE", def, one(home.body.slice(Math.max(0, def - 200), def + 1500)));
for (const s of scripts.filter((s) => !/jquery|bootstrap|analytics|gtag/i.test(s)).slice(0, 12)) {
  const js = await get(s.startsWith("http") ? s : `${B}${s}`);
  const k = js.body.search(/getAgenciesByRegion/);
  if (k >= 0) console.log("JS", s, one(js.body.slice(Math.max(0, k - 300), k + 1600)));
}
for (const u of [`${B}/gems/browse/agencies?region=OH`, `${B}/gems/browse/region?region=OH`, `${B}/gems/browse/getAgenciesByRegion?region=OH`, `${B}/gems/browse/home?region=OH`]) {
  const p = await get(u); console.log("TRY", u, p.status, p.body.length, strip(p.body).slice(0, 300));
}
