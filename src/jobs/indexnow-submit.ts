/**
 * After each bid sync: tell IndexNow about the bid pages that sync created (see src/lib/indexnow.ts).
 * Same page filter as /sitemap-bids.xml: open, not low-content, not an award row, one page per notice.
 * SYNC_STARTED_AT (set by sync-bids.yml just before the sync) limits it to pages that are new this run.
 * Always exits 0: indexing is never a reason to fail a sync.
 */
import { sql } from "~/db";
import { LOW_CONTENT_SQL } from "~/lib/low-content";
import { AWARD_EXCLUSION_SQL } from "~/lib/source-class";
import { noticeKeySql } from "~/lib/notice-dedupe";
import { bidCanonicalUrl } from "~/lib/bid-seo";
import { INDEXNOW_SITEMAPS, sitemapLocs, submitIndexNow } from "~/lib/indexnow";
import { SITE_URL } from "~/lib/bid-seo";

/**
 * `--pages` or `--all`: resubmit what the live sitemaps list (see INDEXNOW_SITEMAPS). Used after the
 * pages themselves change, so Bing (and ChatGPT's search, which leans on it) reads the new version
 * without waiting for its own schedule. No database is read.
 */
async function resubmit(which: keyof typeof INDEXNOW_SITEMAPS) {
  const urls: string[] = [];
  for (const path of INDEXNOW_SITEMAPS[which]) {
    try {
      const res = await fetch(`${SITE_URL}${path}`, { headers: { "User-Agent": "Mozilla/5.0 (compatible; ContraxBot/1.0; +https://www.contrax.company)" }, signal: AbortSignal.timeout(60_000) });
      const locs = res.ok ? sitemapLocs(await res.text()) : [];
      console.log(`[indexnow] ${path}: ${res.status}, ${locs.length} pages`);
      urls.push(...locs);
    } catch (e) {
      console.log(`[indexnow] ${path}: skipped (${(e as Error).message})`);
    }
  }
  if (!urls.length) { console.log("[indexnow] nothing to resubmit"); return; }
  const r = await submitIndexNow(urls);
  console.log(`[indexnow] resubmitted (${which}): sent ${r.sent}; accepted: ${r.accepted}${r.errors.length ? `; errors: ${r.errors.join(", ")}` : ""}`);
}

async function main() {
  if (process.argv.includes("--all")) return resubmit("all");
  if (process.argv.includes("--pages")) return resubmit("pages");
  const since = new Date(process.env.SYNC_STARTED_AT ?? Date.now() - 6 * 3600_000);
  if (Number.isNaN(since.getTime())) { console.log("[indexnow] bad SYNC_STARTED_AT; skipped"); return; }
  const rows = (await sql()`
    SELECT id FROM (
      SELECT DISTINCT ON (${sql().unsafe(noticeKeySql("bids"))}) id, created_at
      FROM bids
      WHERE due_date > NOW()
        AND ${sql().unsafe(LOW_CONTENT_SQL)}
        AND ${sql().unsafe(AWARD_EXCLUSION_SQL)}
      ORDER BY ${sql().unsafe(noticeKeySql("bids"))}, created_at DESC NULLS LAST
    ) t
    WHERE created_at >= ${since.toISOString()}
  `) as { id: number }[];
  const urls = rows.map((r) => bidCanonicalUrl(Number(r.id)));
  if (!urls.length) { console.log("[indexnow] no new bid pages this sync"); return; }
  const r = await submitIndexNow(urls);
  console.log(`[indexnow] new bid pages: ${urls.length}; accepted: ${r.accepted}${r.errors.length ? `; errors: ${r.errors.join(", ")}` : ""}`);
}

main().catch((e) => console.log("[indexnow] skipped:", (e as Error).message)).finally(() => process.exit(0));
