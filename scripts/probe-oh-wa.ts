/** Branch-only read-only probe, part 3: Public Purchase agency lists for OH and WA, and public open-bid tables. */
const UA = "Mozilla/5.0 (compatible; ContraxBot/1.0; +https://www.contrax.company)";
const one = (s: string) => s.replace(/\r?\n/g, " ¶ ").replace(/\s+/g, " ");
const strip = (h: string) => h.replace(/<script[\s\S]*?<\/script>/gi, " ").replace(/<[^>]+>/g, " ").replace(/&nbsp;/g, " ").replace(/&amp;/g, "&").replace(/\s+/g, " ").trim();
const get = async (u: string) => { try { const r = await fetch(u, { headers: { "User-Agent": UA, "X-Requested-With": "XMLHttpRequest" }, signal: AbortSignal.timeout(25000) }); return { status: r.status, body: await r.text() }; } catch (e) { return { status: 0, body: `ERR ${(e as Error).message}` }; } };
const B = "https://www.publicpurchase.com";
const lists: Record<string, [string, string][]> = {};
for (const st of ["OH", "WA"]) {
  const p = await get(`${B}/gems/global/home/getAgenciesByRegion?region=${st}`);
  console.log(`RAW ${st} ${p.status} len=${p.body.length} :: ${one(p.body).slice(0, 900)}`);
  const ag = [...p.body.matchAll(/href="([^"]*\/gems\/([^"\/]+)\/[^"]*)"[^>]*>([^<]+)</gi)].map((m) => [m[2], strip(m[3])] as [string, string]);
  const alt = [...p.body.matchAll(/selectAgency\('([^']+)'[^)]*\)[^>]*>([^<]+)</gi)].map((m) => [m[1], strip(m[2])] as [string, string]);
  lists[st] = ag.length ? ag : alt;
  console.log(`AGENCIES ${st} ${lists[st].length} :: ${lists[st].map((a) => `${a[0]}=${a[1]}`).join(" ; ").slice(0, 6000)}`);
  await new Promise((r) => setTimeout(r, 1500));
}
const nat = await get(`${B}/gems/global/home/nationalBidList`);
console.log(`NATIONAL ${nat.status} len=${nat.body.length} :: ${strip(nat.body).slice(0, 700)}`);
let shown = 0;
for (const st of ["OH", "WA"]) for (const [code, name] of lists[st].slice(0, 45)) {
  const p = await get(`${B}/gems/${code}/buyer/public/publicInfo`);
  const rows = [...p.body.matchAll(/<tr[\s\S]*?<\/tr>/gi)].map((m) => m[0]).filter((r) => /<td/i.test(r));
  console.log(`BOARD ${st} ${code} | ${name} | ${p.status} | rows=${rows.length}`);
  for (const r of rows.slice(0, 6)) console.log(`   BID ${[...r.matchAll(/<td[^>]*>([\s\S]*?)<\/td>/gi)].map((c) => strip(c[1]).slice(0, 90)).join(" | ").slice(0, 380)}`);
  if (rows.length && shown < 2) { shown++; console.log(`RAWROW ${one(rows[0]).slice(0, 1800)}`); console.log(`RAWHEAD ${one(p.body.slice(p.body.search(/<table/i), p.body.search(/<table/i) + 1500))}`); }
  await new Promise((r) => setTimeout(r, 1200));
}
