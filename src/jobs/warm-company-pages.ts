/**
 * Recompute the open-bid list for every trade + state the company pages use (owner 2026-11-12).
 * Run after each bid sync by .github/workflows/warm-company-pages.yml, so a company page reads a
 * ready list (a first visit used to take 7 to 9 seconds while Radar's query ran).
 *
 *   bun run src/jobs/warm-company-pages.ts
 */
import { COMPANY_WARM_CONCURRENCY } from "~/lib/company-pages";
import { companyTradeStatePairs, computeTradeStateMatches } from "~/lib/company-pages.server";
import { SEO_TRADE_BY_SLUG } from "~/lib/seo-trades";

if (!process.env.DATABASE_URL) {
  console.error("[warm-company-pages] DATABASE_URL is not set");
  process.exit(1);
}
const started = Date.now();
const pairs = (await companyTradeStatePairs()).filter((p) => !!SEO_TRADE_BY_SLUG[p.trade]);
let done = 0;
let failed = 0;
let withBids = 0;
const queue = [...pairs];
await Promise.all(
  Array.from({ length: COMPANY_WARM_CONCURRENCY }, async () => {
    for (let p = queue.shift(); p; p = queue.shift()) {
      const t = SEO_TRADE_BY_SLUG[p.trade]!;
      try {
        const m = await computeTradeStateMatches({ slug: t.slug, radarTerm: t.radarTerm }, p.state);
        done++;
        if (m.count > 0) withBids++;
      } catch (e) {
        failed++;
        console.error(`[warm-company-pages] ${p.state} ${p.trade} failed: ${(e as Error).message}`);
      }
    }
  }),
);
console.log(`[warm-company-pages] pairs=${pairs.length} done=${done} with_bids=${withBids} failed=${failed} in ${((Date.now() - started) / 1000).toFixed(0)}s`);
// A few failed pairs keep their last list; only a run where most fail is an error.
process.exit(pairs.length > 0 && failed > pairs.length / 2 ? 1 : 0);
