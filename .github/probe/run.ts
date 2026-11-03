// Temporary look at Beacon (owner 2026-11-03: "can we do Houston too?" → "go
// ahead"). robots.txt allows all but /api/planholder/document. Reads the public
// page's own script files to find which call fills the open-solicitations list.
// No login, no documents.
import { mkdirSync, writeFileSync } from "node:fs";
const UA = "Mozilla/5.0 (compatible; ContraxBot/1.0; +https://www.contrax.company)";
const dir = "src/jobs/sources/fixtures/beacon";
mkdirSync(dir, { recursive: true });
const log: string[] = [];
const get = async (url: string) => {
  try {
    const r = await fetch(url, { headers: { "user-agent": UA }, signal: AbortSignal.timeout(25000) });
    const b = await r.text();
    log.push(`${url} | ${r.status} | ${b.length}`);
    return b;
  } catch (e) { log.push(`${url} | ERR ${String(e).slice(0, 100)}`); return ""; }
};
const page = await get("https://www.beaconbid.com/solicitations/city-of-houston/open");
const queue = [...page.matchAll(/<script[^>]+src="([^"]+)"/g)].map((m) => m[1]);
const seen = new Set<string>();
const found = new Set<string>();
while (queue.length && seen.size < 80) {
  const u = queue.shift()!;
  if (seen.has(u)) continue;
  seen.add(u);
  const js = await get(u);
  for (const m of js.matchAll(/["'`](\.{0,2}\/?(?:assets\/)?(?:js\/)?[A-Za-z0-9_-]+-[A-Za-z0-9_-]{6,}\.js)["'`]/g)) {
    const next = new URL(m[1], u).href;
    if (!seen.has(next) && next.includes("assets.beaconbid.com")) queue.push(next);
  }
  for (const m of js.matchAll(/["'`]([^"'`\s]{0,60}(?:\/api\/|api\.beaconbid|solicitation)[^"'`\s]{0,100})["'`]/gi)) found.add(m[1]);
  await new Promise((r) => setTimeout(r, 300));
}
writeFileSync(`${dir}/endpoints.txt`, [...found].sort().join("\n") + "\n");
writeFileSync(`${dir}/look.txt`, log.join("\n") + "\n");
