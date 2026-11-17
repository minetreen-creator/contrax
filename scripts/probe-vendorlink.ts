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
const i = h1.indexOf("UpdatePanel6");
const panel = h1.slice(i > 0 ? i : 0);
console.log("PANELTEXT", strip(panel).slice(0, 1500));
const links = [...new Set([...panel.matchAll(/href="([^"]+)"/gi)].map((m) => m[1]))];
console.log("PANELLINKS", links.length, links.slice(0, 30).join("  ").slice(0, 1800));
const first = panel.search(/external\/bid\?|bid\?s=|solicitation/i);
console.log("RAW1", one(panel.slice(Math.max(0, first - 1500), first + 4500)));
console.log("PAGER", one((/(<[^>]*pag[^>]*>[\s\S]{0,1500})/i.exec(panel)?.[1] ?? "none")).slice(0, 1500));
console.log("COUNTS", (panel.match(/Due Date|Due:/gi) ?? []).length, "due labels;", (panel.match(/class="[^"]*ibox[^"]*"/gi) ?? []).length, "ibox;", (panel.match(/<tr/gi) ?? []).length, "tr");
