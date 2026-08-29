import { createFileRoute } from "@tanstack/react-router";
import { createServerFn } from "@tanstack/react-start";
import { useEffect, useState } from "react";
import { sql } from "~/db";
import {
  RfpBriefSections,
  type RfpSummary,
} from "~/components/RfpSummaryCard";

/**
 * /example-brief — a PUBLIC, unauthenticated sample of an AI Executive Brief.
 *
 * Owner requirement (2026-08-29): the homepage "How it works" step-02 card
 * ("See an example brief") must open a REAL, pre-GENERATED sample brief
 * immediately — no Contract Radar wizard, no signup gate, no paid generate call.
 *
 * This route reads a single real bid that already has a cached `ai_summary`
 * (a genuinely pre-generated brief) straight from the DB `ai_summary` JSONB
 * column and renders it with the same read-only presentation as the interactive
 * RfpSummaryCard. It never calls the paid /api/bids/:id/analyze endpoint, never
 * requires authentication, and shows no allowance UI — it is pure, honest,
 * cached content labeled as an EXAMPLE.
 *
 * The sample bid is selected as the richest available cached brief
 * (most mandatory_requirements + red_flags, newest first) so the example looks
 * substantive when multiple cached briefs exist; at present only bid 125568 has
 * a cached summary, and it is intentionally rendered as-is (its short source
 * notice means its requirement/red-flag arrays are naturally sparse — never
 * fabricated).
 */

interface ExampleBrief {
  id: number;
  title: string;
  agency: string | null;
  set_aside: string | null;
  due_date: string | null;
  source_url: string | null;
  location: string | null;
  estimated_value: string | null;
  summary: RfpSummary | null;
  generatedAt: string | null;
}

/** Pick the richest available cached brief. Honest — never fabricated. */
const getExampleBrief = createServerFn({ method: "GET" }).handler(
  async (): Promise<ExampleBrief | null> => {
    try {
      const rows = (await sql()`
        SELECT id, title, agency, set_aside, due_date, source_url, location,
               estimated_value, ai_summary, ai_summary_at
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
        generatedAt: r.ai_summary_at ? String(r.ai_summary_at) : null,
      };
    } catch (e) {
      console.error("[example-brief] load failed:", e);
      return null;
    }
  },
);

function ExampleBriefPage() {
  const [brief, setBrief] = useState<ExampleBrief | null | undefined>(undefined);
  useEffect(() => {
    let active = true;
    getExampleBrief().then((b) => {
      if (active) setBrief(b);
    });
    return () => {
      active = false;
    };
  }, []);
  const due = brief?.due_date
    ? new Date(brief.due_date).toLocaleDateString("en-US", {
        month: "short",
        day: "numeric",
        year: "numeric",
      })
    : null;
  return (
    <main className="min-h-screen bg-slate-950 text-slate-100">
      <div className="mx-auto w-full max-w-2xl px-5 py-8">
        <a
          href="/"
          className="self-start text-sm font-bold tracking-tight text-amber-400 hover:text-amber-300"
        >
          ⬢ CONTRAX
        </a>

        {/* Honest EXAMPLE label — this is a pre-generated sample, not an ad. */}
        <div className="mt-6 rounded-xl border border-amber-500/40 bg-amber-500/10 px-4 py-3 text-center">
          <p className="text-xs font-bold uppercase tracking-wide text-amber-400">
            ★ Example AI Executive Brief
          </p>
          <p className="mt-1 text-xs leading-relaxed text-amber-200/80">
            This brief was pre-generated from a real solicitation. No signup
            required to view it.
          </p>
        </div>

        {brief === undefined && (
          <p className="mt-8 text-sm text-slate-400">Loading example brief…</p>
        )}
        {brief === null && (
          <div className="mt-8 rounded-2xl border border-dashed border-slate-700 bg-slate-900/60 px-5 py-10 text-center text-sm text-slate-300">
            No example brief is available right now. Please check back later.
          </div>
        )}
        {brief && (
          <>
            <article className="mt-6 overflow-hidden rounded-2xl border border-slate-700 bg-slate-900">
              <div className="border-b border-slate-800 px-5 py-4">
                <h1 className="text-lg font-extrabold leading-snug text-white">
                  {brief.title || "Solicitation"}
                </h1>
                {brief.agency && (
                  <p className="mt-1 text-sm text-slate-400">{brief.agency}</p>
                )}
                <p className="mt-2 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs font-medium text-slate-300">
                  <span>{brief.set_aside || "Open to small business"}</span>
                  {brief.location && (
                    <>
                      <span aria-hidden="true">·</span>
                      <span>{brief.location}</span>
                    </>
                  )}
                  {brief.estimated_value && (
                    <>
                      <span aria-hidden="true">·</span>
                      <span>{brief.estimated_value} estimated</span>
                    </>
                  )}
                  {due && (
                    <>
                      <span aria-hidden="true">·</span>
                      <span>Due {due}</span>
                    </>
                  )}
                </p>
              </div>
              {brief.source_url && (
                <div className="px-5 py-3">
                  <a
                    href={brief.source_url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-sm font-semibold text-amber-400 hover:text-amber-300"
                  >
                    Open original notice ↗
                  </a>
                </div>
              )}
            </article>

            {/* Same visual treatment as RfpSummaryCard — read-only cached brief. */}
            {brief.summary ? (
              <section className="mt-5 overflow-hidden rounded-2xl border border-slate-700 bg-slate-900">
                <div className="flex items-center justify-between gap-3 border-b border-slate-800 bg-gradient-to-r from-amber-500/15 to-transparent px-5 py-4">
                  <p className="text-xs font-semibold uppercase tracking-wide text-amber-400">
                    ✦ AI Executive Brief
                  </p>
                  <span className="text-[11px] text-slate-500">
                    example · pre-generated
                  </span>
                </div>
                <div className="px-5 py-4">
                  <RfpBriefSections data={brief.summary} />
                </div>
              </section>
            ) : (
              <p className="mt-5 text-sm text-slate-400">
                This solicitation has no executive brief on file.
              </p>
            )}

            {/* Non-gated way to see it on your own trade. */}
            <p className="mt-8 rounded-xl bg-slate-900/60 px-4 py-3 text-center text-sm text-slate-300">
              Want briefs like this for your own trade?{" "}
              <a href="/radar" className="font-semibold text-amber-400 hover:text-amber-300">
                Find your matching bids free →
              </a>
            </p>
          </>
        )}
      </div>
    </main>
  );
}

export const Route = createFileRoute("/example-brief")({
  component: ExampleBriefPage,
  head: () => ({
    meta: [
      {
        title: "Example AI Executive Brief — Contrax",
      },
      {
        name: "description",
        content:
          "A real, pre-generated AI Executive Brief from Contrax, showing how the mandatory requirements, key deadlines, and red flags of a government solicitation are extracted in seconds.",
      },
    ],
  }),
});
