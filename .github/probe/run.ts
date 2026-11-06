// Read-only: one call to Beacon's public list for the City of Destin (the same call its open page makes).
import { mkdirSync, writeFileSync } from "node:fs";
import { BEACON_GQL, LIST_SOLICITATIONS } from "../../src/jobs/sources/tx-houston-beacon";
const r = await fetch(BEACON_GQL, {
  method: "POST",
  headers: { "user-agent": "Mozilla/5.0 (compatible; ContraxBot/1.0; +https://www.contrax.company)", "content-type": "application/json", accept: "application/json", referer: "https://www.beaconbid.com/solicitations/city-of-destin/open" },
  body: JSON.stringify({ operationName: "ListSolicitations", query: LIST_SOLICITATIONS, variables: { agencyTag: "city-of-destin", status: "open", start: 0, pageSize: 100 } }),
  signal: AbortSignal.timeout(25000),
});
const body = await r.text();
console.log("status", r.status, "bytes", body.length);
try { const j = JSON.parse(body); console.log("total", j?.data?.solicitations?.total, "errors", JSON.stringify(j?.errors ?? null).slice(0, 200)); for (const s of j?.data?.solicitations?.data ?? []) console.log(` ${s.dueDate?.utcDate ?? s.dueDate} | ${s.type} | ${s.refnum} | ${String(s.title).slice(0, 90)}`); } catch { console.log(body.slice(0, 300)); }
if (r.ok) { mkdirSync("src/jobs/sources/fixtures/fl-destin-beacon", { recursive: true }); writeFileSync("src/jobs/sources/fixtures/fl-destin-beacon/open-2026-11-06.json", body); }
process.exit(0);
