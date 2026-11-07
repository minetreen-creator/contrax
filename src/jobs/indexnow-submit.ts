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
import { submitIndexNow } from "~/lib/indexnow";

async function main() {
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
