import { createFileRoute, redirect } from "@tanstack/react-router";
import { useState, useEffect } from "react";
import { getCurrentUser } from "~/lib/auth";
import {
  AdminHeader,
  AdminTabs,
  MrrScoreboard,
  SectionError,
  SectionLoading,
  moneyWhole,
  timeFmt,
} from "~/components/AdminShared";

/**
 * /admin/ — Overview tab of the redesigned admin dashboard (owner 2026-09-07).
 *
 *   CONTRAX TODAY (headline metrics, same numbers as before — Qualified /
 *   Radar / Autopsy / Leads / Signups / Paid, live from the existing
 *   unified-funnel + autopsy-funnel + radar-leads-funnel + metrics + finance
 *   endpoints) + 🔥 PEOPLE TO ACT ON (top 5–10 highest-intent rows, ranked by
 *   the EXISTING board-side lead score from /api/admin/journeys — the same
 *   computeLeadScore heuristic + Conversion Opportunity best_next/cta mapping,
 *   PII-masked exactly like the board).
 *
 * The deep surfaces moved to tabs (Radar Leads, Autopsy, Visitors, Signups,
 * Customers); the old single-page sections below (users, waitlist, traffic,
 * acquisition, funnels) stay reachable via those tabs and /admin/journeys.
 */

// ── Endpoint shapes (all pre-filtered server-side: bot/QA/admin excluded) ───
interface UnifiedStage { stage: string; label: string; count: number; stepConversionPct: number | null; }
interface UnifiedResult { rangeDays: number; stages: UnifiedStage[]; }
interface SimpleFunnelStage { stage: string; label: string; count: number; dropOffPct: number | null; }
interface SimpleFunnel { rangeDays: number; funnel: SimpleFunnelStage[]; }
interface MetricsShape { totalSignups: number; }
interface FinanceShape { mrrCents: number; customerCount: number; source: "stripe-live" | "app-db"; }

interface OppReason { points: number; reason: string; }
interface ActOnRow {
  visitor_id: string;
  label: string;
  visitor_hash: string | null;
  source: string | null;
  city: string | null;
  region: string | null;
  device_type: string | null;
  browser_label: string | null;
  radar: boolean;
  signup: string;
  last_activity: string | null;
  score: number;
  level: "Very High" | "High" | "Medium" | "Low";
  reasons: OppReason[];
  best_next: string;
  obstacle: string;
  cta: string;
}
interface JourneysShape {
  journeys: {
    visitor_id: string;
    label: string;
    visitor_hash: string | null;
    source: string | null;
    city: string | null;
    region: string | null;
    device_type: string | null;
    browser_label: string | null;
    radar: boolean;
    signup: string;
    last_activity: string | null;
    lead_score?: { score: number; level: "Very High" | "High" | "Medium" | "Low"; reasons: OppReason[] };
    conversion_opportunity?: { reasons: OppReason[]; best_next: string; obstacle: string; cta: string };
  }[];
}

async function getJson<T>(url: string): Promise<T> {
  const res = await fetch(url);
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: `Failed to load ${url}` }));
    throw new Error(err.error || `Failed to load ${url}`);
  }
  return res.json();
}

const LEVEL_STYLE: Record<ActOnRow["level"], string> = {
  "Very High": "bg-rose-100 text-rose-700",
  High: "bg-amber-100 text-amber-800",
  Medium: "bg-yellow-100 text-yellow-800",
  Low: "bg-slate-100 text-slate-500",
};

function acquisitionPath(source: string | null, radar: boolean, signup: string): string {
  const src = source ? source.charAt(0).toUpperCase() + source.slice(1) : "Direct";
  const steps: string[] = [];
  if (radar) steps.push("Radar completed");
  if (signup === "Success") steps.push("Signed up");
  else if (signup === "Started" || signup === "Abandoned") steps.push("Signup started");
  return steps.length > 0 ? `${src} → ${steps.join(" → ")}` : `${src} → Browsing`;
}

function locationDevice(r: ActOnRow): string {
  const geo = [r.city, r.region].filter(Boolean).join(", ");
  const device = r.browser_label || r.device_type;
  if (geo && device) return `${geo} · ${device}`;
  if (geo) return geo;
  if (device) return device;
  return "Direct Lead";
}

function PeopleToActOn({ rows, loading, error }: { rows: ActOnRow[]; loading: boolean; error: string }) {
  if (error) return <SectionError message={error} />;
  if (loading) return <SectionLoading message="Ranking highest-intent visitors…" />;
  if (rows.length === 0) {
    return (
      <div className="rounded-2xl border border-slate-200 bg-white p-6">
        <p className="text-sm font-medium text-slate-700">Nobody hot right now — honest empty state, not a measurement error.</p>
        <p className="mt-1 text-xs text-slate-400">
          High / Very High-intent visitors (per the existing lead-score heuristic) appear here with a recommended
          next step as soon as real humans engage.
        </p>
      </div>
    );
  }
  return (
    <div className="overflow-x-auto rounded-2xl border border-slate-200 bg-white shadow-sm">
      <table className="w-full text-sm">
        <thead>
          <tr className="text-left text-xs text-slate-400 uppercase tracking-wider">
            <th className="px-5 py-3 font-medium">Visitor</th>
            <th className="px-5 py-3 font-medium">Intent</th>
            <th className="px-5 py-3 font-medium">Path</th>
            <th className="px-5 py-3 font-medium">Recommended action</th>
            <th className="px-5 py-3 font-medium">Journey</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.visitor_id} className="border-t border-slate-50 hover:bg-rose-50/30">
              <td className="px-5 py-3">
                <div className="flex items-center gap-1.5">
                  <span className="font-medium text-slate-800">{locationDevice(r)}</span>
                  {r.visitor_hash && (
                    <span className="rounded bg-slate-100 px-1 py-0.5 font-mono text-[10px] text-slate-400" title="Visitor id (last 4)">
                      {r.visitor_hash}
                    </span>
                  )}
                </div>
                <p className="mt-0.5 text-[11px] text-slate-400">last active {timeFmt(r.last_activity)}</p>
              </td>
              <td className="px-5 py-3 whitespace-nowrap">
                <span className={`inline-flex rounded-full px-2 py-0.5 text-xs font-semibold ${LEVEL_STYLE[r.level]}`}>
                  {r.level === "Very High" ? "🔥 Very High" : r.level === "High" ? "🔥 High" : r.level} · {r.score}
                </span>
              </td>
              <td className="px-5 py-3 text-slate-600 whitespace-nowrap">{acquisitionPath(r.source, r.radar, r.signup)}</td>
              <td className="px-5 py-3">
                <p className="font-medium text-slate-800">{r.best_next}</p>
                <p className="mt-0.5 inline-flex rounded-lg border border-rose-200 bg-rose-50/60 px-2 py-0.5 text-xs text-rose-800">
                  Try: “{r.cta}”
                </p>
              </td>
              <td className="px-5 py-3 whitespace-nowrap">
                <a
                  href={`/admin/journeys?visitor=${encodeURIComponent(r.visitor_id)}`}
                  className="inline-flex rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-50"
                >
                  View Journey
                </a>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <p className="px-5 py-3 text-[10px] text-slate-400 border-t border-slate-100">
        Ranked by the existing board-side lead score (same heuristic + same recommended-action mapping as the
        Conversion Opportunity panel). Location is approximate / IP-derived; linked users show the masked label.
        Bot/QA/admin rows never appear.
      </p>
    </div>
  );
}

export const Route = createFileRoute("/admin/")({
  loader: async () => {
    const user = await getCurrentUser();
    if (!user) throw redirect({ to: "/login" });
    if (!user.is_admin) throw redirect({ href: "/dashboard?notice=admin-only" });
    return { user };
  },
  component: AdminOverviewPage,
  head: () => ({ meta: [{ name: "robots", content: "noindex, nofollow" }, { title: "Admin | Contrax" }] }),
});

function AdminOverviewPage() {
  const [unified, setUnified] = useState<UnifiedResult | null>(null);
  const [autopsy, setAutopsy] = useState<SimpleFunnel | null>(null);
  const [radarLeads, setRadarLeads] = useState<SimpleFunnel | null>(null);
  const [metrics, setMetrics] = useState<MetricsShape | null>(null);
  const [fin, setFin] = useState<FinanceShape | null>(null);
  const [actOn, setActOn] = useState<ActOnRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [actOnLoading, setActOnLoading] = useState(true);
  const [error, setError] = useState("");
  const [actOnError, setActOnError] = useState("");

  useEffect(() => {
    let cancelled = false;
    Promise.all([
      getJson<UnifiedResult>("/api/admin/unified-funnel?days=30"),
      getJson<SimpleFunnel>("/api/admin/autopsy-funnel?days=30"),
      getJson<SimpleFunnel>("/api/admin/radar-leads-funnel?days=30"),
      getJson<MetricsShape>("/api/admin/metrics"),
      getJson<FinanceShape>("/api/admin/finance"),
    ])
      .then(([u, a, r, m, f]) => {
        if (cancelled) return;
        setUnified(u);
        setAutopsy(a);
        setRadarLeads(r);
        setMetrics(m);
        setFin(f);
      })
      .catch((err) => {
        if (!cancelled) setError(err instanceof Error ? err.message : "Failed to load overview");
      })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, []);

  // 🔥 PEOPLE TO ACT ON — top 10 by the EXISTING board-side lead score.
  useEffect(() => {
    let cancelled = false;
    setActOnLoading(true);
    setActOnError("");
    getJson<JourneysShape>("/api/admin/journeys?days=30")
      .then((d) => {
        if (cancelled) return;
        const scored = (d.journeys ?? [])
          .filter((j) => j.lead_score && j.conversion_opportunity)
          .map((j): ActOnRow => ({
            visitor_id: j.visitor_id,
            label: j.label,
            visitor_hash: j.visitor_hash,
            source: j.source,
            city: j.city,
            region: j.region,
            device_type: j.device_type,
            browser_label: j.browser_label,
            radar: j.radar,
            signup: j.signup,
            last_activity: j.last_activity,
            score: j.lead_score!.score,
            level: j.lead_score!.level,
            reasons: j.lead_score!.reasons,
            best_next: j.conversion_opportunity!.best_next,
            obstacle: j.conversion_opportunity!.obstacle,
            cta: j.conversion_opportunity!.cta,
          }))
          .sort((a, b) => b.score - a.score || (b.last_activity ?? "").localeCompare(a.last_activity ?? ""))
          .slice(0, 10);
        setActOn(scored);
      })
      .catch((err) => {
        if (!cancelled) setActOnError(err instanceof Error ? err.message : "Failed to rank visitors");
      })
      .finally(() => { if (!cancelled) setActOnLoading(false); });
    return () => { cancelled = true; };
  }, []);

  const stage = (name: string): number =>
    unified?.stages.find((s) => s.stage === name)?.count ?? 0;
  const autopsyCount = (name: string): number =>
    autopsy?.funnel.find((s) => s.stage === name)?.count ?? 0;
  const radarCount = (name: string): number =>
    radarLeads?.funnel.find((s) => s.stage === name)?.count ?? 0;

  // CONTRAX TODAY — same numbers as the existing surfaces:
  // Qualified (unified) / Radar (unified radar completed) / Autopsy (autopsy award_found + report_viewed) /
  // Leads (radar-leads captured) / Signups (metrics external signups) / Paid (finance live customers).
  const todayCards = [
    { label: "Qualified", value: unified ? stage("qualified") : null, hint: "qualified visits · 30d" },
    { label: "Radar", value: unified ? stage("radar") : null, hint: "radar completed · 30d" },
    {
      label: "Autopsy",
      value: autopsy ? autopsyCount("award_found") : null,
      hint: autopsy ? `${autopsyCount("report_viewed")} complete viewed · 30d` : "30d",
    },
    { label: "Leads", value: radarLeads ? radarCount("capture") : null, hint: "radar leads captured · 30d" },
    { label: "Signups", value: metrics ? metrics.totalSignups : null, hint: "external accounts" },
    { label: "Paid", value: fin ? fin.customerCount : null, hint: fin ? (fin.source === "stripe-live" ? "live Stripe customers" : "live app-DB customers") : "live" },
  ];

  return (
    <div className="min-h-screen bg-slate-50">
      <AdminHeader scoreboard={<MrrScoreboard />} />
      <main className="mx-auto max-w-6xl px-4 py-8 space-y-8">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h1 className="text-2xl font-bold text-slate-900">Admin Dashboard</h1>
        </div>
        <AdminTabs active="overview" />

        {/* CONTRAX TODAY — headline metrics, same numbers + same placement as before */}
        <section>
          <h2 className="text-lg font-semibold text-slate-800 mb-1">Contrax Today</h2>
          <p className="mb-3 text-xs text-slate-500">
            Qualified / Radar / Autopsy / Leads / Signups / Paid — live from the same endpoints as the tabs. QA/admin/bot/test excluded.
          </p>
          {error ? (
            <SectionError message={error} />
          ) : loading ? (
            <SectionLoading message="Loading today's numbers…" />
          ) : (
            <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
              {todayCards.map((c) => (
                <div key={c.label} className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
                  <p className="text-xs font-medium text-slate-500 uppercase tracking-wide">{c.label}</p>
                  <p className="mt-1 text-3xl font-bold text-slate-900">{c.value ?? "—"}</p>
                  <p className="mt-0.5 text-[10px] text-slate-400">{c.hint}</p>
                </div>
              ))}
            </div>
          )}
          {!loading && !error && fin && (
            <p className="mt-2 text-[11px] text-slate-400">
              MRR (live): <span className="font-bold text-slate-700">{moneyWhole(fin.mrrCents)}</span> ·{" "}
              {fin.source === "stripe-live" ? "live Stripe read" : "live app-database read (Stripe unreachable)"} — top-right scoreboard.
            </p>
          )}
        </section>

        {/* 🔥 PEOPLE TO ACT ON */}
        <section>
          <h2 className="text-lg font-semibold text-slate-800 mb-1">🔥 People to act on</h2>
          <p className="mb-3 text-xs text-slate-500">
            Top 10 highest-intent visitors/leads by the existing lead-score heuristic — with the recommended next step
            from the Conversion Opportunity mapping. Newest activity breaks ties.
          </p>
          <PeopleToActOn rows={actOn} loading={actOnLoading} error={actOnError} />
        </section>

        {/* Jump links to the deep surfaces */}
        <section>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <a
              href="/admin/journeys"
              className="group flex items-center gap-4 rounded-2xl border border-indigo-200 bg-gradient-to-r from-indigo-50 to-white p-5 shadow-sm transition-colors hover:border-indigo-300"
            >
              <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-indigo-500 text-xl">🧭</span>
              <div>
                <p className="font-bold text-slate-900">Visitor Journeys</p>
                <p className="text-xs text-slate-500">Full People table + unified funnel + watch banner</p>
              </div>
            </a>
            <a
              href="/admin/radar-leads"
              className="group flex items-center gap-4 rounded-2xl border border-violet-200 bg-gradient-to-r from-violet-50 to-white p-5 shadow-sm transition-colors hover:border-violet-300"
            >
              <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-violet-500 text-xl">📧</span>
              <div>
                <p className="font-bold text-slate-900">Radar Leads</p>
                <p className="text-xs text-slate-500">7-stage match-alert funnel + masked lead table</p>
              </div>
            </a>
          </div>
        </section>
      </main>
    </div>
  );
}
