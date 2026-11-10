// Read-only probe: are the hand-contacted and not-a-fit suppressions stored in the database? Counts only.
import { sql } from "~/db";
import { CONTACTED_BY_HAND, NOT_A_FIT } from "~/lib/outreach";
const s = sql();
const have = (await s`SELECT email, reason FROM outreach_suppressions WHERE email = ANY(${[...CONTACTED_BY_HAND, ...NOT_A_FIT]})`) as { email: string; reason: string }[];
const set = new Set(have.map((r) => r.email));
console.log(`contacted_by_hand in code ${CONTACTED_BY_HAND.length}, stored ${CONTACTED_BY_HAND.filter((e) => set.has(e)).length}`);
console.log(`not_a_fit in code ${NOT_A_FIT.length}, stored ${NOT_A_FIT.filter((e) => set.has(e)).length}`);
process.exit(0);
