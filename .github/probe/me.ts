// Temp probe: Maine Vendor Self Service as ContraxBot (robots.txt first). Read-only, counts only. Removed after.
import { fetchVssBids } from "../../src/jobs/sources/advantage-vss";
const UA = "Mozilla/5.0 (compatible; ContraxBot/1.0; +https://www.contrax.company)";
const origin = "https://mevss.hostams.com";
const rb = await fetch(`${origin}/robots.txt`, { headers: { "User-Agent": UA } }).then(async (r) => `${r.status} ${(await r.text()).slice(0, 400)}`).catch((e) => `ERR ${e}`);
console.log("ROBOTS", JSON.stringify(rb));
try {
  const res = await fetchVssBids({ source: "me_vss", origin, idPrefix: "mevss", stateName: "Maine", portalName: "Maine Vendor Self Service (VSS)", biddableTypes: new Set(["IFB", "IFB1", "RFP", "RFQ", "RFQ1", "RFI", "ITN", "DQ1", "RFA"]), userAgent: UA });
  console.log("ME rows", res.rows.length, JSON.stringify(res.skipped));
  console.log("ME sample", JSON.stringify(res.rows.slice(0, 5).map((r: any) => ({ t: r.title, a: r.agency, d: r.due_date, n: r.notice_type }))));
  console.log("ME types", JSON.stringify((res.skippedRows ?? []).slice(0, 15)));
} catch (e) { console.log("ME ERR", String(e).slice(0, 300)); }
process.exit(0);
