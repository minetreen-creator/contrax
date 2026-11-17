/** Branch-only read-only probe, part 2: open NYC solicitations, link shape. Not merged. */
const BASE = "https://data.cityofnewyork.us/resource/dg92-zbpx.json";
const H = { Accept: "application/json", "User-Agent": "Contrax procurement intelligence (https://www.contrax.company)" };
const get = async (q: string) => { const r = await fetch(`${BASE}?${q}`, { headers: H }); return { status: r.status, data: await r.json().catch(() => null) }; };
const now = new Date().toISOString().slice(0, 19);
const where = encodeURIComponent(`section_name='Procurement' AND type_of_notice_description='Solicitation' AND due_date > '${now}' AND due_date < '2030-01-01T00:00:00'`);
const c = await get(`$select=count(*) as n&$where=${where}`);
console.log("OPEN", JSON.stringify(c));
for (const k of ["agency_name", "category_description", "selection_method_description"]) console.log("OPENBY", k, JSON.stringify((await get(`$select=${k},count(*) as n&$where=${where}&$group=${k}&$order=n DESC&$limit=40`)).data).slice(0, 1800));
const rows = ((await get(`$where=${where}&$order=due_date ASC&$limit=1000`)).data ?? []) as Record<string, any>[];
console.log("ROWS", rows.length, "distinct request_id", new Set(rows.map((r) => r.request_id)).size, "distinct pin", new Set(rows.map((r) => r.pin)).size);
console.log("LINKS", JSON.stringify(rows.slice(0, 3).map((r) => r.document_links)).slice(0, 700));
const clean = rows.filter((r) => /janitor|custodia|cleaning|housekeep|porter/i.test(`${r.short_title} ${r.additional_description_1 ?? ""}`));
console.log("CLEANING", clean.length);
for (const r of clean.slice(0, 25)) console.log("    ", r.request_id, "|", r.agency_name, "|", String(r.short_title).slice(0, 90), "|", r.due_date, "|", r.category_description, "|", r.selection_method_description);
for (const r of rows.slice(0, 12)) console.log("  S ", r.request_id, "|", r.agency_name, "|", String(r.short_title).slice(0, 80), "|", r.due_date, "|", String(r.additional_description_1 ?? "").replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").slice(0, 160));
const id = rows[0]?.request_id;
for (const u of [`https://a856-cityrecord.nyc.gov/RequestDetail/${id}`]) {
  try { const r = await fetch(u, { headers: { "User-Agent": H["User-Agent"] }, redirect: "follow" }); const t = await r.text(); console.log("PAGE", u, r.status, r.url, "| title:", (t.match(/<title>([^<]*)/i)?.[1] ?? "").trim().slice(0, 80), "| has short title:", t.toLowerCase().includes(String(rows[0].short_title).toLowerCase().slice(0, 25))); } catch (e) { console.log("PAGE", u, "error", (e as Error).message); }
}
