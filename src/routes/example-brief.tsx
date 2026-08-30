import { createFileRoute } from "@tanstack/react-router";
import ExampleBrief from "~/components/ExampleBrief";

/**
 * /example-brief — a PUBLIC, unauthenticated sample of an AI Executive Brief.
 *
 * Owner requirement (2026-08-29): the homepage "How it works" step-02 card
 * ("See an example brief") must open a REAL, pre-GENERATED sample brief
 * immediately — no Contract Radar wizard, no signup gate, no paid generate call.
 *
 * This route shares its data loading and rendering with the homepage embed via
 * the single source of truth in src/lib/example-brief.ts (the `getExampleBrief`
 * server fn) and src/components/ExampleBrief.tsx (the renderer). It reads a
 * single real bid that already has a cached `ai_summary` (a genuinely
 * pre-generated brief) straight from the DB `ai_summary` JSONB column and
 * renders it with the same read-only presentation as the interactive
 * RfpSummaryCard. It never calls the paid /api/bids/:id/analyze endpoint, never
 * requires authentication, and shows no allowance UI — it is pure, honest,
 * cached content labeled as an EXAMPLE.
 *
 * The sample is selected as the richest available cached brief (most
 * mandatory_requirements + red_flags, newest first); whatever is stored is
 * rendered exactly as-is — never fabricated.
 */
function ExampleBriefPage() {
  return (
    <main className="min-h-screen bg-slate-950 text-slate-100">
      <div className="mx-auto w-full max-w-2xl px-5 py-8">
        <a
          href="/"
          className="self-start text-sm font-bold tracking-tight text-amber-400 hover:text-amber-300"
        >
          ⬢ CONTRAX
        </a>

        {/* Honest EXAMPLE label + shared renderer (loads real cached brief). */}
        <div className="mt-6">
          <ExampleBrief variant="page" />
        </div>
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
