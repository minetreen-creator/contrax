// Read-only probe: which Connecticut buyers post on CTsource / BidNet (last 120 days). Agency names and counts only.
import { sql } from "~/db";
const s = sql();
const rows = (await s`
  SELECT source, agency, COUNT(*)::int AS n FROM bids
  WHERE (source LIKE 'ct\\_%') AND created_at > NOW() - INTERVAL '120 days'
  GROUP BY 1, 2 ORDER BY 3 DESC`) as { source: string; agency: string; n: number }[];
const big = /hartford|new haven|bridgeport|stamford|waterbury|norwalk|danbury|new britain|west hartford|greenwich|school|board of ed|public schools/i;
console.log("BIG/SCHOOL BUYERS:");
for (const r of rows.filter((r) => big.test(r.agency ?? ""))) console.log(`  ${r.source} | ${r.agency} | ${r.n}`);
console.log("CTSOURCE TOP 40:", rows.filter((r) => r.source === "ct_webprocure").slice(0, 40).map((r) => `${r.agency} ${r.n}`).join("; "));
process.exit(0);
