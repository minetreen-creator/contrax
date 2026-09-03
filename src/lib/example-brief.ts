import { createServerFn } from "@tanstack/react-start";
import { sql } from "~/db";
import type { RfpSummary } from "~/components/RfpSummaryCard";

/**
 * Shared single source of truth for loading the homepage / /example-brief
 * example AI Executive Brief.
 *
 * The brief is a REAL, PRE-GENERATED cached `ai_summary` JSONB from the bids
 * table — never fabricated on the fly. It is read here once and consumed by
 * BOTH:
 *   - the standalone route  src/routes/example-brief.tsx
 *   - the homepage embed     src/routes/index.tsx (via src/components/ExampleBrief.tsx)
 *
 * This keeps one canonical query/mapper so the two surfaces can never diverge
 * (same richest-available-brief selection, same honest mapping — no invented
 * requirements, deadlines, or red flags).
 *
 * The richest available brief is selected as the one with the most
 * mandatory_requirements + red_flags, newest first, so the example looks
 * substantive. At present only a few bids have cached summaries; whatever is
 * selected is rendered exactly as stored.
 */

export interface ExampleBrief {
  id: number;
  title: string;
  agency: string | null;
  set_aside: string | null;
  due_date: string | null;
  source_url: string | null;
  location: string | null;
  estimated_value: string | null;
  summary: RfpSummary | null;
  /** Real NAICS code from the bids row — used as a trade fallback when the
   *  brief's `trade_category` is missing or "Unknown". */
  naics_code: string | null;
  generatedAt: string | null;
}

/** Pick the richest available cached brief. Honest — never fabricated. */
export const getExampleBrief = createServerFn({ method: "GET" }).handler(
  async (): Promise<ExampleBrief | null> => {
    try {
      const rows = (await sql()`
        SELECT id, title, agency, set_aside, due_date, source_url, location,
               estimated_value, naics_code, ai_summary, ai_summary_at
        FROM bids
        WHERE ai_summary IS NOT NULL
        ORDER BY
          (jsonb_array_length(ai_summary->'mandatory_requirements')
           + jsonb_array_length(ai_summary->'red_flags')) DESC,
          ai_summary_at DESC
        LIMIT 1
      `) as any[];
      if (!rows.length) return null;
      const r = rows[0];
      let summary: RfpSummary | null = null;
      if (r.ai_summary && typeof r.ai_summary === "object" && r.ai_summary.summary) {
        summary = {
          summary: String(r.ai_summary.summary ?? ""),
          mandatory_requirements: Array.isArray(r.ai_summary.mandatory_requirements)
            ? r.ai_summary.mandatory_requirements.map((x: any) => ({
                text: String(x?.text ?? ""),
                source: String(x?.source ?? ""),
              }))
            : [],
          key_milestones: Array.isArray(r.ai_summary.key_milestones)
            ? r.ai_summary.key_milestones.map((x: any) => ({
                event: String(x?.event ?? ""),
                date: x?.date == null ? null : String(x.date),
                source: String(x?.source ?? ""),
              }))
            : [],
          trade_category: String(r.ai_summary.trade_category ?? ""),
          red_flags: Array.isArray(r.ai_summary.red_flags)
            ? r.ai_summary.red_flags.map((x: any) => ({
                text: String(x?.text ?? ""),
                source: String(x?.source ?? ""),
              }))
            : [],
        };
      }
      return {
        id: Number(r.id),
        title: String(r.title ?? ""),
        agency: r.agency ? String(r.agency) : null,
        set_aside: r.set_aside ? String(r.set_aside) : null,
        due_date: r.due_date ? String(r.due_date) : null,
        source_url: r.source_url ? String(r.source_url) : null,
        location: r.location ? String(r.location) : null,
        estimated_value: r.estimated_value ? String(r.estimated_value) : null,
        summary,
        naics_code: r.naics_code ? String(r.naics_code) : null,
        generatedAt: r.ai_summary_at ? String(r.ai_summary_at) : null,
      };
    } catch (e) {
      console.error("[example-brief] load failed:", e);
      return null;
    }
  },
);
