/**
 * Federal trade data sync (owner 2026-10-13): contracts ending soon every run,
 * state spending figures when they are a week old. Run by
 * .github/workflows/sync-federal-trade-data.yml.
 *
 *   --dry-run          fetch and parse only, no database
 *   --spending         refresh spending figures even if fresh
 *   --trades=a,b       limit to these trade slugs
 *   --max-pages=N      page cap per trade for the contract walk
 */
import { spendingAgeDays, spendingMissingTrades, syncRecompetes, syncTradeSpending } from "~/lib/federal-trade-data.server";

const args = process.argv.slice(2);
const dryRun = args.includes("--dry-run");
const arg = (name: string) => args.find((a) => a.startsWith(`--${name}=`))?.split("=")[1];
const trades = arg("trades")?.split(",").filter(Boolean);
const maxPages = arg("max-pages") ? Number(arg("max-pages")) : undefined;
const log = (s: string) => console.log(s);

try {
  const rec = await syncRecompetes({ dryRun, trades, maxPages, log });
  const kept = rec.reduce((n, r) => n + r.kept, 0);
  console.log(`[federal-trade] recompetes: ${rec.length} trades, ${kept} contracts ending in the window${dryRun ? " (dry run)" : ""}`);
  const errors = rec.reduce((n, r) => n + r.errors, 0);
  // A dry run (the PR check) must fail when the API refuses a request, so a bad
  // filter can't pass review the way the decimal amount bands did.
  if (dryRun && errors > 0) {
    console.error(`[federal-trade] dry run: ${errors} walk(s) failed`);
    process.exit(1);
  }

  const force = args.includes("--spending") || dryRun;
  const age = dryRun ? Infinity : await spendingAgeDays();
  // Trades a stopped run never reached are filled in on the next run, not a week later.
  const missing = dryRun ? [] : await spendingMissingTrades();
  if (force || age >= 7) {
    const sp = await syncTradeSpending({ dryRun, trades, log });
    console.log(`[federal-trade] spending FY${sp.fiscalYear}: ${sp.rows} state rows${dryRun ? " (dry run)" : ""}`);
  } else if (missing.length) {
    const sp = await syncTradeSpending({ trades: missing, log });
    console.log(`[federal-trade] spending FY${sp.fiscalYear}: filled ${missing.join(", ")} (${sp.rows} state rows)`);
  } else {
    console.log(`[federal-trade] spending is ${age.toFixed(1)} days old; next refresh at 7`);
  }
  process.exit(0);
} catch (err) {
  console.error("[federal-trade] sync failed:", err);
  process.exit(1);
}
