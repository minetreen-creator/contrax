/**
 * Trade coverage — CLI entrypoint (`bun run trade-coverage`), run by hand from
 * .github/workflows/trade-coverage.yml (owner 2026-11-16: "we need more janitorial sources
 * nationwide"). For one trade it prints, per state, the open bids a member's Radar search would
 * show for that state and the sources they came from. READ-ONLY: it changes nothing and
 * sends nothing. The output between the markers is one JSON object.
 */
import { sql } from "~/db";
import { STATE_NAMES } from "~/lib/contract-map";
import { defaultRadarMatches, stateRadarMatches } from "~/lib/radar-candidates";
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
  // Where the federal notices go (owner 2026-11-16: SAM reports 209 janitorial notices, a member
  // sees 7). Counts only, read-only: what is stored, what is still open, and what a search with
  // no state keeps.
  const federal: Record<string, unknown> = {};
  try {
    const s = sql();
    const like = slug === "janitorial" ? ["sam_naics_561720", "sam_psc_s201"] : [];
    if (like.length) {
      federal.stored = await s`SELECT source, count(*)::int AS n, count(*) FILTER (WHERE due_date > NOW())::int AS open, count(*) FILTER (WHERE due_date IS NULL)::int AS no_date FROM bids WHERE source = ANY(${like}) GROUP BY source`;
      federal.openByType = await s`SELECT COALESCE(notice_type, '(none)') AS notice_type, count(*)::int AS n FROM bids WHERE source = ANY(${like}) AND due_date > NOW() GROUP BY 1 ORDER BY 2 DESC`;
      federal.openBySetAside = await s`SELECT COALESCE(NULLIF(btrim(set_aside), ''), '(none)') AS set_aside, count(*)::int AS n FROM bids WHERE source = ANY(${like}) AND due_date > NOW() GROUP BY 1 ORDER BY 2 DESC LIMIT 15`;
      federal.openByLocation = await s`SELECT COALESCE(NULLIF(btrim(location), ''), '(none)') AS location, count(*)::int AS n FROM bids WHERE source = ANY(${like}) AND due_date > NOW() GROUP BY 1 ORDER BY 2 DESC LIMIT 25`;
    }
    const anyState = await defaultRadarMatches(sql, { trade: trade.radarTerm, state: "" });
    federal.searchWithNoState = { all: anyState.length, federal: anyState.filter((r: { source?: unknown }) => /^sam/i.test(String(r.source ?? ""))).length };
  } catch (e) {
    federal.error = e instanceof Error ? e.message : String(e);
  }
  console.log("===TRADE-COVERAGE-JSON-START===");
  console.log(JSON.stringify({ trade: slug, nationwide, states: thinnest(rows).map((r) => ({ state: r.state, open: r.open, federal: r.federal, local: r.open - r.federal, sources: r.sources })), sources: sourceTotals(rows), federal }));
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
