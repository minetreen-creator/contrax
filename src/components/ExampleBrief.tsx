import { useEffect, useState } from "react";
import { getExampleBrief, type ExampleBrief as ExampleBriefData } from "~/lib/example-brief";
import { RfpBriefSections } from "~/components/RfpSummaryCard";
import { trackEvent } from "~/lib/track";

/**
 * Reusable renderer for the REAL cached example AI Executive Brief.
 *
 * ONE source of truth for BOTH surfaces:
 *   - variant="page"  → the standalone /example-brief route (dark slate page).
 *   - variant="embed" → the homepage section just under the hero (light band,
 *                        dark evidence card — harmonises with the US map below).
 *
 * It loads the brief client-side on mount via the shared `getExampleBrief`
 * server fn (never the paid analyze endpoint), renders the exact real cached
 * data with RfpBriefSections, and keeps the honest "example · pre-generated"
 * labeling plus the "Open original notice ↗" source link in every state.
 *
 * Honesty contract (non-negotiable):
 *   - The content is REAL cached `ai_summary` — nothing is fabricated.
 *   - It is always labeled an EXAMPLE so it is never mistaken for a live notice
 *     or a claim it was generated live for this visitor.
 *   - If getExampleBrief returns null (no cached brief available), the brief
 *     collapses to a compact, honest fallback (never fake data, never breaks
 *     layout).
 */
export function ExampleBrief({
  variant = "page",
}: {
  variant?: "page" | "embed";
}) {
  const [brief, setBrief] = useState<ExampleBriefData | null | undefined>(
    undefined,
  );
  useEffect(() => {
    let active = true;
    getExampleBrief().then((b) => {
      if (!active) return;
      setBrief(b);
      // Funnel signal — fire-and-forget, additive event name. Only the embed
      // (homepage) reports view + CTA; the standalone page stays event-free.
      if (variant === "embed" && b) trackEvent("example_brief_view");
    });
    return () => {
      active = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [variant]);

  const due = brief?.due_date
    ? new Date(brief.due_date).toLocaleDateString("en-US", {
        month: "short",
        day: "numeric",
        year: "numeric",
      })
    : null;

  // ── Radar deep-link (copy+flow only — no new endpoints) ───────────────────
  // The "Want one for your trade?" CTA routes into Contract Radar with the
  // example brief's trade / certification preselected, so the visitor lands on
  // a near-instant personalized scan instead of a blank wizard. Contract:
  //   ?trade=<brief trade_category | naics_code | omitted>
  //   ?cert=<set_aside mapped to 8a/sdvosb/wosb/hubzone | omitted>
  //   ?size=under1m  (there is no "small" id — under1m is the closest "small
  //                    contract" cap on the Radar size options)
  // Directive order on /radar: URL params > saved answers > defaults; the form
  // pre-fills but the visitor still clicks "Scan" (no auto-scan on the radar
  // side). No state param: the example bid's location is display-only and the
  // state is ambiguous, so the visitor picks their own state.
  const RADAR_CERTS = ["8a", "sdvosb", "wosb", "hubzone"] as const;
  const deriveRadarCert = (setAside: string | null | undefined): (typeof RADAR_CERTS)[number] | null => {
    if (!setAside) return null;
    const s = setAside.toLowerCase();
    if (s.includes("8(a)") || s.includes("8a")) return "8a";
    if (s.includes("sdvosb")) return "sdvosb";
    if (s.includes("wosb") || s.includes("women-owned")) return "wosb";
    if (s.includes("hubzone")) return "hubzone";
    return null;
  };
  const tradeCategory = brief?.summary?.trade_category ?? "";
  const naicsCode = brief?.naics_code ?? "";
  const tradeParam =
    tradeCategory.trim() && tradeCategory.trim().toLowerCase() !== "unknown"
      ? tradeCategory.trim()
      : /^\d{6}$/.test(naicsCode)
        ? naicsCode
        : "";
  const certParam = deriveRadarCert(brief?.set_aside);
  const radarCtaHref =
    "/radar?" +
    [
      tradeParam ? `${encodeURIComponent("trade")}=${encodeURIComponent(tradeParam)}` : null,
      certParam ? `${encodeURIComponent("cert")}=${encodeURIComponent(certParam)}` : null,
      `${encodeURIComponent("size")}=${encodeURIComponent("under1m")}`,
    ]
      .filter((p): p is string => p !== null)
      .join("&");

  // ── Shared honest EXAMPLE banner ─────────────────────────────────────────
  const exampleLabel = (
    <div className="rounded-xl border border-amber-500/40 bg-amber-500/10 px-4 py-3 text-center">
      <p className="text-xs font-bold uppercase tracking-wide text-amber-500 dark:text-amber-400">
        ★ Example AI Executive Brief
      </p>
      <p className="mt-1 text-xs leading-relaxed text-amber-700/90 dark:text-amber-200/80">
        This brief was pre-generated from a real solicitation. No signup required
        to view it.
      </p>
    </div>
  );

  // ── Loading / empty (fallback) states ────────────────────────────────────
  const loadingState =
    brief === undefined ? (
      <p className="mt-6 text-sm text-slate-400">Loading example brief…</p>
    ) : null;

  const emptyState =
    brief === null ? (
      <div className="mt-6 rounded-2xl border border-dashed border-slate-700 bg-slate-900/60 px-5 py-8 text-center text-sm text-slate-300">
        No example brief is available right now.
        <div className="mt-3">
          <a
            href="/example-brief"
            className="text-sm font-semibold text-amber-400 hover:text-amber-300"
          >
            Open the example brief page →
          </a>
        </div>
      </div>
    ) : null;

  // ── Shared brief body (article header + summary + CTA) ──────────────────
  const briefBody =
    brief && (
      <>
        <article className="overflow-hidden rounded-2xl border border-slate-700 bg-slate-900">
          <div className="border-b border-slate-800 px-5 py-4">
            <h2 className="text-lg font-extrabold leading-snug text-white">
              {brief.title || "Solicitation"}
            </h2>
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

        {/* Non-gated way to see it on your own trade — honest, no paywall. */}
        {variant === "embed" ? (
          <div className="mt-6 text-center">
            <a
              href={radarCtaHref}
              onClick={() => trackEvent("example_brief_click", "radar")}
              className="inline-flex items-center justify-center gap-2 rounded-xl bg-amber-500 px-7 py-3.5 text-sm font-bold text-slate-950 shadow-lg shadow-amber-500/25 transition-all hover:bg-amber-400 active:scale-[0.98]"
            >
              Want one for your trade? → Find your matching bids free
            </a>
            <p className="mt-2 text-xs text-slate-500">
              Free to start · No credit card · First 3 radar matches show full
              incumbent intel
            </p>
          </div>
        ) : (
          <p className="mt-6 rounded-xl bg-slate-900/60 px-4 py-3 text-center text-sm text-slate-300">
            Want briefs like this for your own trade?{" "}
            <a
              href={radarCtaHref}
              className="font-semibold text-amber-400 hover:text-amber-300"
            >
              Find your matching bids free →
            </a>
          </p>
        )}
      </>
    );

  // ── Standalone /example-brief page (dark) ────────────────────────────────
  if (variant === "page") {
    return (
      <>
        {exampleLabel}
        {loadingState}
        {emptyState}
        {briefBody}
      </>
    );
  }

  // ── Homepage embed (light band, dark evidence card) ─────────────────────
  return (
    <section className="bg-white py-12 sm:py-16" aria-label="Example AI Executive Brief">
      <div className="mx-auto max-w-7xl px-6">
        <div className="mx-auto max-w-3xl text-center">
          <p className="text-xs font-semibold uppercase tracking-widest text-amber-600">
            ✦ AI Executive Brief — real set-aside RFP, decoded
          </p>
          <h2 className="mt-2 text-2xl font-extrabold text-slate-900 sm:text-3xl">
            This is what your next set-aside RFP looks like after Contrax reads it.
          </h2>
          <p className="mt-3 text-sm text-slate-500">
            A real government solicitation — read by Contrax and turned into the
            requirements, key dates, and red flags you need before you open the
            PDF. Your trade&apos;s bids come out the same way.
          </p>
        </div>
        <div className="mx-auto mt-8 max-w-2xl">
          {exampleLabel}
          {loadingState}
          {emptyState}
          {briefBody}
        </div>
      </div>
    </section>
  );
}

export default ExampleBrief;
