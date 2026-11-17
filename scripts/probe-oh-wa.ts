/**
 * Branch-only, read-only probe (owner 2026-11-16: "Sure" to Ohio and Washington school boards).
 * Reads robots.txt and public front pages of Public Purchase and Builders Exchange of Washington
 * as ContraxBot. No login, nothing posted.
 */
const UA = "Mozilla/5.0 (compatible; ContraxBot/1.0; +https://www.contrax.company)";
const one = (s: string) => s.replace(/\r?\n/g, " ¶ ").replace(/\s+/g, " ");
const strip = (h: string) => h.replace(/<script[\s\S]*?<\/script>/gi, " ").replace(/<style[\s\S]*?<\/style>/gi, " ").replace(/<[^>]+>/g, " ").replace(/&nbsp;/g, " ").replace(/\s+/g, " ").trim();
const get = async (u: string) => {
  try { const r = await fetch(u, { headers: { "User-Agent": UA, Accept: "text/html,*/*" }, redirect: "follow", signal: AbortSignal.timeout(25000) }); return { status: r.status, url: r.url, body: await r.text() }; }
  catch (e) { return { status: 0, url: u, body: `ERR ${(e as Error).message}` }; }
};
const show = async (u: string, n = 900) => {
  const p = await get(u);
  const links = [...new Set([...p.body.matchAll(/href="([^"#]+)"/gi)].map((m) => m[1]).filter((l) => !/\.(css|png|jpg|gif|ico|svg|js)(\?|$)/i.test(l)))];
  console.log(`PAGE ${u} ${p.status} -> ${p.url} len=${p.body.length} title=${(p.body.match(/<title>([^<]*)/i)?.[1] ?? "").trim().slice(0, 70)}`);
  console.log(`TEXT ${strip(p.body).slice(0, n)}`);
  console.log(`LINKS(${links.length}) ${links.slice(0, 70).join("  ").slice(0, 2600)}`);
  return p;
};
for (const host of ["https://www.publicpurchase.com", "https://www.bxwa.com", "http://www.bxwa.com"]) {
  const rb = await get(`${host}/robots.txt`);
  console.log(`ROBOTS ${host} ${rb.status} :: ${one(rb.body).slice(0, 900)}`);
}
await show("https://www.publicpurchase.com/");
await show("https://www.publicpurchase.com/gems/browse/home");
const col = await show("https://www.publicpurchase.com/gems/columbus,oh/buyer/public/home", 1800);
const tables = [...col.body.matchAll(/<table[\s\S]*?<\/table>/gi)];
console.log(`COLTABLES ${tables.length}`);
for (const t of tables.slice(0, 6)) { const rows = [...t[0].matchAll(/<tr[\s\S]*?<\/tr>/gi)]; if (rows.length > 1) { console.log(`TBL rows=${rows.length}`); for (const r of rows.slice(0, 4)) console.log(`ROW ${one(r[0]).slice(0, 1200)}`); } }
await show("https://www.publicpurchase.com/gems/columbus,oh/buyer/public/publicInfo", 1500);
await show("https://www.bxwa.com/", 900);
await show("http://www.bxwa.com/bxwa_toc/pub/index.html", 1500);
