// Temporary look at Beacon, pass 2 (owner 2026-11-03: Houston). Saves the
// GraphQL query texts the public pages use (from the site's own script files),
// so the public open-solicitations call can be made the same way the page does.
import { mkdirSync, writeFileSync } from "node:fs";
const UA = "Mozilla/5.0 (compatible; ContraxBot/1.0; +https://www.contrax.company)";
const dir = "src/jobs/sources/fixtures/beacon";
mkdirSync(dir, { recursive: true });
const files = [
  "https://assets.beaconbid.com/assets/app-gYPUuBVR.js",
  "https://assets.beaconbid.com/assets/context-BPZS2PDz.js",
  "https://assets.beaconbid.com/assets/js/grid-BGz5cYAK.js",
];
const out: string[] = [];
for (const u of files) {
  const js = await (await fetch(u, { headers: { "user-agent": UA }, signal: AbortSignal.timeout(30000) })).text();
  for (const m of js.matchAll(/(?:query|fragment)\s+[A-Za-z0-9_]+[\s\S]{0,3000}?(?=`)/g)) {
    if (/olicitation|[Aa]gency/.test(m[0])) out.push(`// ${u}\n${m[0]}`);
  }
  // Route/path hints for the public agency pages.
  for (const m of js.matchAll(/["'`]\/solicitations\/[^"'`]{0,80}["'`]/g)) out.push(`// route ${m[0]}`);
  await new Promise((r) => setTimeout(r, 500));
}
writeFileSync(`${dir}/gql-queries.txt`, out.join("\n\n") + "\n");
console.log(`saved ${out.length} snippets`);
