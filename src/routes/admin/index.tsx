import { createFileRoute, redirect } from "@tanstack/react-router";
import { useState, useEffect } from "react";
import { getCurrentUser } from "~/lib/auth";
import type { RadarConversionFunnelResult } from "~/lib/radar-conversion-funnel";
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
 *   CONTRAX TODAY — the owner-exact 8-card scoreboard, in order: Qualified
 *   Visitors / Radar Completed / Radar Leads / Autopsy Started / Signups /
 *   Activated / Customers / MRR. Every number is live from the EXISTING
 *   endpoints the merged dashboard already calls (unified-funnel,
 *   radar-leads-funnel, autopsy-funnel, metrics, finance) — NO analytics
 *   rewrite, NO new dependencies, NO schema changes. Bot/QA/admin rows are
 *   excluded server-side by those endpoints; cards carry honest hints.
 *
 *   🔥 PEOPLE TO ACT ON — HIGH-VALUE ONLY: rows whose existing board-side lead
 *   score is "Very High" or "High" (Medium/Low dropped), capped at top 10,
 *   ranked by score. 4-part card per row: what-did (acquisition path) /
 *   why-important (intent badge + score + reasons) / where-in-funnel
 *   (signup/radar/radar-lead stage marker) / Recommended-Next (best_next +
 *   Try: cta from the Conversion Opportunity mapping, PII-masked exactly like
 *   the board).
 *
 *   REVENUE FUNNEL — the CEO health section: Radar → Lead → Confirmed →
 *   Alert → Click → Signup → Activated → Paid, aggregated from EXISTING funnel
 *   events (unified radar-completed, radar-leads capture/confirmed/alert/click/
 *   signup, unified activated, live Stripe customers). Honest counts + drop-off
 *   %; zero funnel → honest empty state, never fabricated.
 *
 * The deep surfaces stay on the tabs (Radar Leads, Autopsy, Visitors, Signups,
 * Customers).
 */

// ── Endpoint shapes (all pre-filtered server-side: bot/QA/admin excluded) ───
interface UnifiedStage { stage: string; label: string; count: number; stepConversionPct: number | null; }
interface UnifiedResult { rangeDays: number; stages: UnifiedStage[]; }
interface SimpleFunnel { rangeDays: number; funnel: { stage: string; label: string; count: number; dropOffPct: number | null }[]; }
interface FinanceShape { mrrCents: number; customerCount: number; source: "stripe-live" | "app-db"; }

type RadarLeadStage = "captured" | "confirmed" | "alerted" | "clicked";
type SignupStatus = "Not started" | "Viewed" | "Started" | "Abandoned" | "Success";

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
  signup: SignupStatus;
  radar_lead_stage: RadarLeadStage | null;
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
    signup: SignupStatus;
    radar_lead_stage?: RadarLeadStage | null;
    last_activity: string | null;
    lead_score?: { score: number; level: "Very High" | "High" | "Medium" | "Low"; reasons: OppReason[] };
    conversion_opportunity?: { best_next: string; obstacle: string; cta: string };
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

/** Where-in-funnel marker (owner 2026-09-07): signup + radar + radar-lead
 *  stage in one compact chip row. Absent stages simply don't render. */
function funnelMarkers(r: ActOnRow): { label: string; cls: string; key: string }[] {
  const out: { label: string; cls: string; key: string }[] = [];
  if (r.radar_lead_stage) {
    const label = `Lead ${r.radar_lead_stage}`;
    out.push({ label, key: `lead-${r.radar_lead_stage}`, cls: "border-violet-200 bg-violet-50/70 text-violet-800" });
  }
  if (r.radar) out.push({ label: "Radar done", key: "radar", cls: "border-indigo-200 bg-indigo-50/70 text-indigo-800" });
  if (r.signup === "Success") out.push({ label: "Signed up", key: "signup-success", cls: "border-emerald-200 bg-emerald-50/70 text-emerald-800" });
  else if (r.signup === "Started" || r.signup === "Abandoned") out.push({ label: "Signup started", key: "signup-started", cls: "border-amber-200 bg-amber-50/70 text-amber-800" });
  else if (r.signup === "Viewed") out.push({ label: "Signup viewed", key: "signup-viewed", cls: "border-slate-200 bg-slate-50/70 text-slate-600" });
  return out;
}

function locationDevice(r: ActOnRow): string {
  const geo = [r.city, r.region].filter(Boolean).join(", ");
  const device = r.browser_label || r.device_type;
  if (geo && device) return `${geo} · ${device}`;
  if (geo) return geo;
  if (device) return device;
  return "Direct Lead";
}

/** Drop-off % to the NEXT stage (null when the current count is 0). */
function dropPct(next: number, prev: number): number | null {
  if (prev <= 0) return null;
  const p = Math.round((1 - next / prev) * 100);
  return p > 0 ? p : 0;
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
            <th className="px-5 py-3 font-medium">In funnel</th>
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
              <td className="px-5 py-3 whitespace-nowrap align-top">
                <span className={`inline-flex rounded-full px-2 py-0.5 text-xs font-semibold ${LEVEL_STYLE[r.level]}`}>
                  {r.level === "Very High" ? "🔥 Very High" : r.level === "High" ? "🔥 High" : r.level} · {r.score}
                </span>
                {r.reasons.length > 0 && (
                  <ul className="mt-1.5 max-w-[220px] space-y-0.5">
                    {r.reasons.slice(0, 3).map((rs, i) => (
                      <li key={i} className="text-[10px] leading-tight text-slate-500">+{rs.points} {rs.reason}</li>
                    ))}
                  </ul>
                )}
              </td>
              <td className="px-5 py-3 align-top">
                <div className="flex max-w-[200px] flex-wrap gap-1">
                  {funnelMarkers(r).map((m) => (
                    <span key={m.key} className={`inline-flex rounded-full border px-1.5 py-0.5 text-[10px] font-semibold ${m.cls}`}>
                      {m.label}
                    </span>
                  ))}
                </div>
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
        HIGH-VALUE ONLY: rows restricted to the existing board-side lead score's "Very High" / "High" levels (Medium/Low
        dropped), top 10 by score, newest activity breaks ties. Location is approximate / IP-derived; linked users show
        the masked label. Bot/QA/admin rows never appear.
      </p>
    </div>
  );
}

/** Revenue funnel bar (owner 2026-09-07 CEO health section). Every stage
 *  aggregates EXISTING funnel events; Paid is the live Stripe customer count.
 *  No fabricated numbers: a stage with no data renders "0" and 0% drop-off,
 *  and a zero funnel shows the honest empty state. */
function RevenueFunnel({ unified, radarLeads, fin, loading, error }: {
  unified: UnifiedResult | null;
  radarLeads: SimpleFunnel | null;
  fin: FinanceShape | null;
  loading: boolean;
  error: string;
}) {
  if (error) return <SectionError message={error} />;
  if (loading) return <SectionLoading message="Loading revenue funnel…" />;
  const stage = (list: { stage: string; count: number }[] | undefined, name: string): number =>
    list?.find((s) => s.stage === name)?.count ?? 0;
  const radar = unified ? stage(unified.stages, "radar") : null;
  const lead = radarLeads ? stage(radarLeads.funnel, "capture") : null;
  const confirmed = radarLeads ? stage(radarLeads.funnel, "confirmed") : null;
  const alertSent = radarLeads ? stage(radarLeads.funnel, "alert_sent") : null;
  const click = radarLeads ? stage(radarLeads.funnel, "click") : null;
  const signup = radarLeads ? stage(radarLeads.funnel, "signup") : null;
  const activated = unified ? stage(unified.stages, "activated") : null;
  const paid = fin ? fin.customerCount : null;
  const stages: { label: string; value: number | null; hint: string }[] = [
    { label: "Radar", value: radar, hint: "radar completed · 30d" },
    { label: "Lead", value: lead, hint: "email captured · 30d" },
    { label: "Confirmed", value: confirmed, hint: "email confirmed · 30d" },
    { label: "Alert", value: alertSent, hint: "match alert sent · 30d" },
    { label: "Click", value: click, hint: "opportunity clicked · 30d" },
    { label: "Signup", value: signup, hint: "radar-funnel signups · 30d" },
    { label: "Activated", value: activated, hint: "activated visitors · 30d" },
    { label: "Paid", value: paid, hint: fin ? (fin.source === "stripe-live" ? "live Stripe customers" : "live app-DB customers") : "live" },
  ];
  const allZero = stages.every((s) => (s.value ?? 0) === 0);
  return (
    <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
      {allZero ? (
        <>
          <p className="text-sm font-medium text-slate-700">No revenue-funnel traffic yet — honest zero state.</p>
          <p className="mt-1 text-xs text-slate-400">
            Radar completions flow through this funnel as real humans arrive; every stage reads live from the existing
            funnel events (bot/QA/admin excluded).
          </p>
        </>
      ) : (
        <div className="flex flex-wrap items-center gap-y-3">
          {stages.map((s, i) => {
            const prev = i === 0 ? null : stages[i - 1].value;
            const drop = prev != null && prev > 0 ? dropPct(s.value ?? 0, prev) : null;
            return (
              <div key={s.label} className="flex items-center">
                <div className="min-w-[104px] rounded-xl border border-slate-200 bg-slate-50/70 px-3 py-2">
                  <p className="text-[10px] font-semibold text-slate-500 uppercase tracking-wide">{s.label}</p>
                  <p className="text-xl font-bold text-slate-900">{s.value ?? "—"}</p>
                  <p className="mt-0.5 text-[9px] leading-tight text-slate-400">{s.hint}</p>
                </div>
                {i < stages.length - 1 && (
                  <span className="mx-1.5 w-10 text-center">
                    <span className="text-[10px] font-bold text-rose-500">{drop != null ? `−${drop}%` : "—"}</span>
                    <span className="block text-[9px] text-slate-300">→</span>
                  </span>
                )}
              </div>
            );
          })}
        </div>
      )}
      <p className="mt-3 border-t border-slate-100 pt-2 text-[10px] text-slate-400">
        Radar → Lead → Confirmed → Alert → Click → Signup → Activated → Paid. Aggregated from existing funnel events
        (unified-funnel / radar-leads-funnel / finance) — no analytics rewrite. Drop-off % is lost vs. the previous
        stage; null when the previous stage is 0.
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
  const [radarConv, setRadarConv] = useState<RadarConversionFunnelResult | null>(null);
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
      getJson<RadarConversionFunnelResult>("/api/admin/radar-conversion-funnel?days=30"),
      getJson<FinanceShape>("/api/admin/finance"),
    ])
      .then(([u, a, r, rc, fn]) => {
        if (cancelled) return;
        setUnified(u);
        setAutopsy(a);
        setRadarLeads(r);
        setRadarConv(rc);
        setFin(fn);
      })
      .catch((err) => {
        if (!cancelled) setError(err instanceof Error ? err.message : "Failed to load overview");
      })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, []);

  // 🔥 PEOPLE TO ACT ON — HIGH-VALUE ONLY: "Very High" / "High" level rows
  // (the existing board-side lead score), capped at top 10 by score.
  useEffect(() => {
    let cancelled = false;
    setActOnLoading(true);
    setActOnError("");
    getJson<JourneysShape>("/api/admin/journeys?days=30")
      .then((d) => {
        if (cancelled) return;
        const scored = (d.journeys ?? [])
          .filter((j) => j.lead_score && j.conversion_opportunity)
          .filter((j) => j.lead_score!.level === "Very High" || j.lead_score!.level === "High")
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
            radar_lead_stage: j.radar_lead_stage ?? null,
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
  const funnelCount = (name: string): number =>
    radarLeads?.funnel.find((s) => s.stage === name)?.count ?? 0;
  const autopsyCount = (name: string): number =>
    autopsy?.funnel.find((s) => s.stage === name)?.count ?? 0;

  // CONTRAX TODAY — the owner-exact 8 cards, in order (owner 2026-09-07
  // refined spec). Each maps LIVE from the existing endpoints:
  //   Qualified / Radar / Signups / Activated → unified-funnel
  //   Radar Leads (capture)                     → radar-leads-funnel
  //   Autopsy Started (entry)                   → autopsy-funnel
  //   Customers + MRR                           → finance (Stripe-live)
  const todayCards = [
    { label: "Qualified Visitors", value: unified ? stage("qualified") : null, hint: "qualified visits · 30d" },
    { label: "Radar Completed", value: unified ? stage("radar") : null, hint: "radar scans completed · 30d" },
    { label: "Radar Leads", value: radarLeads ? funnelCount("capture") : null, hint: "radar leads captured · 30d" },
    { label: "Autopsy Started", value: autopsy ? autopsyCount("autopsy_landing") : null, hint: "autopsies started · 30d" },
    { label: "Signups", value: unified ? stage("signup") : null, hint: "signups completed · 30d" },
    { label: "Activated", value: unified ? stage("activated") : null, hint: "activated visitors · 30d" },
    { label: "Customers", value: fin ? fin.customerCount : null, hint: fin ? (fin.source === "stripe-live" ? "live Stripe customers" : "live app-DB customers") : "live" },
    { label: "MRR", value: fin ? moneyWhole(fin.mrrCents) : null, hint: fin ? (fin.source === "stripe-live" ? "live Stripe MRR" : "live app-DB MRR") : "live" },
  ];

  return (
    <div className="min-h-screen bg-slate-50">
      <AdminHeader scoreboard={<MrrScoreboard />} />
      <main className="mx-auto max-w-6xl px-4 py-8 space-y-8">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h1 className="text-2xl font-bold text-slate-900">Admin Dashboard</h1>
        </div>
        <AdminTabs active="overview" />

        {/* CONTRAX TODAY — owner-exact 8-card scoreboard */}
        <section>
          <h2 className="text-lg font-semibold text-slate-800 mb-1">Contrax Today</h2>
          <p className="mb-3 text-xs text-slate-500">
            Qualified Visitors · Radar Completed · Radar Leads · Autopsy Started · Signups · Activated · Customers · MRR
            — live from the same endpoints as the tabs (30d). QA/admin/bot/test excluded.
          </p>
          {error ? (
            <SectionError message={error} />
          ) : loading ? (
            <SectionLoading message="Loading today's numbers…" />
          ) : (
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
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

        {/* REVENUE FUNNEL — CEO health section */}
        <section>
          <h2 className="text-lg font-semibold text-slate-800 mb-1">💰 Revenue Funnel</h2>
          <p className="mb-3 text-xs text-slate-500">
            Radar → Lead → Confirmed → Alert → Click → Signup → Activated → Paid — every stage aggregates existing
            funnel events (no analytics rewrite); Paid is the live Stripe customer count.
          </p>
          <RevenueFunnel unified={unified} radarLeads={radarLeads} fin={fin} loading={loading} error={error} />
        </section>
        {/* RADAR CONVERSION (09-07 sprint, PR2) — separate 9-stage funnel */}
        <section>
          <h2 className="text-lg font-semibold text-slate-800 mb-1">Radar Conversion (09-07 sprint)</h2>
          <p className="mb-3 text-xs text-slate-500">
            Qualified Visit → Radar Started → Radar Completed → Results Viewed → Unlock Shown → Unlock Clicked →
            Signup → Activated → Paid — separate from the 7-stage Radar-Leads funnel and the CEO Overview numbers
            above (untouched). Distinct visitors, consecutive drop-off, bot/QA/admin excluded.
          </p>
          {error ? (
            <SectionError message={error} />
          ) : loading || !radarConv ? (
            <SectionLoading message="Loading radar conversion funnel…" />
          ) : (
            <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
              <div className="flex flex-wrap items-center gap-y-3">
                {radarConv.funnel.map((s, idx) => {
                  const prev = idx === 0 ? null : radarConv.funnel[idx - 1].count;
                  const drop = prev != null && prev > 0 ? dropPct(s.count, prev) : null;
                  return (
                    <div key={s.stage} className="flex items-center">
                      <div className="min-w-[104px] rounded-xl border border-slate-200 bg-slate-50/70 px-3 py-2">
                        <p className="text-[10px] font-semibold text-slate-500 uppercase tracking-wide">{s.label}</p>
                        <p className="text-xl font-bold text-slate-900">{s.count}</p>
                        <p className="mt-0.5 text-[9px] leading-tight text-slate-400">
                          {idx === 0 ? "base · 30d" : drop != null ? `−${drop}% vs prev` : "— vs prev"}
                        </p>
                      </div>
                      {idx < radarConv.funnel.length - 1 && (
                        <span className="mx-1.5 w-10 text-center">
                          <span className="text-[10px] font-bold text-rose-500">{drop != null ? `−${drop}%` : "—"}</span>
                          <span className="block text-[9px] text-slate-300">→</span>
                        </span>
                      )}
                    </div>
                  );
                })}
              </div>
              <p className="mt-3 border-t border-slate-100 pt-2 text-[10px] text-slate-400">
                Drop-off % is lost vs. the previous stage; 0 when the previous stage is 0. Reads live from existing
                funnel events (no analytics rewrite).
              </p>
            </div>
          )}
        </section>

        {/* 🔥 PEOPLE TO ACT ON — HIGH-VALUE ONLY */}
        <section>
          <h2 className="text-lg font-semibold text-slate-800 mb-1">🔥 People to act on</h2>
          <p className="mb-3 text-xs text-slate-500">
            High / Very High-intent visitors only (existing lead-score heuristic) — with the recommended next step from
            the Conversion Opportunity mapping. Newest activity breaks ties.
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
