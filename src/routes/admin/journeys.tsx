import { createFileRoute, redirect } from "@tanstack/react-router";
import { useState, useEffect } from "react";
import { getCurrentUser } from "~/lib/auth";

/**
 * Admin "Visitor Journeys" board (owner, 2026-09-01).
 *
 * One row per real person/session (grouped by the persistent contrax_vid), each
 * expanding into a timestamped timeline. Row summaries are served from the
 * `visitors` summary cache (fast read-path); the per-visitor TIMELINE stays in
 * funnel_events + page_views and is fetched LAZILY when a row is expanded
 * (GET /api/admin/journeys-timeline?visitor_id=<id>) — collapsed rows never
 * fetch. Masks PII — unauthenticated visitors → a geo/behavioral display name
 * ("Dallas, TX · Desktop", "Direct Lead · /pricing") with a subtle muted
 * "#last4" hash badge; linked users → "local-part@…". Each row also shows
 * behavioral-intent badge pills (💰 Pricing Evaluator / 📑 Brief Viewer / 🔥 High
 * Engagement) derived server-side. QA/admin/bot/test traffic is excluded
 * server-side.
 */

interface TimelineItem { t: string; label: string; kind: "page" | "event"; }
interface JourneyBadge { key: "pricing" | "brief" | "engagement"; label: string; }
interface Journey {
  visitor_id: string;
  label: string;
  visitor_hash: string | null;
  source: string | null;
  landing_page: string | null;
  city: string | null;
  region: string | null;
  device_type: string | null;
  browser_label: string | null;
  radar: boolean;
  signup: "Not started" | "Viewed" | "Started" | "Abandoned" | "Success";
  activated: boolean;
  paid: boolean;
  last_activity: string | null;
  steps: number;
  badges: JourneyBadge[];
  events: TimelineItem[]; // reliably empty on the board — the timeline is lazy
}
interface FunnelStage { stage: string; label: string; count: number; dropOffPct: number | null; }
interface JourneysResult {
  rangeDays: number;
  from: string;
  to: string;
  funnel: FunnelStage[];
  journeys: Journey[];
}

const DAYS_OPTIONS = [7, 30, 90];

async function fetchJourneys(days: number): Promise<JourneysResult> {
  const res = await fetch(`/api/admin/journeys?days=${days}`);
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: "Failed to load journeys" }));
    throw new Error(err.error || "Failed to load journeys");
  }
  return res.json();
}

function timeFmt(iso: string): string {
  return new Date(iso).toLocaleString("en-US", {
    month: "short", day: "numeric", hour: "numeric", minute: "2-digit",
  });
}

function SignupBadge({ status }: { status: Journey["signup"] }) {
  const palette: Record<Journey["signup"], string> = {
    Success: "bg-emerald-100 text-emerald-700",
    "Not started": "bg-slate-100 text-slate-500",
    Viewed: "bg-blue-50 text-blue-700",
    Started: "bg-amber-50 text-amber-700",
    Abandoned: "bg-red-50 text-red-600",
  };
  return (
    <span className={`inline-flex rounded-full px-2 py-0.5 text-xs font-medium ${palette[status] ?? "bg-slate-100 text-slate-600"}`}>
      {status}
    </span>
  );
}

function YesNo({ value, yes = "Yes", no = "No" }: { value: boolean; yes?: string; no?: string }) {
  return value ? (
    <span className="inline-flex rounded-full bg-emerald-100 px-2 py-0.5 text-xs font-medium text-emerald-700">{yes}</span>
  ) : (
    <span className="inline-flex rounded-full bg-slate-100 px-2 py-0.5 text-xs font-medium text-slate-400">{no}</span>
  );
}

const BADGE_STYLES: Record<JourneyBadge["key"], string> = {
  pricing: "bg-amber-100 text-amber-800",
  brief: "bg-blue-100 text-blue-700",
  engagement: "bg-emerald-100 text-emerald-700",
};

function Badges({ badges }: { badges: JourneyBadge[] }) {
  if (!badges || badges.length === 0) return null;
  return (
    <span className="mt-1.5 flex flex-wrap gap-1">
      {badges.map((b) => (
        <span key={b.key} className={`inline-flex rounded-full px-2 py-0.5 text-[10px] font-medium ${BADGE_STYLES[b.key] ?? "bg-slate-100 text-slate-600"}`}>
          {b.label}
        </span>
      ))}
    </span>
  );
}

async function fetchTimeline(visitorId: string): Promise<TimelineItem[]> {
  const res = await fetch(`/api/admin/journeys-timeline?visitor_id=${encodeURIComponent(visitorId)}`);
  if (!res.ok) throw new Error("Failed to load timeline");
  const data = await res.json();
  return (data?.events ?? []) as TimelineItem[];
}

function JourneyRow({ j }: { j: Journey }) {
  const [open, setOpen] = useState(false);
  // Lazy per-expanded-row timeline. Collapsed rows never fetch. Kept in local
  // state so toggling closed→open again doesn't re-fetch.
  const [events, setEvents] = useState<TimelineItem[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [timelineError, setTimelineError] = useState("");

  useEffect(() => {
    if (!open) return;
    if (events !== null) return; // already loaded once
    let cancelled = false;
    setLoading(true);
    setTimelineError("");
    fetchTimeline(j.visitor_id)
      .then((ev) => { if (!cancelled) setEvents(ev); })
      .catch(() => { if (!cancelled) setTimelineError("Failed to load timeline"); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [open, events, j.visitor_id]);

  // The summary cache's LIFETIME step count (j.steps) is the CANONICAL
  // "Steps N" for a row, shown identically whether collapsed or expanded. It
  // must never be overridden downward by the lazily-loaded timeline's length:
  // for QA/test/admin egress-IP rows the timeline endpoint is IP-excluded and
  // returns [] while the summary still carries the lifetime count — letting the
  // timeline length drive the count would flip a row from "Steps 6" to "Steps 0"
  // on expand. j.steps and a non-excluded timeline both measure lifetime, so
  // they agree for real visitors; using j.steps only corrects the excluded-IP
  // case. (Math.max(j.steps, events.length) was rejected: it could override
  // j.steps UPWARD and break the always-agree guarantee.)
  const stepCount = j.steps;

  return (
    <>
      <tr
        onClick={() => setOpen((o) => !o)}
        className="border-t border-slate-50 cursor-pointer hover:bg-blue-50/40 transition-colors"
      >
        <td className="px-5 py-3">
          <div className="flex items-center gap-1.5">
            <span className="font-medium text-slate-800">{j.label}</span>
            {j.visitor_hash && (
              <span className="rounded bg-slate-100 px-1 py-0.5 font-mono text-[10px] text-slate-400" title="Visitor id (last 4)">
                {j.visitor_hash}
              </span>
            )}
          </div>
          <Badges badges={j.badges} />
          {j.device_type && (
            <p className="mt-1 text-[10px] text-slate-400">
              {[j.city, j.region].filter(Boolean).join(", ")}
              {j.browser_label ? ` · ${j.browser_label}` : ` · ${j.device_type}`}
            </p>
          )}
        </td>
        <td className="px-5 py-3 text-slate-600">{j.source ? <span className="capitalize">{j.source}</span> : "—"}</td>
        <td className="px-5 py-3 text-slate-500 max-w-[180px] truncate font-mono">{j.landing_page ?? "—"}</td>
        <td className="px-5 py-3"><YesNo value={j.radar} /></td>
        <td className="px-5 py-3"><SignupBadge status={j.signup} /></td>
        <td className="px-5 py-3"><YesNo value={j.activated} yes={"Yes"} /></td>
        <td className="px-5 py-3 text-slate-500 whitespace-nowrap">
          {j.last_activity ? timeFmt(j.last_activity) : "—"}
        </td>
        <td className="px-5 py-3 text-slate-400">
          <span className="text-xs">{open ? "▾" : "▸"} {stepCount}</span>
        </td>
      </tr>
      {open && (
        <tr className="bg-slate-50/60">
          <td colSpan={8} className="px-6 py-4">
            <div className="rounded-xl border border-slate-200 bg-white p-4">
              <p className="mb-3 text-xs font-semibold uppercase tracking-wide text-slate-400">
                Timeline · {loading ? "…" : `${stepCount} ${stepCount === 1 ? "step" : "steps"}`}
              </p>
              {loading ? (
                <p className="text-sm text-slate-400">Loading timeline…</p>
              ) : timelineError ? (
                <p className="text-sm text-red-600">{timelineError}</p>
              ) : events && events.length === 0 ? (
                <p className="text-sm text-slate-400">No tracked events.</p>
              ) : (
                <ul className="space-y-1.5 border-l-2 border-slate-100 pl-4">
                  {(events ?? []).map((ev, i) => (
                    <li key={i} className="flex items-baseline gap-3 text-sm">
                      <span className="shrink-0 whitespace-nowrap font-mono text-xs text-slate-400">
                        {timeFmt(ev.t)}
                      </span>
                      <span className="text-slate-700">{ev.label}</span>
                      {ev.kind === "page" && (
                        <span className="inline-flex rounded bg-blue-50 px-1.5 py-0.5 text-[10px] font-medium text-blue-600">view</span>
                      )}
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </td>
        </tr>
      )}
    </>
  );
}

export const Route = createFileRoute("/admin/journeys")({
  loader: async () => {
    const user = await getCurrentUser();
    if (!user) throw redirect({ to: "/login" });
    if (!user.is_admin) throw redirect({ href: "/dashboard?notice=admin-only" });
    return { user };
  },
  component: JourneysPage,
  head: () => ({ meta: [{ name: "robots", content: "noindex, nofollow" }, { title: "Visitor Journeys | Admin | Contrax" }] }),
});

function JourneysPage() {
  const [days, setDays] = useState(30);
  const [data, setData] = useState<JourneysResult | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError("");
    fetchJourneys(days)
      .then((d) => { if (!cancelled) setData(d); })
      .catch((err) => { if (!cancelled) setError(err instanceof Error ? err.message : "Failed to load journeys"); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [days]);

  return (
    <div className="min-h-screen bg-slate-50">
      <header className="border-b border-slate-200 bg-white sticky top-0 z-10">
        <div className="mx-auto max-w-6xl px-4 py-3 flex items-center justify-between">
          <a href="/" className="inline-flex items-center gap-2">
            <img src="/logo.png" alt="Contrax" className="h-8 w-auto" />
          </a>
          <div className="flex items-center gap-4">
            <span className="text-xs font-semibold uppercase tracking-wider text-amber-600 bg-amber-50 px-2 py-0.5 rounded-md">Admin</span>
            <a href="/admin" className="text-sm font-medium text-slate-500 hover:text-slate-700">Admin Dashboard &rarr;</a>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-6xl px-4 py-8 space-y-8">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h1 className="text-2xl font-bold text-slate-900">Visitor Journeys</h1>
          <div className="flex items-center gap-1 rounded-xl border border-slate-200 bg-white p-1">
            {DAYS_OPTIONS.map((d) => (
              <button key={d} type="button" onClick={() => setDays(d)}
                className={`rounded-lg px-3 py-1.5 text-xs font-semibold transition-colors ${days === d ? "bg-slate-900 text-white" : "text-slate-600 hover:bg-slate-100"}`}>
                {d}d
              </button>
            ))}
          </div>
        </div>

        {/* Unified funnel */}
        <section>
          <h2 className="text-lg font-semibold text-slate-800 mb-1">Unified funnel</h2>
          <p className="mb-3 text-xs text-slate-500">
            Qualified visit → Radar completed → Signup completed → Activated → Paid. <strong>Activated</strong> = first successful
            AI Brief, saved bid, match-score action, or alert creation. QA/admin/bot/test traffic excluded.
          </p>
          {error ? (
            <div className="rounded-2xl border border-red-200 bg-red-50 p-4 text-sm text-red-700">{error}</div>
          ) : loading || !data ? (
            <div className="rounded-2xl border border-slate-200 bg-white p-6 text-sm text-slate-400">Loading journeys…</div>
          ) : data.funnel.length === 0 || data.journeys.length === 0 ? (
            <div className="rounded-2xl border border-slate-200 bg-white p-6">
              <p className="text-sm font-medium text-slate-700">No human visitor journeys in this range.</p>
              <p className="mt-1 text-xs text-slate-400">
                Real (non-bot, non-QA) visitors with a persistent visitor id show up here as their events accumulate.
              </p>
            </div>
          ) : (
            <div className="grid grid-cols-2 sm:grid-cols-5 gap-3">
              {data.funnel.map((s, i) => (
                <div key={s.stage} className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
                  <p className="text-xs font-medium text-slate-400 uppercase tracking-wide">{s.label}</p>
                  <p className="mt-1 text-3xl font-bold text-slate-900">{s.count}</p>
                  {s.dropOffPct !== null && s.count < data.funnel[i - 1].count && (
                    <p className="mt-0.5 text-[11px] text-red-500">−{s.dropOffPct}% from prior</p>
                  )}
                </div>
              ))}
            </div>
          )}
        </section>

        {/* Journeys table */}
        <section>
          <h2 className="text-lg font-semibold text-slate-800 mb-2">People</h2>
          <p className="mb-3 text-xs text-slate-500">
            Click a row to expand its timeline. Unauthenticated visitors are labeled by geo/behavior ("Dallas, TX · Desktop" or "Direct Lead · /pricing") with a muted #hash for debugging; linked users = email local-part. Badges flag pricing viewers, brief viewers, and high-engagement journeys.
          </p>
          {loading ? (
            <div className="rounded-2xl border border-slate-200 bg-white p-6 text-sm text-slate-400">Loading journeys…</div>
          ) : error ? (
            <div className="rounded-2xl border border-red-200 bg-red-50 p-4 text-sm text-red-700">{error}</div>
          ) : !data || data.journeys.length === 0 ? (
            <div className="rounded-2xl border border-slate-200 bg-white p-6 text-sm text-slate-400">No journeys in this range.</div>
          ) : (
            <div className="rounded-2xl border border-slate-200 bg-white overflow-hidden shadow-sm">
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="text-left text-xs text-slate-400 uppercase tracking-wider">
                      <th className="px-5 py-3 font-medium">Visitor</th>
                      <th className="px-5 py-3 font-medium">Source</th>
                      <th className="px-5 py-3 font-medium">Landing</th>
                      <th className="px-5 py-3 font-medium">Radar</th>
                      <th className="px-5 py-3 font-medium">Signup</th>
                      <th className="px-5 py-3 font-medium">Activated</th>
                      <th className="px-5 py-3 font-medium">Last action</th>
                      <th className="px-5 py-3 font-medium">Steps</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.journeys.map((j) => <JourneyRow key={j.visitor_id} j={j} />)}
                  </tbody>
                </table>
              </div>
              <p className="px-5 py-3 text-[10px] text-slate-400 border-t border-slate-100">
                Timelines are fetched from stored funnel_events + page_views when you expand a row — nothing fabricated, and
                collapsed rows stay lightweight. Some rows predate per-visitor id tracking (recorded without a visitor_id) and aren't shown.
              </p>
            </div>
          )}
        </section>
      </main>
    </div>
  );
}
