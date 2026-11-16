/**
 * Trade coverage — CLI entrypoint (`bun run trade-coverage`), run by hand from
 * .github/workflows/trade-coverage.yml (owner 2026-11-16: "we need more janitorial sources
 * nationwide"). For one trade it prints, per state, the open bids a member's Radar search would
 * show for that state and the sources they came from. READ-ONLY: it changes nothing and
 * sends nothing. The output between the markers is one JSON object.
 */
import { sql } from "~/db";
import { STATE_NAMES } from "~/lib/contract-map";
import { stateRadarMatches } from "~/lib/radar-candidates";
import { SEO_TRADE_BY_SLUG } from "~/lib/seo-trades";
import { coverageRow, sourceTotals, thinnest } from "~/lib/trade-coverage";

async function main() {
  const slug = process.env.TRADE ?? "janitorial";
  const trade = SEO_TRADE_BY_SLUG[slug as keyof typeof SEO_TRADE_BY_SLUG];
  if (!trade) throw new Error(`Unknown trade "${slug}". Known: ${Object.keys(SEO_TRADE_BY_SLUG).join(", ")}`);
  const rows = [];
  let nationwide = 0;
  for (const state of Object.keys(STATE_NAMES).sort()) {
    const split = await stateRadarMatches(sql, { trade: trade.radarTerm, state });
    rows.push(coverageRow(state, split.local));
    nationwide = Math.max(nationwide, split.nationwide.length);
  }
  console.log("===TRADE-COVERAGE-JSON-START===");
  console.log(JSON.stringify({ trade: slug, nationwide, states: thinnest(rows).map((r) => ({ state: r.state, open: r.open, federal: r.federal, local: r.open - r.federal, sources: r.sources })), sources: sourceTotals(rows) }));
  console.log("===TRADE-COVERAGE-JSON-END===");
}

if (import.meta.main) {
  main()
    .then(() => process.exit(0))
    .catch((e) => {
      console.error("💥 Trade coverage crashed:", e);
      process.exit(1);
    });
}
