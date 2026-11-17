/**
 * One-off, read-only probe of NYC's public "City Record Online" open dataset (dg92-zbpx on
 * data.cityofnewyork.us), to learn its columns before a source is built (owner 2026-11-16: "Go" on
 * New York janitorial sources). Prints column names, group counts and a few solicitation titles.
 * Contact columns are never printed. Touches no database. Branch-only; not merged.
 */
const BASE = "https://data.cityofnewyork.us/resource/dg92-zbpx.json";
const H = { Accept: "application/json", "User-Agent": "Contrax procurement intelligence (https://www.contrax.company)" };
const get = async (q: string) => {
  const r = await fetch(`${BASE}?${q}`, { headers: H });
  const t = await r.text();
  try { return { status: r.status, data: JSON.parse(t) }; } catch { return { status: r.status, data: t.slice(0, 300) }; }
};
const PRIVATE = /contact|email|phone|fax|address/i;

const first = await get("$limit=200&$order=:updated_at DESC");
console.log("status", first.status);
const rows = Array.isArray(first.data) ? (first.data as Record<string, unknown>[]) : [];
if (!rows.length) { console.log(first.data); process.exit(0); }
const keys = [...new Set(rows.flatMap((r) => Object.keys(r)))];
console.log("KEYS", keys.join(", "));
for (const k of keys) {
  if (PRIVATE.test(k)) continue;
  const vals = rows.map((r) => String(r[k] ?? "")).filter(Boolean);
  const distinct = [...new Set(vals)];
  console.log(`COL ${k} | filled ${vals.length}/200 | distinct ${distinct.length} | e.g. ${distinct.slice(0, 6).map((v) => v.replace(/\s+/g, " ").slice(0, 60)).join(" ;; ")}`);
}
for (const k of keys.filter((k) => /section|type|category|method|special/i.test(k) && !PRIVATE.test(k))) {
  const g = await get(`$select=${k},count(*) as n&$group=${k}&$order=n DESC&$limit=25`);
  console.log(`GROUP ${k}`, JSON.stringify(g.data).slice(0, 1500));
}
for (const k of keys.filter((k) => /date/i.test(k))) {
  const m = await get(`$select=max(${k}) as mx,count(*) as n`);
  console.log(`DATE ${k}`, JSON.stringify(m.data));
}
for (const word of ["janitorial", "custodial", "cleaning"]) {
  const q = await get(`$q=${word}&$limit=400&$order=:updated_at DESC`);
  const list = Array.isArray(q.data) ? (q.data as Record<string, unknown>[]) : [];
  console.log(`Q ${word}: ${list.length} of most recent`);
  for (const r of list.slice(0, 12)) console.log("   ", Object.entries(r).filter(([k]) => !PRIVATE.test(k) && !/description|additional/i.test(k)).map(([k, v]) => `${k}=${String(v).replace(/\s+/g, " ").slice(0, 70)}`).join(" | "));
}
