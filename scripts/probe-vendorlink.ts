/** Branch-only read-only probe, part 2: robots in full and the shape of the public bids page. */
const UA = "Mozilla/5.0 (compatible; ContraxBot/1.0; +https://www.contrax.company)";
const get = async (u: string) => { const r = await fetch(u, { headers: { "User-Agent": UA }, signal: AbortSignal.timeout(25000) }); return { status: r.status, body: await r.text(), cookie: r.headers.get("set-cookie") ?? "" }; };
const one = (s: string) => s.replace(/\r?\n/g, " ¶ ").replace(/\s+/g, " ");
const strip = (h: string) => h.replace(/<script[\s\S]*?<\/script>/gi, " ").replace(/<style[\s\S]*?<\/style>/gi, " ").replace(/<[^>]+>/g, " ").replace(/&nbsp;/g, " ").replace(/\s+/g, " ").trim();
for (const host of ["https://www.myvendorlink.com", "https://vendorlink.ocps.net"]) {
  console.log(`ROBOTS ${host} :: ${one((await get(`${host}/robots.txt`)).body).slice(0, 1200)}`);
  const p = await get(`${host}/external/bids`);
  const h = p.body;
  console.log(`PAGE ${host} ${p.status} len=${h.length} cookie=${p.cookie ? "yes" : "no"}`);
  for (const m of h.matchAll(/<select[^>]*(?:name|id)="([^"]+)"[^>]*>([\s\S]*?)<\/select>/gi)) {
    const opts = [...m[2].matchAll(/<option[^>]*value="([^"]*)"[^>]*>([^<]*)/gi)].map((o) => `${o[1]}=${o[2].trim()}`);
    console.log(`SELECT ${m[1]} (${opts.length}) :: ${opts.slice(0, 400).join(" ; ").slice(0, 6000)}`);
  }
  console.log(`INPUTS ${[...h.matchAll(/<input[^>]*name="([^"]+)"[^>]*>/gi)].map((m) => m[1] + (/type="hidden"/i.test(m[0]) ? "(h)" : "")).join(" ; ").slice(0, 1500)}`);
  console.log(`FORM ${[...h.matchAll(/<form[^>]*>/gi)].map((m) => m[0]).join(" ").slice(0, 400)}`);
  const scripts = [...h.matchAll(/<script(?![^>]*src)[^>]*>([\s\S]*?)<\/script>/gi)].map((m) => m[1]).join("\n");
  console.log(`AJAX ${[...new Set([...scripts.matchAll(/(?:url|href)\s*[:=]\s*["']([^"']+)["']/gi)].map((m) => m[1]))].join(" ; ").slice(0, 1200)}`);
  console.log(`SCRIPTLEN ${scripts.length} :: ${one(scripts).slice(0, 1800)}`);
  const tables = [...h.matchAll(/<table[\s\S]*?<\/table>/gi)];
  console.log(`TABLES ${tables.length}`);
  for (const t of tables.slice(0, 2)) {
    const rows = [...t[0].matchAll(/<tr[\s\S]*?<\/tr>/gi)];
    console.log(`TABLE rows=${rows.length}`);
    for (const r of rows.slice(0, 6)) console.log(`ROW ${one(r[0]).slice(0, 900)}`);
  }
  const i = h.search(/Fiscal/i);
  console.log(`AROUND ${one(h.slice(Math.max(0, i - 200), i + 2600))}`);
  console.log(`TAIL ${strip(h).slice(-900)}`);
}
