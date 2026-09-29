/** Read-only, temporary production-corpus diagnosis for issue #483. */
import { sql } from "../src/db";
import { expandTrade, tradeKeywordPred, isStrongTradeMatch } from "../src/lib/trade-registry";
import { sbCertFragment, certMatches } from "../src/lib/cert-matching";
import { runKeywordScanQuery } from "../src/lib/radar-scan-query";
import { LOW_CONTENT_SQL } from "../src/lib/low-content";
import { AWARD_EXCLUSION_SQL } from "../src/lib/source-class";

const expansion = expandTrade("freight delivery");
const codes = expansion.naicsCodes;
const db = sql();
const counts = await db`
  SELECT COUNT(*)::int AS open_code_rows,
         COUNT(*) FILTER (WHERE ${db.unsafe(LOW_CONTENT_SQL)})::int AS content_rows,
         COUNT(*) FILTER (WHERE ${db.unsafe(LOW_CONTENT_SQL)} AND ${db.unsafe(AWARD_EXCLUSION_SQL)})::int AS nonaward_rows
  FROM bids WHERE due_date > NOW() AND naics_code = ANY(${codes})`;

const candidates = await runKeywordScanQuery(sql, {
  certFrag: sbCertFragment(sql),
  tradeFrag: tradeKeywordPred(db, expansion),
}, LOW_CONTENT_SQL);
const included = candidates.filter((r) => certMatches(r.set_aside, [r.source], "sb") === "include");
const strong = included.filter((r) => isStrongTradeMatch(r.title, r.category, r.description, r.naics_code, expansion));

console.log(JSON.stringify({
  diagnosis: "issue-483-freight-delivery",
  at: new Date().toISOString(),
  codes,
  openCodeRows: counts[0]?.open_code_rows ?? 0,
  contentRows: counts[0]?.content_rows ?? 0,
  nonawardRows: counts[0]?.nonaward_rows ?? 0,
  radarCandidateWindow: candidates.length,
  afterCert: included.length,
  strongBeforeOtherFilters: strong.length,
  strongCodes: [...new Set(strong.map((r) => r.naics_code).filter(Boolean))],
}));
