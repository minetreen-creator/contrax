// Read-only: robots.txt of PlanetBids hosts, and agency lists (name + portal id) from PlanetBids' public state pages. Removed after.
const UA = "Mozilla/5.0 (compatible; ContraxBot/1.0; +https://www.contrax.company)";
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
let blocked = false;
for (const h of ["https://vendor.planetbids.com", "https://vendors.planetbids.com"]) {
  const r = await fetch(`${h}/robots.txt`, { headers: { "User-Agent": UA } }).catch(() => null);
  const t = (await r?.text().catch(() => "")) ?? "";
  console.log("ROBOTS", h, r?.status, t.slice(0, 600).replace(/\n/g, " | "));
  const star = t.split(/\n(?=\s*user-agent:)/i).filter((g) => /user-agent:\s*\*\s*$/im.test(g));
  const dis = star.flatMap((g) => [...g.matchAll(/^\s*disallow:\s*(\S*)/gim)].map((m) => m[1])).filter(Boolean);
  const rx = (d: string) => new RegExp("^" + d.replace(/[.+?^${}()|[\]\\]/g, "\\$&").replace(/\*/g, ".*").replace(/\\\$$/, "$"));
  if (h.includes("vendor.") && r?.status === 200 && dis.some((d) => rx(d).test("/states/california"))) blocked = true;
}
if (blocked) { console.log("STOP: robots disallows /states/"); process.exit(0); }
const states = ["california", "texas", "arizona", "nevada", "oregon", "washington", "florida", "colorado", "utah", "new-mexico", "ohio", "georgia", "north-carolina", "virginia", "illinois", "michigan", "hawaii", "idaho", "oklahoma", "louisiana"];
for (const st of states) {
  await sleep(2500);
  try {
    const r = await fetch(`https://vendor.planetbids.com/states/${st}`, { headers: { "User-Agent": UA }, signal: AbortSignal.timeout(30000) });
    const h = await r.text();
    const ids = [...h.matchAll(/portal\/(\d{4,6})\b[^"]*"[^>]*>([^<]{2,120})</g)].map((m) => `${m[1]}=${m[2].trim()}`);
    const ids2 = [...new Set([...h.matchAll(/portal\/(\d{4,6})/g)].map((m) => m[1]))];
    console.log(`STATE ${st} ${r.status} len=${h.length} linked=${ids2.length}`);
    console.log("  " + [...new Set(ids)].join(" ; ").slice(0, 8000));
    if (!ids.length) console.log("  text: " + h.replace(/<script[\s\S]*?<\/script>/g, "").replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").slice(0, 600));
  } catch (e) { console.log(`STATE ${st} ERR ${(e as Error).message}`); }
}
