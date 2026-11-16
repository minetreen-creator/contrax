/**
 * Loads the homepage bid preview (see ~/lib/bid-preview): for each trade, the best real open bid
 * that already has a generated brief, chosen by the same rules as the example brief
 * (~/lib/brief-source: open, complete, no pre-bid date already past, the brief's deadline equal to
 * the bid's due date, and the brief still matching the notice it was made from). Reads only;
 * nothing is generated here. Kept in memory for a few minutes per server instance.
 */
import { createServerFn } from "@tanstack/react-start";
import {
  PREVIEW_MIN_DAYS_LEFT, PREVIEW_MIN_NOTICE_CHARS, PREVIEW_TRADES, previewExcerpt, wordCount,
  type BidPreview, type PreviewTrade,
} from "~/lib/bid-preview";

const TTL_MS = 15 * 60 * 1000;
/** Bids considered per trade, richest brief first. */
const PER_TRADE = 8;
let cache: { at: number; previews: BidPreview[] } | null = null;

export const getBidPreviews = createServerFn({ method: "GET" }).handler(async (): Promise<BidPreview[]> => {
  if (cache && Date.now() - cache.at < TTL_MS) return cache.previews;
  try {
    const { sql } = await import("~/db");
    const { dateOnly, fingerprintFor, selectExampleBrief } = await import("~/lib/brief-source");
    const { tradeForText } = await import("~/lib/pipeline-report");
    type Row = import("~/lib/brief-source").ExampleBidRow;
    const s = sql();
    // Step 1: titles only, so the trade can be read from the title before any long text is loaded.
    const light = (await s`
      SELECT b.id, b.title FROM bids b
      WHERE b.ai_summary IS NOT NULL AND b.due_date IS NOT NULL
        AND b.due_date > NOW() + ${`${PREVIEW_MIN_DAYS_LEFT} days`}::interval
        AND b.source_url IS NOT NULL AND btrim(b.source_url) <> ''
        AND length(COALESCE(b.description, '')) >= ${PREVIEW_MIN_NOTICE_CHARS}
      ORDER BY
        (CASE WHEN jsonb_typeof(b.ai_summary->'mandatory_requirements') = 'array' THEN jsonb_array_length(b.ai_summary->'mandatory_requirements') ELSE 0 END
         + CASE WHEN jsonb_typeof(b.ai_summary->'red_flags') = 'array' THEN jsonb_array_length(b.ai_summary->'red_flags') ELSE 0 END) DESC,
        b.ai_summary_at DESC NULLS LAST
      LIMIT 3000`) as { id: number; title: string | null }[];
    const idsByTrade = new Map<PreviewTrade, number[]>();
    for (const r of light) {
      const t = tradeForText(String(r.title ?? "")) as PreviewTrade | null;
      if (!t || !(PREVIEW_TRADES as readonly string[]).includes(t)) continue;
      const list = idsByTrade.get(t) ?? [];
      if (list.length < PER_TRADE) idsByTrade.set(t, [...list, Number(r.id)]);
    }
    const ids = [...idsByTrade.values()].flat();
    if (!ids.length) {
      cache = { at: Date.now(), previews: [] };
      return [];
    }
    const rows = (await s`
      SELECT b.id, b.title, b.agency, b.description, b.category, b.set_aside,
             b.due_date, b.source_url, b.location, b.estimated_value, b.naics_code,
             b.updated_at, b.ai_summary, b.ai_summary_at,
             b.ai_summary_source_hash, b.ai_summary_schema_version, b.ai_summary_model,
             b.ai_summary_generated_from_updated_at,
             (SELECT max(a.detected_at) FROM bid_amendments a WHERE a.bid_id = b.id::text) AS latest_amendment_at
      FROM bids b WHERE b.id = ANY(${ids})`) as unknown as Row[];
    const byId = new Map(rows.map((r) => [Number(r.id), r]));
    const now = Date.now();
    const previews: BidPreview[] = [];
    for (const trade of PREVIEW_TRADES) {
      const mine = (idsByTrade.get(trade) ?? []).map((id) => byId.get(id)).filter((r): r is Row => Boolean(r));
      if (!mine.length) continue;
      const candidates = await Promise.all(mine.map(async (row) => ({ row, currentFingerprint: await fingerprintFor(row) })));
      const best = selectExampleBrief(candidates, now).best;
      const due = best ? dateOnly(best.row.due_date) : null;
      if (!best || !best.summary || !due) continue;
      const description = String(best.row.description ?? "");
      previews.push({
        trade, id: Number(best.row.id), title: String(best.row.title ?? ""),
        agency: best.row.agency ? String(best.row.agency) : null,
        location: best.row.location ? String(best.row.location) : null,
        due, notice: previewExcerpt(description),
        noticeChars: description.replace(/\s+/g, " ").trim().length, noticeWords: wordCount(description),
        summary: best.summary,
      });
    }
    cache = { at: Date.now(), previews };
    return previews;
  } catch (e) {
    console.error("[bid-preview] load failed (the widget hides):", e);
    return [];
  }
});
