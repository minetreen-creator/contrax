/**
 * Live Opportunities — homepage section data.
 *
 * Server-only query for the "Live set-aside opportunities" strip on the public
 * homepage. Pulls REAL, currently-active set-aside solicitations straight from
 * the `bids` table (fed by the SAM.gov sync; a GH Actions cron runs every 4h).
 * Nothing here is fabricated: every card renders actual `bids` columns.
 *
 * Selection rules (all existing homepage conventions):
 *   - SET-ASIDE ONLY: `set_aside IN ('8(a)','SDVOSB','WOSB','HUBZone')` — the
 *     four certifications the product targets. Unrestricted solicitations are
 *     deliberately excluded so the strip stays on-message ("set-aside
 *     opportunities the big firms miss").
 *   - OPEN ONLY: `due_date > NOW()` — a deadline in the future. A bid whose
 *     deadline has passed never appears.
 *   - LOW-CONTENT FILTER APPLICATION (PR #174): the shared
 *     LOW_CONTENT_SQL predicate, exactly like getRecentBids/getClosingSoonBids,
 *     so junk rows ("title < 5 words + placeholder location + no set-aside")
 *     can never surface. Set-asides can't actually be low-content (the
 *     predicate treats any set-aside as content), but applying it keeps the
 *     listing surface byte-consistent with every other public surface.
 *   - DISTINCT ON (title, agency): same natural-key dedupe as
 *     getRecentBids/getClosingSoonBids (PR #171/#172) so a solicitation
 *     ingested by multiple state-keyword sync sources can NEVER appear twice.
 *   - Newest-first (`created_at DESC`) so visitors see the freshest postings;
 *     bounded to 5 rows. Evaluation-only — the section hides entirely when the
 *     query (or table) fails rather than ever 500ing the homepage.
 *
 * Performance: this is a tiny indexed-equivalent query (WHERE set_aside IN
 * (…,5 values) + due_date > NOW(), DISTINCT ON, LIMIT 5) fetching 6 short
 * columns; it adds one parallel fetch to the existing getLandingData
 * Promise.all (same shape as getClosingSoonBids). No new tables, no new sync
 * jobs, no cache table — the bids rows are already what every other strip
 * renders.
 */
import { LOW_CONTENT_SQL } from "~/lib/low-content";

export type LiveOpportunity = {
  id: number;
  title: string;
  agency: string;
  location: string | null;
  category: string | null;
  set_aside: string | null;
  due_date: string | null;
};

export async function getLiveOpportunities(): Promise<LiveOpportunity[]> {
  try {
    const { sql } = await import("~/db");
    const rows = await sql()`
      SELECT id, title, agency, location, category, set_aside, due_date
      FROM (
        SELECT DISTINCT ON (title, agency)
               id, title, agency, location, category, set_aside, due_date, created_at
        FROM bids
        WHERE due_date > NOW()
          AND set_aside IN ('8(a)', 'SDVOSB', 'WOSB', 'HUBZone')
          AND ${sql().unsafe(LOW_CONTENT_SQL)}
        ORDER BY title, agency, created_at DESC NULLS LAST
      ) t
      ORDER BY t.created_at DESC NULLS LAST
      LIMIT 5
    `;
    return rows as LiveOpportunity[];
  } catch (err) {
    // Never break the homepage over a listing strip. The section hides itself
    // on an empty result and the rest of the page renders untouched.
    console.error("[live-opportunities] failed to load:", err);
    return [];
  }
}