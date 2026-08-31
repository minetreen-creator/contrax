import { createFileRoute, redirect } from "@tanstack/react-router";
import { useEffect, useState, useCallback, type ReactNode } from "react";
import { getCurrentUser } from "~/lib/auth";

/**
 * Contrax Jarvis — BRAIN + OWNER CONTROLS (Phase 6). Admin-only.
 *
 * An owner-facing read dashboard over the Phase 1–5 ledgers (Company Health,
 * Biggest Problem, Detected-While-Away, Hypotheses, Recommendations-Waiting,
 * Experiments, Learned / Disproven, Strategic Decisions, Unknowns, Recent Runs,
 * Actions queue) plus TWO owner-gated controls:
 *   • Approval queue  — approve / deny pending L4 jarvis_actions (only the owner,
 *     admin-gated; approved rows are never hard-deleted).
 *   • Owner mode      — flip availability (available/away/do_not_disturb) and the
 *     kill switch, with the worker-run consequence shown.
 *
 * Every number shown comes from a real SQL query over the existing ledgers
 * (GET /api/admin/jarvis/brain) — nothing is fabricated. All rendered DB text is
 * escaped by React (no dangerouslySetInnerHTML).
 */

interface RunRow {
  id: number; run_type: string; started_at: string; completed_at: string | null;
  status: string; refused: boolean; refused_reason: string | null; note: string | null;
  problems_detected: number; recommendations_created: number; safe_actions_taken: number;
  findings_count: number; hypotheses: number; records_modified: number; trigger_kind: string | null;
}
interface ActionLite {
  id: number; action_type: string; resource: string | null; authority_level: string;
  status: string; requested_by: string | null; requested_at: string; decided_at: string | null;
  decided_by: string | null; reason: string | null; owner_approved: boolean;
}
interface ProblemRow { id: number; category: string; title: string; description: string | null; severity: string; confidence: number; status: string; owner_acknowledged: boolean; detected_at: string; }
interface HypRow { id: number; problem_id: number | null; hypothesis: string; confidence: number; status: string; created_at: string; }
interface ExpRow { id: number; hypothesis_id: number | null; name: string; status: string; owner_approved: boolean; created_at: string; result: string | null; conclusion: string | null; }
interface OutcomeRow { id: number; subject_type: string; subject_id: string; metric: string; conclusion: string | null; confidence: number | null; created_at: string; }
interface MemRow { id: number; category: string; fact: string; confidence: number; owner_approved: boolean; created_at: string; superseded_by: number | null; }
interface DecRow { id: number; decision: string; rationale: string | null; effective_at: string; }
interface FeedbackRow { id: number; recommendation_id: number; accepted: boolean | null; owner_rating: number | null; owner_comment: string | null; created_at: string; }

interface BrainSnapshot {
  owner: { availability: string; killSwitch: boolean; updatedAt: string };
  ownerModeNote: string;
  health: { totalRuns: number; lastRun: RunRow | null; recentRuns: RunRow[]; refusedRuns: number; failedRuns: number };
  problems: ProblemRow[];
  openProblems: ProblemRow[];
  detectedWhileAway: { problems: ProblemRow[]; hypotheses: HypRow[]; actions: ActionLite[]; runs: RunRow[] };
  hypotheses: HypRow[];
  openHypotheses: HypRow[];
  experiments: ExpRow[];
  feedback: FeedbackRow[];
  outcomes: OutcomeRow[];
  learned: MemRow[];
  disproven: MemRow[];
  candidates: MemRow[];
  decisions: DecRow[];
  candidateDecisions: DecRow[];
  runs: RunRow[];
  actions: { pending: ActionLite[]; approved: ActionLite[]; denied: ActionLite[]; executed: ActionLite[]; failed: ActionLite[] };
  counts: Record<string, number>;
}

async function loadBrain(): Promise<BrainSnapshot> {
  const res = await fetch("/api/admin/jarvis/brain");
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: "Failed to load brain" }));
    throw new Error(err.error || "Failed to load brain");
  }
  return res.json();
}

async function postJSON(url: string, body: unknown): Promise<{ ok: boolean; error?: string; [k: string]: unknown }> {
  const res = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  const data = (await res.json().catch(() => ({}))) as { ok?: boolean; error?: string };
  if (!res.ok) throw new Error(data.error || "Request failed");
  return { ok: true, ...data };
}

/* ── tiny presentational helpers ─────────────────────────────────────────── */
function severityClass(s: string): string {
  switch (s) {
    case "CRITICAL": return "bg-red-500/20 text-red-300 border-red-500/40";
    case "IMPORTANT": return "bg-amber-500/20 text-amber-300 border-amber-500/40";
    case "WATCH": return "bg-yellow-500/15 text-yellow-200 border-yellow-500/30";
    default: return "bg-slate-500/15 text-slate-300 border-slate-500/30";
  }
}
function Badge({ children, cls }: { children: ReactNode; cls?: string }) {
  return (
    <span className={`inline-flex rounded-full border px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider ${cls ?? "border-slate-600 bg-slate-700/40 text-slate-300"}`}>
      {children}
    </span>
  );
}
function Card({ title, subtitle, badge, children }: { title: string; subtitle?: string; badge?: React.ReactNode; children: React.ReactNode }) {
  return (
    <section className="rounded-2xl border border-slate-800 bg-slate-900/60 p-4">
      <div className="mb-3 flex items-center justify-between gap-2">
        <div>
          <h2 className="text-sm font-bold text-slate-100">{title}</h2>
          {subtitle && <p className="text-[11px] text-slate-500">{subtitle}</p>}
        </div>
        {badge}
      </div>
      <div className="text-sm text-slate-300">{children}</div>
    </section>
  );
}
function Empty({ text }: { text: string }) {
  return <p className="text-xs italic text-slate-500">{text}</p>;
}
function fmt(iso: string): string {
  if (!iso) return "—";
  try {
    return new Date(iso).toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
  } catch {
    return String(iso);
  }
}

export const Route = createFileRoute("/jarvis/brain")({
  loader: async () => {
    const user = await getCurrentUser();
    if (!user) throw redirect({ to: "/login" });
    if (!user.is_admin) throw redirect({ href: "/dashboard?notice=admin-only" });
    return { user };
  },
  component: BrainPage,
  head: () => ({
    meta: [
      { name: "robots", content: "noindex, nofollow" },
      { title: "Jarvis Brain | Contrax" },
    ],
  }),
});

function BrainPage() {
  const [data, setData] = useState<BrainSnapshot | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState("");

  const refresh = useCallback(async () => {
    setBusy(true);
    setError("");
    try {
      setData(await loadBrain());
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load brain");
    } finally {
      setBusy(false);
    }
  }, []);

  useEffect(() => { void refresh(); }, [refresh]);

  const setMode = async (availability?: string, killSwitch?: boolean) => {
    setBusy(true); setError(""); setNotice("");
    try {
      await postJSON("/api/admin/jarvis/owner-mode", { availability, killSwitch });
      setNotice("Owner mode updated.");
      await refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not update owner mode");
    } finally {
      setBusy(false);
    }
  };

  const decide = async (id: number, outcome: "approve" | "deny") => {
    setBusy(true); setError(""); setNotice("");
    try {
      await postJSON("/api/admin/jarvis/action", { id, outcome });
      setNotice(`Action #${id} ${outcome}d.`);
      await refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not update action");
    } finally {
      setBusy(false);
    }
  };

  const owner = data?.owner;
  const ownerAway = owner && owner.availability !== "available";
  const pendingRecs = (data?.actions.pending ?? []).filter((a) =>
    a.action_type === "prepare_recommendation" || a.action_type === "prepare_owner_review_item");

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100">
      <header className="sticky top-0 z-10 border-b border-slate-800 bg-slate-950">
        <div className="mx-auto max-w-6xl px-4 py-3 flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <a href="/" className="inline-flex items-center gap-2">
              <img src="/logo.png" alt="Contrax" className="h-8 w-auto rounded" />
            </a>
            <span className="text-sm font-bold tracking-wide text-slate-100">JARVIS</span>
            <span className="hidden sm:inline text-xs font-semibold text-cyan-400">/ Brain</span>
            <span className="rounded-full bg-amber-500/15 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-amber-400">Owner controls</span>
          </div>
          <div className="flex items-center gap-3">
            <a href="/jarvis" className="text-xs font-medium text-slate-400 hover:text-slate-200">Assistant &rarr;</a>
            <a href="/admin" className="text-xs font-medium text-slate-400 hover:text-slate-200">Admin &rarr;</a>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-6xl px-4 py-6 space-y-5">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <h1 className="text-xl font-bold text-white">Jarvis Brain</h1>
            <p className="mt-1 text-sm text-slate-400">
              Live, auditable read of Jarvis's memory &amp; operations. Only two things here write anywhere:
              approving/denying queued actions and setting owner mode. Everything else is read-only.
            </p>
          </div>
          <button onClick={() => void refresh()} disabled={busy}
            className="rounded-xl border border-slate-700 px-4 py-2 text-sm text-slate-300 hover:text-slate-100 disabled:opacity-40">
            {busy ? "Loading…" : "↻ Refresh"}
          </button>
        </div>

        {error && <p className="rounded-xl border border-red-500/30 bg-red-500/10 px-3 py-2 text-xs text-red-300">{error}</p>}
        {notice && <p className="rounded-xl border border-emerald-500/30 bg-emerald-500/10 px-3 py-2 text-xs text-emerald-300">{notice}</p>}

        {!data && !error && (
          <p className="text-sm text-slate-500">Loading the brain from the Jarvis ledgers…</p>
        )}

        {data && (
          <>
            {/* ── OWNER CONTROLS ─────────────────────────────────────────────── */}
            <Card title="Owner controls" subtitle="Steer the scheduled worker — kill switch and away mode refuse all work (logged, no side effects).">
              <div className="space-y-4">
                <div>
                  <p className="mb-1.5 text-xs font-semibold uppercase tracking-wider text-slate-500">Status</p>
                  <div className="flex flex-wrap gap-2">
                    {(["available", "away", "do_not_disturb"] as const).map((av) => (
                      <button key={av} onClick={() => void setMode(av)} disabled={busy}
                        className={`rounded-full border px-3 py-1.5 text-xs font-semibold disabled:opacity-50 ${
                          owner?.availability === av
                            ? "border-cyan-500/60 bg-cyan-500/20 text-cyan-200"
                            : "border-slate-700 text-slate-400 hover:text-slate-200"
                        }`}>
                        {av === "do_not_disturb" ? "Do Not Disturb" : av}
                      </button>
                    ))}
                    <button onClick={() => void setMode(undefined, !(owner?.killSwitch))} disabled={busy}
                      className={`rounded-full border px-3 py-1.5 text-xs font-semibold disabled:opacity-50 ${
                        owner?.killSwitch ? "border-red-500/60 bg-red-500/20 text-red-300" : "border-slate-700 text-slate-400 hover:text-slate-200"
                      }`}>
                      {owner?.killSwitch ? "⛔ Kill switch ON" : "Kill switch OFF"}
                    </button>
                  </div>
                </div>
                <div className="rounded-xl border border-slate-800 bg-slate-950/60 p-3">
                  <div className="flex items-center gap-2">
                    {owner?.killSwitch ? <Badge cls={severityClass("CRITICAL")}>KILL SWITCH</Badge>
                      : ownerAway ? <Badge cls="border-amber-500/40 bg-amber-500/15 text-amber-300">AWAY</Badge>
                      : <Badge cls="border-emerald-500/40 bg-emerald-500/15 text-emerald-300">AVAILABLE</Badge>}
                    <span className="text-xs text-slate-400">Current: <span className="font-medium text-slate-200">{owner?.availability}</span> · Updated {fmt(owner?.updatedAt ?? "")}</span>
                  </div>
                  <p className="mt-2 text-xs text-slate-300">{data.ownerModeNote}</p>
                  {ownerAway && <p className="mt-1 text-[11px] text-slate-500">While away, scheduled runs are logged as refused and deferred — findings, problems, and actions are still captured so you have a clean return brief.</p>}
                </div>
              </div>
            </Card>

            {/* ── APPROVAL QUEUE ─────────────────────────────────────────────── */}
            <Card title="Approval queue (L4 — owner only)"
              subtitle="Pending actions Jarvis is asking you to approve or deny. Approved rows are never hard-deleted."
              badge={<Badge cls="border-cyan-500/40 bg-cyan-500/15 text-cyan-300">{data.actions.pending.length} pending</Badge>}>
              {data.actions.pending.length === 0 ? (
                <Empty text="Nothing waiting for your approval." />
              ) : (
                <ul className="space-y-2">
                  {data.actions.pending.map((a) => (
                    <li key={a.id} className="rounded-xl border border-slate-800 bg-slate-950/60 p-3">
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <div className="min-w-0">
                          <p className="text-sm font-medium text-slate-100 break-words">
                            <span className="text-cyan-400">#{a.id}</span> {a.action_type}
                            {a.resource && <span className="text-slate-400"> · {a.resource}</span>}
                          </p>
                          <p className="text-[11px] text-slate-500">
                            {a.authority_level} · by {a.requested_by ?? "jarvis"} · {fmt(a.requested_at)}
                            {a.reason && <span className="block text-slate-500">“{a.reason}”</span>}
                          </p>
                        </div>
                        <div className="flex gap-2">
                          <button onClick={() => void decide(a.id, "approve")} disabled={busy}
                            className="rounded-lg border border-emerald-500/40 bg-emerald-500/15 px-3 py-1.5 text-xs font-semibold text-emerald-300 hover:bg-emerald-500/25 disabled:opacity-40">✓ Approve</button>
                          <button onClick={() => void decide(a.id, "deny")} disabled={busy}
                            className="rounded-lg border border-red-500/40 bg-red-500/15 px-3 py-1.5 text-xs font-semibold text-red-300 hover:bg-red-500/25 disabled:opacity-40">✕ Deny</button>
                        </div>
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </Card>

            {/* ── ACTIVITY — actions taken / refused ───────────────────────── */}
            <div className="grid gap-5 lg:grid-cols-2">
              <Card title="Actions taken" subtitle="Approved &amp; executed queue decisions">
                {data.actions.executed.length === 0 && data.actions.approved.length === 0 ? (
                  <Empty text="No executed or approved actions yet." />
                ) : (
                  <ul className="space-y-1.5 text-xs">
                    {[...data.actions.executed, ...data.actions.approved].slice(0, 8).map((a) => (
                      <li key={`${a.status}-${a.id}`} className="flex items-center gap-2">
                        <Badge cls="border-emerald-500/40 bg-emerald-500/15 text-emerald-300">{a.status}</Badge>
                        <span className="text-slate-300 break-words">#{a.id} {a.action_type}{a.resource ? ` · ${a.resource}` : ""}</span>
                        <span className="ml-auto shrink-0 text-slate-600">{fmt(a.decided_at ?? a.requested_at)}</span>
                      </li>
                    ))}
                  </ul>
                )}
              </Card>
              <Card title="Actions refused / denied" subtitle="Denied by you, or refused runs (away / kill switch)">
                {data.actions.denied.length === 0 && data.health.refusedRuns === 0 ? (
                  <Empty text="Nothing denied or refused." />
                ) : (
                  <div className="space-y-2">
                    {data.actions.denied.slice(0, 5).map((a) => (
                      <p key={a.id} className="text-xs text-slate-300 break-words">✕ #{a.id} {a.action_type} · denied {a.decided_at ? fmt(a.decided_at) : ""}</p>
                    ))}
                    {data.health.refusedRuns > 0 && (
                      <p className="text-xs text-slate-400">
                        ⏸ {data.health.refusedRuns} recent run{data.health.refusedRuns === 1 ? " was" : "s were"} refused (away / kill switch) — {data.runs.filter((r) => r.refused).slice(-3).map((r) => `#${r.id} ${r.run_type}${r.refused_reason ? ` (${r.refused_reason})` : ""}`).join(", ") || "see Recent Runs"}.
                      </p>
                    )}
                  </div>
                )}
              </Card>
            </div>

            <div className="grid gap-5 lg:grid-cols-3">
              {/* ── COMPANY HEALTH ─────────────────────────────────────────── */}
              <Card title="Company Health" subtitle="Recent jarvis_runs audit log"
                badge={<Badge cls="border-slate-600 bg-slate-700/40 text-slate-300">{data.health.totalRuns} runs</Badge>}>
                {data.health.lastRun ? (
                  <div className="space-y-2">
                    <p className="text-xs">
                      <span className="font-medium text-slate-200">Last run</span> <span className="text-cyan-300">#{data.health.lastRun.id}</span> {data.health.lastRun.run_type}
                      {" "}· {data.health.lastRun.status}
                      {data.health.lastRun.refused && <span className="ml-1 text-amber-300">refused</span>}
                    </p>
                    <p className="text-[11px] text-slate-400">Findings: {data.health.lastRun.findings_count} · problems: {data.health.lastRun.problems_detected} · recs: {data.health.lastRun.recommendations_created} · safe actions: {data.health.lastRun.safe_actions_taken}</p>
                    {data.health.lastRun.note && <p className="text-[11px] leading-relaxed text-slate-400 whitespace-pre-wrap break-words">📋 {data.health.lastRun.note}</p>}
                    {data.health.refusedRuns > 0 && <p className="text-[11px] text-slate-500">⏸ {data.health.refusedRuns} recent run(s) were refused while you were away / kill switch on.</p>}
                    {data.health.failedRuns > 0 && <p className="text-[11px] text-red-300">⚠ {data.health.failedRuns} recent run(s) failed.</p>}
                  </div>
                ) : <Empty text="No scheduled runs recorded yet — the worker hasn't fired." />}
              </Card>

              {/* ── BIGGEST PROBLEM ─────────────────────────────────────────── */}
              <Card title="Biggest Problem" subtitle="Top open problems by severity &amp; confidence (min-sample gating already applied)"
                badge={<Badge cls="border-red-500/30 bg-red-500/10 text-red-300">{data.openProblems.length} open</Badge>}>
                {data.openProblems.length === 0 ? (
                  <Empty text="No open problems on the ledger." />
                ) : (
                  <ul className="space-y-2.5">
                    {data.openProblems.slice(0, 5).map((p) => (
                      <li key={p.id} className="rounded-xl border border-slate-800 bg-slate-950/60 p-3">
                        <div className="flex items-start justify-between gap-2">
                          <p className="text-xs font-medium text-slate-100 break-words">{p.title}</p>
                          <Badge cls={severityClass(p.severity)}>{p.severity}</Badge>
                        </div>
                        <p className="mt-1 text-[11px] text-slate-500">
                          <span className="text-slate-400">{p.category}</span> · conf {(p.confidence * 100).toFixed(0)}% · {p.status}
                          {!p.owner_acknowledged && <span className="ml-1 text-amber-400">(unacknowledged)</span>}
                        </p>
                      </li>
                    ))}
                  </ul>
                )}
              </Card>

              {/* ── DETECTED WHILE AWAY ─────────────────────────────────────── */}
              <Card title="Detected while away" subtitle="Problems / hypotheses / actions that arrived while you were away or DND"
                badge={ownerAway ? <Badge cls="border-amber-500/40 bg-amber-500/15 text-amber-300">away</Badge> : <Badge cls="border-emerald-500/40 bg-emerald-500/15 text-emerald-300">available</Badge>}>
                {!ownerAway ? (
                  <Empty text="You're currently available — this section only fills in while you're away." />
                ) : (
                  <ul className="space-y-1.5 text-xs">
                    {data.detectedWhileAway.problems.map((p) => (
                      <li key={`p${p.id}`} className="flex items-center gap-2"><Badge cls={severityClass(p.severity)}>P</Badge><span className="text-slate-300 break-words">{p.title}</span></li>
                    ))}
                    {data.detectedWhileAway.hypotheses.map((h) => (
                      <li key={`h${h.id}`} className="flex items-center gap-2"><Badge cls="border-cyan-500/40 bg-cyan-500/15 text-cyan-300">H</Badge><span className="text-slate-300 break-words">{h.hypothesis}</span></li>
                    ))}
                    {data.detectedWhileAway.actions.map((a) => (
                      <li key={`a${a.id}`} className="flex items-center gap-2"><Badge cls="border-violet-500/40 bg-violet-500/15 text-violet-300">A</Badge><span className="text-slate-300 break-words">#{a.id} {a.action_type}</span></li>
                    ))}
                    {data.detectedWhileAway.runs.map((r) => (
                      <li key={`r${r.id}`} className="flex items-center gap-2"><Badge cls="border-slate-600 bg-slate-700/40 text-slate-300">R</Badge><span className="text-slate-300 break-words">{r.run_type} {r.refused ? "(refused)" : "(ran)"}</span></li>
                    ))}
                    {data.detectedWhileAway.problems.length + data.detectedWhileAway.hypotheses.length + data.detectedWhileAway.actions.length + data.detectedWhileAway.runs.length === 0 && (
                      <Empty text="Nothing arrived since you went away." />
                    )}
                  </ul>
                )}
              </Card>
            </div>

            <div className="grid gap-5 lg:grid-cols-2">
              {/* ── HYPOTHESES + UNKNOWNS ─────────────────────────────────────── */}
              <Card title="Hypotheses" subtitle="Open hypotheses (proposed / testing / active)" badge={<Badge cls="border-cyan-500/40 bg-cyan-500/15 text-cyan-300">{data.openHypotheses.length} open</Badge>}>
                {data.openHypotheses.length === 0 ? (
                  <Empty text="No open hypotheses." />
                ) : (
                  <ul className="space-y-2">
                    {data.openHypotheses.slice(0, 6).map((h) => (
                      <li key={h.id} className="rounded-xl border border-slate-800 bg-slate-950/60 p-2.5">
                        <p className="text-xs text-slate-200 break-words">{h.hypothesis}</p>
                        <p className="text-[11px] text-slate-500">{h.status} · conf {(h.confidence * 100).toFixed(0)}%{h.problem_id ? ` · problem #${h.problem_id}` : ""}</p>
                      </li>
                    ))}
                  </ul>
                )}
                <div className="mt-3 border-t border-slate-800 pt-2.5">
                  <p className="text-[11px] font-semibold uppercase tracking-wider text-slate-500">Unresolved questions / known unknowns</p>
                  {data.candidates.length === 0 && data.candidateDecisions.length === 0 ? (
                    <p className="mt-1 text-xs italic text-slate-500">No unaffirmed candidates.</p>
                  ) : (
                    <ul className="mt-1 space-y-1 text-[11px] text-slate-400">
                      {data.candidates.slice(0, 3).map((m) => <li key={m.id} className="break-words">• {m.category}: {m.fact}</li>)}
                      {data.candidateDecisions.slice(0, 3).map((d) => <li key={d.id} className="break-words">• decision: {d.decision}</li>)}
                    </ul>
                  )}
                </div>
              </Card>

              {/* ── EXPERIMENTS / OUTCOMES ────────────────────────────────────── */}
              <Card title="Experiments &amp; outcomes" subtitle="Active experiments and measured outcomes" badge={<Badge cls="border-violet-500/40 bg-violet-500/15 text-violet-300">{data.experiments.length}</Badge>}>
                {data.experiments.length === 0 ? (
                  <Empty text="No experiments recorded." />
                ) : (
                  <ul className="space-y-2">
                    {data.experiments.slice(0, 6).map((e) => (
                      <li key={e.id} className="rounded-xl border border-slate-800 bg-slate-950/60 p-2.5">
                        <div className="flex items-center justify-between gap-2">
                          <p className="text-xs font-medium text-slate-200 break-words">{e.name}</p>
                          <Badge cls={e.status === "running" ? "border-emerald-500/40 bg-emerald-500/15 text-emerald-300" : e.status === "completed" ? "border-cyan-500/40 bg-cyan-500/15 text-cyan-300" : "border-slate-600 bg-slate-700/40 text-slate-300"}>{e.status}</Badge>
                        </div>
                        {e.conclusion && <p className="mt-1 text-[11px] text-slate-400 break-words">{e.conclusion}</p>}
                      </li>
                    ))}
                  </ul>
                )}
                {data.outcomes.length > 0 && (
                  <div className="mt-3 border-t border-slate-800 pt-2.5">
                    <p className="text-[11px] font-semibold uppercase tracking-wider text-slate-500">Outcomes</p>
                    <ul className="mt-1 space-y-1 text-[11px] text-slate-400">
                      {data.outcomes.slice(0, 4).map((o) => (
                        <li key={o.id} className="break-words">• {o.metric}: {o.conclusion ?? "measured"} {o.confidence != null ? `(conf ${(o.confidence * 100).toFixed(0)}%)` : ""}</li>
                      ))}
                    </ul>
                  </div>
                )}
              </Card>
            </div>

            <div className="grid gap-5 lg:grid-cols-3">
              {/* ── LEARNED / DISPROVEN ─────────────────────────────────────── */}
              <Card title="Learned" subtitle="Owner-approved live memory" badge={<Badge cls="border-emerald-500/40 bg-emerald-500/15 text-emerald-300">{data.learned.length}</Badge>}>
                {data.learned.length === 0 ? (
                  <Empty text="No approved facts yet." />
                ) : (
                  <ul className="space-y-1.5 text-[11px] text-slate-400">
                    {data.learned.slice(0, 6).map((m) => (
                      <li key={m.id} className="border-l-2 border-emerald-500/40 pl-2 break-words"><span className="text-slate-500">{m.category}:</span> {m.fact}</li>
                    ))}
                  </ul>
                )}
              </Card>

              <Card title="Disproven assumptions" subtitle="Approved facts that were later superseded / retired" badge={<Badge cls="border-red-500/30 bg-red-500/10 text-red-300">{data.disproven.length}</Badge>}>
                {data.disproven.length === 0 ? (
                  <Empty text="Nothing has been superseded." />
                ) : (
                  <ul className="space-y-1.5 text-[11px] text-slate-400">
                    {data.disproven.slice(0, 6).map((m) => (
                      <li key={m.id} className="line-through opacity-70 break-words">{m.fact}</li>
                    ))}
                  </ul>
                )}
              </Card>

              {/* ── STRATEGIC DECISIONS ─────────────────────────────────────── */}
              <Card title="Strategic decisions" subtitle="Approved decisions + owner preferences" badge={<Badge cls="border-amber-500/40 bg-amber-500/15 text-amber-300">{data.decisions.length}</Badge>}>
                {data.decisions.length === 0 ? (
                  <Empty text="No approved decisions yet." />
                ) : (
                  <ul className="space-y-1.5 text-[11px] text-slate-400">
                    {data.decisions.slice(0, 6).map((d) => (
                      <li key={d.id} className="border-l-2 border-amber-500/40 pl-2 break-words">{d.decision}{d.rationale ? <span className="text-slate-600"> — {d.rationale}</span> : ""}</li>
                    ))}
                  </ul>
                )}
              </Card>
            </div>

            {/* ── RECENT RUNS ─────────────────────────────────────────────── */}
            <Card title="Recent runs" subtitle="Latest scheduled-worker audit rows" badge={<Badge cls="border-slate-600 bg-slate-700/40 text-slate-300">{data.runs.length}</Badge>}>
              {data.runs.length === 0 ? (
                <Empty text="No runs recorded yet." />
              ) : (
                <ul className="space-y-1.5 text-xs">
                  {data.runs.slice(0, 8).map((r) => (
                    <li key={r.id} className="flex items-start gap-2 rounded-lg border border-slate-800 bg-slate-950/60 p-2">
                      <span className={`mt-0.5 inline-block h-2 w-2 shrink-0 rounded-full ${r.status === "failed" ? "bg-red-400" : r.refused ? "bg-amber-400" : "bg-emerald-400"}`} />
                      <div className="min-w-0">
                        <p className="break-words text-slate-300">
                          <span className="text-cyan-400">#{r.id}</span> {r.run_type}
                          {r.refused && <span className="ml-1 text-amber-300">refused{r.refused_reason ? ` · ${r.refused_reason}` : ""}</span>}
                          {r.status === "failed" && <span className="ml-1 text-red-300">failed</span>}
                          <span className="ml-1 text-slate-500">· {fmt(r.started_at)}</span>
                        </p>
                        {r.note && <p className="mt-0.5 text-[11px] text-slate-500 break-words whitespace-pre-wrap line-clamp-2">{r.note}</p>}
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </Card>

            <p className="text-[10px] text-slate-600">
              Every figure above is read live from the Jarvis ledgers — nothing is fabricated.{" "}
              {data.counts.memory} memory rows · {data.counts.decisions} decisions · {data.counts.problems} problems ·{" "}
              {data.counts.hypotheses} hypotheses · {data.counts.experiments} experiments · {data.counts.outcomes} outcomes ·{" "}
              {data.counts.actions} actions · {data.counts.runs} runs. All rendered text is escaped; never evaluated.
            </p>
          </>
        )}
      </main>
    </div>
  );
}
