/**
 * RfpSummaryCard — the AI RFP Executive Summary & Requirements Extractor card.
 *
 * Renders an instant executive breakdown of a single bid so a contractor can
 * assess an opportunity without reading the full solicitation:
 *   - "AI Executive Brief" badge + plain-English summary
 *   - Mandatory requirements with grounding source quotes
 *   - Key milestones / deadlines highlighted by urgency (red = overdue,
 *     amber = near, neutral otherwise); a null/absent date renders "Not specified"
 *   - Primary trade category
 *   - Red flags with grounding source quotes
 *
 * Honors the 2026-08-28 hardening spec:
 *   - Shows a stale warning + "Regenerate" affordance ONLY when the summary is
 *     stale (source data / content hash changed) — fresh summaries are never
 *     gratuitously regenerated, and "Generate Instant Brief" only appears when
 *     there is NO summary yet.
 *   - Renders missing dates as "Not specified" (never a fabricated date).
 */
import { useState, type ReactNode } from "react";
import { trackEvent } from "~/lib/track";

export interface RfpMilestone {
  event: string;
  date: string | null;
  source: string;
}

export interface RfpItem {
  text: string;
  source: string;
}

export interface RfpSummary {
  summary: string;
  mandatory_requirements: RfpItem[];
  key_milestones: RfpMilestone[];
  trade_category: string;
  red_flags: RfpItem[];
}

export interface RfpBriefResponse {
  data?: RfpSummary;
  fallback?: boolean;
  cached?: boolean;
  stale?: boolean;
  generated_from_updated_at?: string | null;
  source_updated_at?: string | null;
}

type CardState =
  | { status: "idle" } // no summary yet → "Generate Instant Brief"
  | { status: "loading"; regenerate: boolean }
  | {
      status: "ready";
      data: RfpSummary;
      fallback: boolean;
      cached: boolean;
      /** true when the content hash / schema / model no longer matches the cache. */
      stale: boolean;
      /** true when the source row's updated_at advanced past generation time. */
      sourceChanged: boolean;
    }
  | { status: "error"; message: string };

/** Days from today until a date; negative = past. Returns null when unparseable. */
function daysUntil(dateStr: string | null): number | null {
  if (!dateStr) return null;
  const raw = String(dateStr).trim();
  // Prefer an ISO/YYYY-MM-DD date; otherwise attempt a strptime-style parse.
  const m = raw.match(/(\d{4})-(\d{2})-(\d{2})/);
  const d = m
    ? new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]))
    : new Date(raw);
  if (Number.isNaN(d.getTime())) return null;
  return Math.ceil((d.getTime() - Date.now()) / 86_400_000);
}

/** Urgency tone for a milestone based on how close its date is. */
function milestoneTone(dateStr: string | null): "red" | "amber" | "neutral" {
  const days = daysUntil(dateStr);
  if (days === null) return "neutral";
  if (days < 0) return "red"; // missed / overdue
  if (days <= 7) return "red"; // very close — treat like a deadline
  if (days <= 30) return "amber"; // near
  return "neutral";
}

const TONE_CLASS: Record<
  "red" | "amber" | "neutral",
  { dot: string; chip: string }
> = {
  red: {
    dot: "bg-rose-500",
    chip: "border-rose-500/40 bg-rose-500/10 text-rose-300",
  },
  amber: {
    dot: "bg-amber-500",
    chip: "border-amber-500/40 bg-amber-500/10 text-amber-300",
  },
  neutral: {
    dot: "bg-slate-500",
    chip: "border-slate-600 bg-slate-800 text-slate-300",
  },
};

export function RfpSummaryCard({ bidId }: { bidId: number }) {
  const [state, setState] = useState<CardState>({ status: "idle" });

  const generate = async (regenerate = false) => {
    trackEvent(regenerate ? "rfp_brief_regenerate" : "rfp_brief_generate", String(bidId));
    setState({ status: "loading", regenerate });
    try {
      const res = await fetch(`/api/bids/${bidId}/analyze`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: regenerate ? JSON.stringify({ regenerate: true }) : undefined,
      });
      if (!res.ok) {
        let msg = "We couldn't analyze this solicitation right now.";
        if (res.status === 401) {
          msg =
            "Please sign in to generate an AI Executive Brief for this solicitation.";
        } else if (res.status === 429) {
          msg =
            "You've generated several briefs recently. Please try again in a moment.";
        } else if (res.status === 404) {
          msg = "This solicitation is no longer available in our system.";
        }
        setState({ status: "error", message: msg });
        return;
      }
      const json = (await res.json()) as RfpBriefResponse;
      if (!json.data) {
        setState({
          status: "error",
          message: "We couldn't analyze this solicitation right now.",
        });
        return;
      }
      const sourceChanged = !!(
        json.generated_from_updated_at &&
        json.source_updated_at &&
        json.generated_from_updated_at !== json.source_updated_at
      );
      trackEvent("rfp_brief_result", String(bidId), json.fallback ? "fallback" : "ready");
      setState({
        status: "ready",
        data: json.data,
        fallback: !!json.fallback,
        cached: !!json.cached,
        stale: !!json.stale,
        sourceChanged,
      });
    } catch {
      setState({
        status: "error",
        message: "We couldn't analyze this solicitation right now.",
      });
    }
  };

  return (
    <section className="overflow-hidden rounded-2xl border border-slate-700 bg-slate-900">
      <div className="flex items-center justify-between gap-3 border-b border-slate-800 bg-gradient-to-r from-amber-500/15 to-transparent px-5 py-4">
        <p className="text-xs font-semibold uppercase tracking-wide text-amber-400">
          ✦ AI Executive Brief
        </p>
        {state.status === "ready" && !state.fallback && (
          <span
            className={`text-[11px] ${state.stale ? "text-amber-400" : "text-slate-500"}`}
          >
            {state.stale ? "stale — source updated" : state.cached ? "cached" : "generated"}
          </span>
        )}
      </div>

      <div className="px-5 py-4">
        {state.status === "idle" && (
          <div className="text-center">
            <p className="text-sm leading-relaxed text-slate-300">
              Get an instant executive summary — the actual scope, mandatory
              requirements, key deadlines and common disqualifiers — without
              reading the full solicitation.
            </p>
            <button
              type="button"
              onClick={() => generate(false)}
              className="mt-4 w-full rounded-xl bg-amber-500 px-6 py-3.5 text-base font-bold text-slate-950 shadow-lg transition-all hover:bg-amber-400 active:scale-[0.98] sm:w-auto"
            >
              Generate Instant Brief →
            </button>
          </div>
        )}

        {state.status === "loading" && (
          <div className="space-y-4">
            <div className="h-12 animate-pulse rounded-lg bg-slate-800" />
            <div className="h-4 w-3/4 animate-pulse rounded bg-slate-800" />
            <div className="h-4 w-full animate-pulse rounded bg-slate-800" />
            <div className="h-4 w-2/3 animate-pulse rounded bg-slate-800" />
            <p className="pt-1 text-center text-xs text-slate-500">
              {state.regenerate ? "Regenerating the brief…" : "Reading the solicitation…"}
            </p>
          </div>
        )}

        {state.status === "error" && (
          <div role="alert" className="text-center">
            <p className="text-sm leading-relaxed text-slate-300">
              {state.message}
            </p>
            <button
              type="button"
              onClick={() => generate(false)}
              className="mt-4 rounded-xl border border-amber-500/50 px-5 py-2.5 text-sm font-semibold text-amber-400 transition-colors hover:bg-amber-500/10"
            >
              Try again
            </button>
          </div>
        )}

        {state.status === "ready" && <BriefBody state={state} onRegenerate={() => generate(true)} />}
      </div>
    </section>
  );
}

function BriefBody({
  state,
  onRegenerate,
}: {
  state: Extract<CardState, { status: "ready" }>;
  onRegenerate: () => void;
}) {
  const { data, fallback, stale, sourceChanged } = state;
  // Point 8: offer Regenerate ONLY when the summary is stale (source data
  // changed / content hash no longer matches) or when an admin invalidated the
  // cache. A fresh summary is never gratuitously regenerable.
  const canRegenerate = !fallback && (stale || sourceChanged);

  if (fallback) {
    return (
      <div className="rounded-xl border border-dashed border-slate-600 bg-slate-800/40 px-4 py-3">
        <p className="text-xs font-semibold uppercase tracking-wide text-slate-400">
          AI brief temporarily unavailable
        </p>
        <p className="mt-2 text-sm leading-relaxed text-slate-300">
          {data.summary || "The original notice should be reviewed directly."}
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-5">
      {/* Point 2: warn when the source data changed after generation. */}
      {sourceChanged && (
        <div
          role="status"
          className="rounded-lg border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-xs text-amber-300"
        >
          ⚠ Source data has changed since this brief was generated. Some details
          may be out of date.
        </div>
      )}

      {/* Plain-English summary */}
      {data.summary && (
        <p className="text-sm leading-relaxed text-slate-200">{data.summary}</p>
      )}

      {/* Mandatory requirements */}
      <Part title="Mandatory requirements">
        {data.mandatory_requirements.length > 0 ? (
          <ul className="space-y-2">
            {data.mandatory_requirements.map((r, i) => (
              <li key={i} className="text-sm text-slate-300">
                <div className="flex gap-2">
                  <span className="text-emerald-400" aria-hidden="true">
                    ✓
                  </span>
                  <span>{r.text}</span>
                </div>
                {r.source && (
                  <p className="mt-1 pl-6 text-xs italic text-slate-500">
                    “{r.source}”
                  </p>
                )}
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-sm text-slate-400">
            No mandatory requirements were identified in the available text.
          </p>
        )}
      </Part>

      {/* Key milestones / deadlines — urgency highlighted */}
      <Part title="Key dates & milestones">
        {data.key_milestones.length > 0 ? (
          <ul className="space-y-2">
            {data.key_milestones.map((m, i) => {
              const tone = milestoneTone(m.date);
              const cls = TONE_CLASS[tone];
              return (
                <li key={i} className="text-sm">
                  <div className="flex items-center gap-2">
                    <span
                      className={`h-2 w-2 shrink-0 rounded-full ${cls.dot}`}
                      aria-hidden="true"
                    />
                    <span className="text-slate-200">{m.event}</span>
                    <span
                      className={`ml-auto shrink-0 rounded-md border px-2 py-0.5 text-xs font-medium ${cls.chip}`}
                    >
                      {m.date || "Not specified"}
                    </span>
                  </div>
                  {m.source && (
                    <p className="mt-1 pl-4 text-xs italic text-slate-500">
                      “{m.source}”
                    </p>
                  )}
                </li>
              );
            })}
          </ul>
        ) : (
          <p className="text-sm text-slate-400">
            No dated milestones were identified in the available text.
          </p>
        )}
      </Part>

      {/* Primary trade */}
      {data.trade_category && (
        <Part title="Primary trade">
          <span className="inline-block rounded-lg border border-amber-500/40 bg-amber-500/10 px-3 py-1 text-sm font-semibold text-amber-300">
            {data.trade_category}
          </span>
        </Part>
      )}

      {/* Red flags / disqualifiers */}
      {data.red_flags.length > 0 && (
        <Part title="Red flags to check">
          <ul className="space-y-2">
            {data.red_flags.map((r, i) => (
              <li key={i} className="text-sm text-rose-200">
                <div className="flex gap-2">
                  <span className="shrink-0 font-bold text-rose-400" aria-hidden="true">
                    ⚠
                  </span>
                  <span>{r.text}</span>
                </div>
                {r.source && (
                  <p className="mt-1 pl-6 text-xs italic text-rose-300/60">
                    “{r.source}”
                  </p>
                )}
              </li>
            ))}
          </ul>
        </Part>
      )}

      {data.key_milestones.length === 0 &&
        data.red_flags.length === 0 &&
        !data.trade_category &&
        data.mandatory_requirements.length === 0 && (
          <p className="text-xs text-slate-500">
            No additional detail was identified beyond the summary above —
            review the original notice to confirm all requirements.
          </p>
        )}

      {canRegenerate && (
        <button
          type="button"
          onClick={onRegenerate}
          className="mt-2 rounded-xl border border-amber-500/50 px-5 py-2.5 text-sm font-semibold text-amber-400 transition-colors hover:bg-amber-500/10"
        >
          Regenerate brief
        </button>
      )}
    </div>
  );
}

function Part({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div>
      <p className="text-xs font-semibold uppercase tracking-wide text-slate-400">
        {title}
      </p>
      <div className="mt-1.5">{children}</div>
    </div>
  );
}
