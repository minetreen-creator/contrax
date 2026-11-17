/** Branch-only read-only probe, part 5: the same public Active search on the agency-hosted VendorLink sites. */
const UA = "Mozilla/5.0 (compatible; ContraxBot/1.0; +https://www.contrax.company)";
const one = (s: string) => s.replace(/\r?\n/g, " ¶ ").replace(/\s+/g, " ");
const strip = (h: string) => h.replace(/<script[\s\S]*?<\/script>/gi, " ").replace(/<[^>]+>/g, " ").replace(/&nbsp;/g, " ").replace(/\s+/g, " ").trim();
for (const host of ["https://vendorlink.ocps.net", "https://vendorlink.osceola.org", "https://vendorlink.sarasotacountyschools.net", "https://vendorlink.scf.edu"]) {
  try {
    const rb = await fetch(`${host}/robots.txt`, { headers: { "User-Agent": UA }, signal: AbortSignal.timeout(20000) });
    console.log(`ROBOTS ${host} ${rb.status} :: ${one(await rb.text()).slice(0, 420)}`);
    const U = `${host}/external/bids`;
    const r0 = await fetch(U, { headers: { "User-Agent": UA }, signal: AbortSignal.timeout(20000) });
    const h0 = await r0.text();
    const form = new URLSearchParams();
    for (const m of h0.matchAll(/<input[^>]*type="hidden"[^>]*>/gi)) { const n = /name="([^"]+)"/.exec(m[0])?.[1]; const v = /value="([^"]*)"/.exec(m[0])?.[1] ?? ""; if (n) form.set(n, v.replace(/&amp;/g, "&")); }
    const sel = /<select[^>]*ddlAgency[\s\S]*?<\/select>/i.exec(h0)?.[0] ?? "";
    console.log(`AG ${host} ${r0.status} :: ${[...sel.matchAll(/<option[^>]*value="(\d+)"[^>]*>([^<]*)/gi)].map((o) => `${o[1]}=${o[2].trim()}`).join(" ; ").slice(0, 600)}`);
    form.set("ctl00$RegionMiddle$ddlAgency", ""); form.set("ctl00$RegionMiddle$ddlStatus", "2"); form.set("ctl00$RegionMiddle$ddlFiscalYear", ""); form.set("ctl00$RegionMiddle$ddlDepartment", "");
    for (const k of ["txtTitle", "txtNotes", "txtNumber", "tbCommodityKeyword"]) form.set(`ctl00$RegionMiddle$${k}`, "");
    form.set("ctl00$RegionMiddle$rblSolicitationPageCount", "100"); form.set("ctl00$RegionMiddle$ddlSolicitationOrderBy", "SolicitationDueDateASC"); form.set("ctl00$RegionMiddle$btnSearch", "Search Bids");
    await new Promise((r) => setTimeout(r, 3000));
    const r1 = await fetch(U, { method: "POST", headers: { "User-Agent": UA, "Content-Type": "application/x-www-form-urlencoded", Referer: U }, body: form, signal: AbortSignal.timeout(30000) });
    const h1 = await r1.text();
    const g = /<table[^>]*grvSolicitations[\s\S]*?<\/table>/i.exec(h1)?.[0] ?? "";
    const rows = [...g.matchAll(/<tr[\s\S]*?<\/tr>/gi)].map((m) => m[0]);
    console.log(`GRID ${host} post=${r1.status} rows=${Math.max(0, rows.length - 1)} head=${strip(rows[0] ?? "").slice(0, 160)}`);
    for (const r of rows.slice(1, 40)) console.log("CELLS", [...r.matchAll(/<td[^>]*>([\s\S]*?)<\/td>/gi)].map((c) => strip(c[1]).slice(0, 80)).join(" | ").slice(0, 400));
    if (!rows.length) console.log(`NOGRID ${strip(h1).slice(-500)}`);
  } catch (e) { console.log(`ERR ${host} ${(e as Error).message}`); }
}
