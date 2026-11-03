// Temporary diagnostic (owner 2026-11-03: "yes" to fixing the six dead sources).
// Runs each dead reader once, no database, and prints its error.
import { TAIL_SOURCES } from "../../src/jobs/runner";
const names = ["or_oregonbuys", "tn_cpo", "ms_dfa", "il_chicago_dps", "nj_wall", "fl_pensacola"];
for (const n of names) {
  const s = TAIL_SOURCES.find((x) => x.name === n);
  if (!s) { console.log(`== ${n}: not in TAIL_SOURCES`); continue; }
  const t0 = Date.now();
  try {
    const r: any = await s.fetchFn();
    const rows = Array.isArray(r) ? r : r.rows;
    console.log(`== ${n}: OK ${rows.length} rows in ${Date.now() - t0} ms; skipped ${JSON.stringify(r.skipped ?? {})}`);
  } catch (e: any) {
    console.log(`== ${n}: FAIL in ${Date.now() - t0} ms: ${String(e?.message ?? e).slice(0, 400)}`);
    if (e?.details) console.log(`   details: ${JSON.stringify(e.details).slice(0, 800)}`);
    if (e?.errors) console.log(`   errors: ${JSON.stringify(e.errors).slice(0, 800)}`);
    if (e?.cause) console.log(`   cause: ${String(e.cause?.message ?? e.cause).slice(0, 400)}`);
  }
}
process.exit(0);
