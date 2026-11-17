/** Branch-only read-only probe, part 3: the public Active search and its result markup. */
const UA = "Mozilla/5.0 (compatible; ContraxBot/1.0; +https://www.contrax.company)";
const URL0 = "https://www.myvendorlink.com/external/bids";
const one = (s: string) => s.replace(/\r?\n/g, " ¶ ").replace(/\s+/g, " ");
const strip = (h: string) => h.replace(/<script[\s\S]*?<\/script>/gi, " ").replace(/<[^>]+>/g, " ").replace(/&nbsp;/g, " ").replace(/\s+/g, " ").trim();
const r0 = await fetch(URL0, { headers: { "User-Agent": UA } });
const h0 = await r0.text();
const cookie = (r0.headers.getSetCookie?.() ?? []).map((c) => c.split(";")[0]).join("; ");
const form = new URLSearchParams();
for (const m of h0.matchAll(/<input[^>]*type="hidden"[^>]*>/gi)) { const n = /name="([^"]+)"/.exec(m[0])?.[1]; const v = /value="([^"]*)"/.exec(m[0])?.[1] ?? ""; if (n) form.set(n, v.replace(/&amp;/g, "&")); }
console.log("HIDDEN", [...form.keys()].join(", "), "| viewstate len", form.get("__VIEWSTATE")?.length, "| btn", /<input[^>]*btnSearch[^>]*>/i.exec(h0)?.[0]);
form.set("ctl00$RegionMiddle$ddlAgency", ""); form.set("ctl00$RegionMiddle$ddlStatus", "2"); form.set("ctl00$RegionMiddle$ddlFiscalYear", ""); form.set("ctl00$RegionMiddle$txtTitle", ""); form.set("ctl00$RegionMiddle$txtNotes", ""); form.set("ctl00$RegionMiddle$txtNumber", ""); form.set("ctl00$RegionMiddle$tbCommodityKeyword", "");
form.set("ctl00$RegionMiddle$rblSolicitationPageCount", "100"); form.set("ctl00$RegionMiddle$ddlSolicitationOrderBy", "SolicitationDueDateASC"); form.set("ctl00$RegionMiddle$btnSearch", /<input[^>]*btnSearch[^>]*value="([^"]*)"/i.exec(h0)?.[1] ?? "Search");
await new Promise((r) => setTimeout(r, 3000));
const r1 = await fetch(URL0, { method: "POST", headers: { "User-Agent": UA, "Content-Type": "application/x-www-form-urlencoded", ...(cookie ? { Cookie: cookie } : {}), Referer: URL0 }, body: form });
const h1 = await r1.text();
console.log("POST", r1.status, r1.url, "len", h1.length);
const g = /<table[^>]*grvSolicitations[\s\S]*?<\/table>/i.exec(h1)?.[0] ?? "";
const rows = [...g.matchAll(/<tr[\s\S]*?<\/tr>/gi)].map((m) => m[0]);
console.log("GRID", g.length, "rows", rows.length);
for (const r of rows.slice(0, 4)) console.log("GROW", one(r).slice(0, 3000));
console.log("GLAST", one(rows[rows.length - 1] ?? "").slice(0, 1500));
const cells = rows.slice(1).map((r) => [...r.matchAll(/<td[^>]*>([\s\S]*?)<\/td>/gi)].map((c) => strip(c[1])));
const agencies: Record<string, number> = {};
for (const c of cells) for (const v of c) if (/School|County|City of|Authority|College|Cooperative/.test(v) && v.length < 90) { agencies[v] = (agencies[v] ?? 0) + 1; break; }
console.log("BYAGENCY", JSON.stringify(Object.entries(agencies).sort((a, b) => b[1] - a[1])).slice(0, 3500));
for (const c of cells.slice(0, 40)) console.log("CELLS", c.map((v) => v.slice(0, 80)).join(" | ").slice(0, 420));
console.log("AFTERGRID", one(strip(h1.slice(h1.indexOf(g) + g.length, h1.indexOf(g) + g.length + 1500))).slice(0, 500));
const sel = /<select[^>]*ddlAgency[\s\S]*?<\/select>/i.exec(h0)?.[0] ?? "";
console.log("AGENCIES", [...sel.matchAll(/<option[^>]*value="(\d+)"[^>]*>([^<]*)/gi)].map((o) => `${o[1]}=${o[2].trim()}`).slice(55).join(" ; "));
