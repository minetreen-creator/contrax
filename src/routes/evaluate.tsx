import { createFileRoute } from "@tanstack/react-router";
import { createServerFn } from "@tanstack/react-start";
import { useEffect, useState, type ChangeEvent, type ReactNode } from "react";
import { getCurrentUser } from "~/lib/auth";
import { TrialGate, PlanGate } from "~/components/TrialGate";
import {
  evaluateProposal,
  type ProposalEvaluation,
  type RedTeamDecision,
  type CriterionStatus,
  type RecommendationImpact,
} from "~/lib/evaluator";
import { sql } from "~/db";

// ── Server functions ────────────────────────────────────────────────────────
const loadBids = createServerFn({ method: "GET" }).handler(async () => {
  const user = await getCurrentUser();
  if (!user) return [];
  try {
    await sql()`CREATE TABLE IF NOT EXISTS tracked_bids (id SERIAL PRIMARY KEY, user_email TEXT NOT NULL, bid_id TEXT NOT NULL, bid_title TEXT NOT NULL, agency TEXT NOT NULL, due_date TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'tracked', last_checked TIMESTAMPTZ DEFAULT NOW(), created_at TIMESTAMPTZ DEFAULT NOW(), UNIQUE(user_email, bid_id))`;
    const rows = await sql()`SELECT bid_id, bid_title, agency, due_date FROM tracked_bids WHERE user_email = ${user.email} ORDER BY due_date ASC`;
    return rows as { bid_id: string; bid_title: string; agency: string; due_date: string }[];
  } catch {
    return [];
  }
});

const loadBidDetails = createServerFn({ method: "GET" })
  .validator((d: unknown) => {
    const x = d as { bidId?: string };
    if (!x?.bidId) throw new Error("Missing bid id");
    return { bidId: String(x.bidId) };
  })
  .handler(async ({ data }) => {
    const user = await getCurrentUser();
    if (!user) return null;
    try {
      const byId = await sql()`SELECT title, agency, description, set_aside, due_date FROM bids WHERE id = ${Number(data.bidId) || 0} LIMIT 1`;
      const rows = byId.length ? byId : await sql()`SELECT title, agency, description, set_aside, due_date FROM bids WHERE external_id = ${data.bidId} LIMIT 1`;
      if (!rows.length) return null;
      const r = rows[0] as any;
      return {
        title: String(r.title || ""),
        agency: String(r.agency || ""),
        description: String(r.description || ""),
        setAside: r.set_aside ? String(r.set_aside) : "",
        dueDate: r.due_date ? String(r.due_date) : "",
      };
    } catch {
      return null;
    }
  });

const runEvaluation = createServerFn({ method: "POST" })
  .validator((d: unknown) => {
    const x = d as { rfp?: string; proposal?: string };
    if (!x.rfp?.trim() || !x.proposal?.trim())
      throw new Error("Both the RFP (Section M) and your proposal draft are required.");
    if (x.rfp.trim().length < 150)
      throw new Error("The RFP text looks too short — paste at least the full Section M evaluation criteria.");
    if (x.proposal.trim().length < 150)
      throw new Error("The proposal draft looks too short — paste the full draft you want reviewed.");
    return { rfp: x.rfp.trim(), proposal: x.proposal.trim() };
  })
  .handler(async ({ data }) => {
    const user = await getCurrentUser();
    if (!user) throw new Error("Not authenticated");
    // Offeror profile (NAICS, certifications, past performance) — optional, best-effort.
    let profile: { naics?: string; certifications?: string[]; pastPerformance?: string } | null = null;
    try {
      const rows = await sql()`SELECT naics_codes, certifications, past_performance_summary FROM business_profiles WHERE user_id = ${user.id} ORDER BY created_at DESC LIMIT 1`;
      if (rows.length) {
        const r = rows[0] as any;
        const naics = Array.isArray(r.naics_codes)
          ? r.naics_codes.map(String).join(", ")
          : typeof r.naics_codes === "string"
            ? r.naics_codes
            : "";
        profile = {
          naics: naics || undefined,
          certifications: Array.isArray(r.certifications) ? r.certifications.map(String) : undefined,
          pastPerformance: r.past_performance_summary ? String(r.past_performance_summary) : undefined,
        };
      }
    } catch {
      /* profile is optional — review still runs */
    }
    return evaluateProposal(data.rfp, data.proposal, profile);
  });

// ── Route ───────────────────────────────────────────────────────────────────
export const Route = createFileRoute("/evaluate")({
  loader: () => getCurrentUser(),
  component: EvaluatePage,
  head: () => ({
    meta: [
      { title: "Red Team Proposal Auditing — AI Review | Contrax" },
      {
        name: "description",
        content:
          "Run an AI Red Team review of your government proposal before submission. Get Section M criterion scores, missing elements, FAR/DFARS compliance risks, weak arguments, and prioritized fixes.",
      },
    ],
  }),
});

function EvaluatePage() {
  const user = Route.useLoaderData();
  if (!user)
    return (
      <div className="min-h-screen bg-slate-950 p-10 text-white">
        <h1 className="text-4xl font-bold">🔴 Red Team</h1>
        <p className="mt-4">Sign in to run an AI Red Team review of your proposal draft.</p>
        <a className="mt-6 inline-block rounded-lg bg-amber-500 px-5 py-3 font-semibold" href="/login">
          Sign in →
        </a>
      </div>
    );
  return (
    <TrialGate>
      <PlanGate featureName="Red Team proposal auditing" minTier="agency">
        <RedTeamApp />
      </PlanGate>
    </TrialGate>
  );
}

// ── Progress steps shown while the AI review runs ───────────────────────────
const REVIEW_STEPS = [
  "Reading RFP and proposal…",
  "Extracting Section M evaluation criteria…",
  "Scoring each evaluation factor…",
  "Checking FAR/DFARS compliance…",
  "Hunting weak arguments and unsupported claims…",
  "Writing prioritized recommendations…",
];

function RedTeamApp() {
  const [bids, setBids] = useState<{ bid_id: string; bid_title: string; agency: string; due_date: string }[]>([]);
  const [rfp, setRfp] = useState("");
  const [proposal, setProposal] = useState("");
  const [selectedBid, setSelectedBid] = useState("");
  const [result, setResult] = useState<ProposalEvaluation | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [fileError, setFileError] = useState("");
  const [stepIndex, setStepIndex] = useState(0);

  useEffect(() => {
    loadBids()
      .then(setBids)
      .catch(() => {});
  }, []);

  // Advance the progress indicator while the review runs.
  useEffect(() => {
    if (!loading) return;
    setStepIndex(0);
    const id = setInterval(() => {
      setStepIndex((i) => Math.min(i + 1, REVIEW_STEPS.length - 1));
    }, 2200);
    return () => clearInterval(id);
  }, [loading]);

  const selectBid = async (bidId: string) => {
    setSelectedBid(bidId);
    if (!bidId) return;
    try {
      const detail = await loadBidDetails({ data: { bidId } });
      if (detail) {
        const parts = [
          detail.title ? `SOLICITATION TITLE: ${detail.title}` : "",
          detail.agency ? `AGENCY: ${detail.agency}` : "",
          detail.setAside ? `SET-ASIDE: ${detail.setAside}` : "",
          detail.dueDate ? `DUE DATE: ${new Date(detail.dueDate).toLocaleDateString("en-US")}` : "",
          detail.description ? `\nOPPORTUNITY DESCRIPTION:\n${detail.description}` : "",
        ].filter(Boolean);
        if (parts.length) setRfp(parts.join("\n"));
      }
    } catch {
      /* keep existing RFP text */
    }
  };

  const readRfpFile = async (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const text = await readUploadedFile(file);
    if (text !== null) setRfp(text);
  };
  const readProposalFile = async (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const text = await readUploadedFile(file);
    if (text !== null) setProposal(text);
  };

  /** Reads .txt files client-side; returns null (after showing an error) for anything else. */
  const readUploadedFile = async (file: File): Promise<string | null> => {
    setFileError("");
    const name = (file.name || "").toLowerCase();
    if (file.type === "text/plain" || name.endsWith(".txt")) {
      try {
        return await file.text();
      } catch {
        setFileError(`Could not read "${file.name}". Please paste the text instead.`);
        return null;
      }
    }
    if (name.endsWith(".pdf")) {
      setFileError(
        "PDF parsing isn't available in this version — export the PDF as text (or copy from the viewer) and paste it into the box above.",
      );
      return null;
    }
    setFileError(`Unsupported file type "${file.name}". Upload .txt files, or paste the text directly.`);
    return null;
  };

  const submit = async () => {
    setError("");
    setFileError("");
    setResult(null);
    if (!rfp.trim() || !proposal.trim()) {
      setError("Paste both the RFP (Section M) and your proposal draft before running the review.");
      return;
    }
    setLoading(true);
    try {
      const res = await runEvaluation({ data: { rfp, proposal } });
      setResult(res);
      window.scrollTo({ top: 0, behavior: "smooth" });
    } catch (e) {
      setError(e instanceof Error ? e.message : "The Red Team review failed. Please try again.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-slate-50">
      <header className="border-b border-slate-200 bg-white">
        <div className="mx-auto flex max-w-6xl items-center justify-between px-4 py-4">
          <a href="/dashboard" className="font-bold text-slate-900">
            ← Dashboard
          </a>
          <div className="flex items-center gap-3">
            <span className="hidden rounded-full bg-slate-900 px-3 py-1 text-xs font-bold text-white sm:inline">
              AGENCY TIER
            </span>
            <span className="font-semibold text-blue-700">Contrax</span>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-6xl px-4 py-10">
        <div className="mb-8">
          <p className="text-sm font-semibold uppercase tracking-wider text-red-600">Independent review · Agency tier</p>
          <h1 className="mt-2 text-3xl font-bold text-slate-900 sm:text-4xl">🔴 Red Team</h1>
          <p className="mt-3 max-w-2xl text-slate-600">
            AI-powered proposal auditing — find the holes before the government does. An independent
            evaluator reads your draft as if they were the source-selection board, scoring every Section
            M factor and flagging compliance risks, missing elements, and weak arguments.
          </p>
        </div>

        {/* ── Input section ── */}
        <div className="grid gap-6 lg:grid-cols-2">
          <section className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
            <div className="flex items-center justify-between">
              <h2 className="text-lg font-bold text-slate-900">1. RFP / solicitation</h2>
              <span className="text-xs text-slate-400">Section M if available</span>
            </div>
            <select
              className="mt-4 w-full rounded-lg border border-slate-300 bg-white p-3 text-sm text-slate-800 focus:border-blue-500 focus:ring-2 focus:ring-blue-100"
              value={selectedBid}
              onChange={(e) => selectBid(e.target.value)}
            >
              <option value="">Select a tracked bid (optional)</option>
              {bids.map((b) => (
                <option key={b.bid_id} value={b.bid_id}>
                  {b.bid_title} — {b.agency}
                </option>
              ))}
            </select>
            {selectedBid && (
              <p className="mt-2 text-xs text-slate-500">
                Loaded bid details into the RFP box — replace with the full Section M text for the most
                accurate review.
              </p>
            )}
            <textarea
              value={rfp}
              onChange={(e) => setRfp(e.target.value)}
              rows={13}
              placeholder="Paste the RFP here — the full Section M evaluation criteria are ideal (criterion names, points, and any 'shall' requirements)."
              className="mt-3 w-full rounded-lg border border-slate-300 p-3 text-sm focus:border-blue-500 focus:ring-2 focus:ring-blue-100"
            />
            <label className="mt-3 inline-flex cursor-pointer items-center gap-2 rounded-lg border border-slate-300 px-3 py-2 text-sm font-medium text-slate-600 hover:bg-slate-50">
              📄 Upload RFP (.txt)
              <input type="file" accept=".txt,.pdf" onChange={readRfpFile} className="hidden" />
            </label>
          </section>

          <section className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
            <h2 className="text-lg font-bold text-slate-900">2. Proposal draft</h2>
            <textarea
              value={proposal}
              onChange={(e) => setProposal(e.target.value)}
              rows={13}
              placeholder="Paste your proposal draft here — the full technical volume if you have it."
              className="mt-4 w-full rounded-lg border border-slate-300 p-3 text-sm focus:border-blue-500 focus:ring-2 focus:ring-blue-100"
            />
            <label className="mt-3 inline-flex cursor-pointer items-center gap-2 rounded-lg border border-slate-300 px-3 py-2 text-sm font-medium text-slate-600 hover:bg-slate-50">
              📄 Upload proposal (.txt)
              <input type="file" accept=".txt,.pdf" onChange={readProposalFile} className="hidden" />
            </label>
            <p className="mt-3 text-xs text-slate-400">
              .txt files are read automatically. PDFs must be pasted as text in this version.
            </p>
          </section>
        </div>

        {(error || fileError) && (
          <p className="mt-3 rounded-lg bg-red-50 p-3 text-sm text-red-700">{error || fileError}</p>
        )}

        <button
          disabled={loading}
          onClick={submit}
          className="mt-6 w-full rounded-xl bg-red-600 px-6 py-4 font-bold text-white shadow-sm transition hover:bg-red-700 disabled:cursor-wait disabled:opacity-60"
        >
          {loading ? (
            <span className="flex items-center justify-center gap-3">
              <span className="inline-block h-4 w-4 animate-spin rounded-full border-2 border-white/40 border-t-white" />
              {REVIEW_STEPS[stepIndex]}
            </span>
          ) : (
            "Run Red Team Review →"
          )}
        </button>

        {loading && (
          <div className="mt-4 h-2 overflow-hidden rounded-full bg-slate-200">
            <div
              className="h-full rounded-full bg-red-500 transition-all duration-1000"
              style={{ width: `${((stepIndex + 1) / REVIEW_STEPS.length) * 100}%` }}
            />
          </div>
        )}

        <p className="mt-4 text-xs text-slate-400">
          🤖 AI transparency: Red Team reviews are generated by AI (OpenAI gpt-4o-mini) acting as an
          independent evaluator. They are advisory — always have a human compliance review before
          submission.
        </p>

        {result && <Results result={result} />}
      </main>
    </div>
  );
}

// ── Results ─────────────────────────────────────────────────────────────────
function scoreColor(score: number): { text: string; bar: string; ring: string } {
  if (score >= 75) return { text: "text-green-600", bar: "bg-green-500", ring: "border-green-200 bg-green-50" };
  if (score >= 50) return { text: "text-amber-600", bar: "bg-amber-500", ring: "border-amber-200 bg-amber-50" };
  return { text: "text-red-600", bar: "bg-red-500", ring: "border-red-200 bg-red-50" };
}

function statusTone(status: CriterionStatus): string {
  switch (status) {
    case "strong":
      return "bg-green-100 text-green-800";
    case "adequate":
      return "bg-amber-100 text-amber-800";
    case "missing":
      return "bg-slate-200 text-slate-700";
    default:
      return "bg-red-100 text-red-700";
  }
}
const STATUS_ICON: Record<CriterionStatus, string> = {
  strong: "🟢",
  adequate: "🟡",
  weak: "🟠",
  missing: "⚪",
};

const DECISION_STYLE: Record<RedTeamDecision, { banner: string; label: string; icon: string }> = {
  GO: { banner: "border-green-300 bg-green-50", label: "Go", icon: "✅" },
  "NO-GO": { banner: "border-red-300 bg-red-50", label: "No-Go", icon: "⛔" },
  "FIX-AND-RESUBMIT": { banner: "border-amber-300 bg-amber-50", label: "Fix and Resubmit", icon: "🔧" },
};

const IMPACT_TONE: Record<RecommendationImpact, string> = {
  high: "bg-red-100 text-red-700",
  medium: "bg-amber-100 text-amber-800",
  low: "bg-slate-100 text-slate-600",
};

function Results({ result: r }: { result: ProposalEvaluation }) {
  const colors = scoreColor(r.overallScore);
  const decision = DECISION_STYLE[r.recommendation] ?? DECISION_STYLE["FIX-AND-RESUBMIT"];
  const sortedRecs = [...r.recommendations].sort((a, b) => {
    const rank = { high: 0, medium: 1, low: 2 } as const;
    return rank[a.impact] - rank[b.impact];
  });

  return (
    <div className="mt-10 space-y-6">
      {/* ── Verdict banner ── */}
      <section className={`rounded-2xl border-2 p-6 shadow-sm ${decision.banner}`}>
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div>
            <p className="text-sm font-semibold uppercase tracking-wider text-slate-500">
              Red Team recommendation
            </p>
            <h2 className="mt-1 text-2xl font-extrabold text-slate-900">
              {decision.icon} {decision.label}
            </h2>
          </div>
          <div className="text-right">
            <p className="text-sm text-slate-500">Overall Red Team Score</p>
            <p className={`text-5xl font-extrabold ${colors.text}`}>
              {r.overallScore}
              <span className="text-xl font-semibold text-slate-400">/100</span>
            </p>
          </div>
        </div>
        {r.recommendationRationale && (
          <p className="mt-4 text-sm leading-relaxed text-slate-700">{r.recommendationRationale}</p>
        )}
        {r.summary && (
          <p className="mt-3 border-t border-slate-200 pt-3 text-sm italic leading-relaxed text-slate-600">
            {r.summary}
          </p>
        )}
      </section>

      {/* ── Export ── */}
      <div className="flex justify-end">
        <ExportReportButton result={r} />
      </div>

      {/* ── Section M criteria breakdown ── */}
      <section className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
        <div className="flex items-center justify-between">
          <h2 className="text-xl font-bold text-slate-900">Section M breakdown</h2>
          <span className="text-xs text-slate-400">{r.criteria.length} evaluation factor{r.criteria.length === 1 ? "" : "s"}</span>
        </div>
        {r.criteria.length ? (
          <div className="mt-4 space-y-4">
            {r.criteria.map((c, i) => {
              const cColors = scoreColor(c.score);
              return (
                <div key={i} className="rounded-xl border border-slate-100 p-4">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <b className="text-slate-900">
                      {STATUS_ICON[c.status]} {c.name}
                    </b>
                    <div className="flex items-center gap-2">
                      {c.maxScore > 0 && (
                        <span className="text-xs text-slate-400">worth {c.maxScore} pts</span>
                      )}
                      <span className={`rounded-full px-2 py-1 text-xs font-bold ${statusTone(c.status)}`}>
                        {c.score}/100 · {c.status}
                      </span>
                    </div>
                  </div>
                  <div className="mt-3 h-2 overflow-hidden rounded-full bg-slate-100">
                    <div
                      className={`h-full rounded-full ${cColors.bar}`}
                      style={{ width: `${c.score}%` }}
                    />
                  </div>
                  {c.feedback && <p className="mt-3 text-sm leading-relaxed text-slate-600">{c.feedback}</p>}
                </div>
              );
            })}
          </div>
        ) : (
          <p className="mt-4 text-sm text-slate-500">
            No criteria were extracted — the RFP text may not include Section M. Add it for a full
            factor-by-factor review.
          </p>
        )}
      </section>

      {/* ── Missing elements ── */}
      <Collapsible
        title="Missing elements"
        badge={r.missingElements.length}
        badgeClass="bg-red-100 text-red-700"
        empty="No missing elements identified — every explicit requirement appears addressed."
      >
        <ul className="space-y-2">
          {r.missingElements.map((m, i) => (
            <li key={i} className="flex gap-2 text-sm leading-relaxed text-slate-700">
              <span className="mt-0.5 shrink-0 text-red-500">✕</span>
              {m}
            </li>
          ))}
        </ul>
      </Collapsible>

      {/* ── Compliance risks ── */}
      <Collapsible
        title="Compliance risks"
        badge={r.complianceRisks.length}
        badgeClass="bg-amber-100 text-amber-800"
        empty="No compliance risks flagged."
      >
        <ul className="space-y-3">
          {r.complianceRisks.map((risk, i) => (
            <li key={i} className="rounded-lg border border-amber-100 bg-amber-50/50 p-3">
              <p className="text-sm leading-relaxed text-slate-700">{risk.description}</p>
              {(risk.farClause || risk.clauseTitle) && (
                <p className="mt-2 flex flex-wrap items-center gap-2 text-xs">
                  {risk.farClause && (
                    <span className="rounded bg-slate-900 px-2 py-0.5 font-mono font-bold text-white">
                      {risk.farClause}
                    </span>
                  )}
                  {risk.clauseTitle && <span className="font-semibold text-slate-500">{risk.clauseTitle}</span>}
                </p>
              )}
            </li>
          ))}
        </ul>
      </Collapsible>

      {/* ── Weak arguments ── */}
      <Collapsible
        title="Weak arguments"
        badge={r.weakArguments.length}
        badgeClass="bg-red-100 text-red-700"
        empty="No weak arguments flagged — claims are specific and evidenced."
      >
        <ul className="space-y-2">
          {r.weakArguments.map((w, i) => (
            <li key={i} className="flex gap-2 text-sm leading-relaxed text-slate-700">
              <span className="mt-0.5 shrink-0 text-amber-500">⚠</span>
              {w}
            </li>
          ))}
        </ul>
      </Collapsible>

      {/* ── Recommendations ── */}
      <Collapsible
        title="Actionable recommendations"
        badge={sortedRecs.length}
        badgeClass="bg-blue-100 text-blue-800"
        empty="No recommendations — this draft is ready."
        defaultOpen
      >
        <ol className="space-y-3">
          {sortedRecs.map((rec, i) => (
            <li key={i} className="flex items-start gap-3 rounded-lg border border-slate-100 p-3">
              <span className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-slate-900 text-xs font-bold text-white">
                {i + 1}
              </span>
              <div className="min-w-0">
                <p className="text-sm leading-relaxed text-slate-700">{rec.action}</p>
                <span
                  className={`mt-1.5 inline-block rounded-full px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide ${IMPACT_TONE[rec.impact] ?? IMPACT_TONE.medium}`}
                >
                  {rec.impact} impact
                </span>
              </div>
            </li>
          ))}
        </ol>
      </Collapsible>

      <p className="text-center text-xs text-slate-400">
        Generated {new Date(r.generatedAt).toLocaleString()} · Contrax Red Team · advisory — not legal or
        contracting advice.
      </p>
    </div>
  );
}

function Collapsible({
  title,
  badge,
  badgeClass,
  empty,
  children,
  defaultOpen = false,
}: {
  title: string;
  badge: number;
  badgeClass: string;
  empty: string;
  children: ReactNode;
  defaultOpen?: boolean;
}) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <section className="rounded-2xl border border-slate-200 bg-white shadow-sm">
      <button
        onClick={() => setOpen((o) => !o)}
        className="flex w-full items-center justify-between gap-3 p-6 text-left"
        aria-expanded={open}
      >
        <span className="flex items-center gap-3">
          <h2 className="text-xl font-bold text-slate-900">{title}</h2>
          <span className={`rounded-full px-2 py-0.5 text-xs font-bold ${badgeClass}`}>{badge}</span>
        </span>
        <span className={`shrink-0 text-slate-400 transition-transform ${open ? "rotate-180" : ""}`}>▼</span>
      </button>
      {open && (
        <div className="border-t border-slate-100 p-6 pt-4">
          {badge > 0 ? children : <p className="text-sm text-slate-500">{empty}</p>}
        </div>
      )}
    </section>
  );
}

// ── PDF export (client-side, jsPDF lazy-loaded) ─────────────────────────────
function ExportReportButton({ result: r }: { result: ProposalEvaluation }) {
  const [busy, setBusy] = useState(false);
  const exportPdf = async () => {
    setBusy(true);
    try {
      const { jsPDF } = await import("jspdf");
      const doc = new jsPDF({ unit: "pt", format: "letter" });
      const pageW = 612;
      const pageH = 792;
      let y = 60;

      const ensure = (needed: number) => {
        if (y + needed > pageH - 60) {
          doc.addPage();
          y = 60;
        }
      };
      const write = (text: string, size: number, color: [number, number, number], bold = false) => {
        doc.setFontSize(size);
        doc.setTextColor(color[0], color[1], color[2]);
        doc.setFont("helvetica", bold ? "bold" : "normal");
        const lines = doc.splitTextToSize(text, pageW - 100);
        for (const line of lines) {
          ensure(14);
          doc.text(line, 50, y);
          y += size * 1.35;
        }
      };
      const heading = (text: string) => {
        ensure(24);
        y += 8;
        doc.setFontSize(12);
        doc.setTextColor(185, 28, 28);
        doc.setFont("helvetica", "bold");
        doc.text(text, 50, y);
        y += 16;
        doc.setDrawColor(220, 220, 225);
        doc.line(50, y, pageW - 50, y);
        y += 12;
      };

      // Title block
      doc.setFontSize(22);
      doc.setTextColor(15, 23, 42);
      doc.setFont("helvetica", "bold");
      doc.text("Red Team Proposal Audit", 50, y);
      y += 22;
      doc.setFontSize(11);
      doc.setTextColor(100, 116, 139);
      doc.setFont("helvetica", "normal");
      doc.text("Contrax — AI-powered proposal auditing", 50, y);
      y += 16;
      doc.text(`Generated ${new Date(r.generatedAt).toLocaleString()}`, 50, y);
      y += 24;
      doc.setDrawColor(200, 205, 210);
      doc.line(50, y, pageW - 50, y);
      y += 24;

      // Verdict + score
      doc.setFontSize(13);
      doc.setTextColor(15, 23, 42);
      doc.setFont("helvetica", "bold");
      doc.text(`Recommendation: ${r.recommendation.replace(/-/g, " ")}`, 50, y);
      y += 16;
      doc.setFontSize(16);
      doc.setTextColor(185, 28, 28);
      doc.setFont("helvetica", "bold");
      doc.text(`Overall Red Team Score: ${r.overallScore}/100`, 50, y);
      y += 20;
      if (r.recommendationRationale) {
        doc.setFontSize(10);
        doc.setTextColor(51, 65, 85);
        doc.setFont("helvetica", "normal");
        const rationale = doc.splitTextToSize(r.recommendationRationale, pageW - 100);
        for (const line of rationale) {
          ensure(14);
          doc.text(line, 50, y);
          y += 14;
        }
      }
      if (r.summary) {
        y += 4;
        doc.setFontSize(10);
        doc.setTextColor(100, 116, 139);
        doc.setFont("helvetica", "italic");
        const summary = doc.splitTextToSize(r.summary, pageW - 100);
        for (const line of summary) {
          ensure(14);
          doc.text(line, 50, y);
          y += 14;
        }
      }
      y += 8;

      // Criteria
      heading("Section M Criteria Breakdown");
      for (const c of r.criteria) {
        ensure(30);
        doc.setFontSize(10.5);
        doc.setTextColor(15, 23, 42);
        doc.setFont("helvetica", "bold");
        doc.text(`${c.name} — ${c.score}/100 (${c.status})`, 50, y);
        y += 14;
        doc.setFontSize(9.5);
        doc.setTextColor(71, 85, 105);
        doc.setFont("helvetica", "normal");
        const feedback = doc.splitTextToSize(c.feedback || "(no feedback)", pageW - 100);
        for (const line of feedback) {
          ensure(14);
          doc.text(line, 50, y);
          y += 13;
        }
        y += 6;
      }

      const listBlock = (title: string, items: string[]) => {
        heading(title);
        if (!items.length) {
          write("None identified.", 10, [100, 116, 139]);
          y += 6;
          return;
        }
        items.forEach((item, i) => {
          ensure(20);
          doc.setFontSize(10);
          doc.setTextColor(51, 65, 85);
          doc.setFont("helvetica", "normal");
          const wrapped = doc.splitTextToSize(`${i + 1}. ${item}`, pageW - 110);
          doc.text(`•`, 56, y);
          doc.text(wrapped, 68, y);
          y += wrapped.length * 13 + 4;
        });
      };

      listBlock("Missing Elements", r.missingElements);
      listBlock(
        "Compliance Risks",
        r.complianceRisks.map(
          (risk) =>
            `${risk.description}${risk.farClause ? ` [${risk.farClause}${risk.clauseTitle ? " — " + risk.clauseTitle : ""}]` : ""}`,
        ),
      );
      listBlock("Weak Arguments", r.weakArguments);
      listBlock(
        "Actionable Recommendations",
        r.recommendations.map((rec) => `[${rec.impact} impact] ${rec.action}`),
      );

      // Footer on all pages
      const pageCount = doc.getNumberOfPages();
      for (let i = 1; i <= pageCount; i++) {
        doc.setPage(i);
        doc.setFontSize(9);
        doc.setTextColor(115, 120, 135);
        doc.setFont("helvetica", "normal");
        doc.text("Contrax Red Team — advisory, not legal or contracting advice", 50, pageH - 30);
        doc.text(`Page ${i} of ${pageCount}`, pageW - 90, pageH - 30);
      }

      const blob = doc.output("blob");
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `red-team-report-${new Date().toISOString().slice(0, 10)}.pdf`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    } catch {
      alert("Could not generate the PDF — please try again.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <button
      onClick={exportPdf}
      disabled={busy}
      className="inline-flex items-center gap-2 rounded-xl border border-slate-300 bg-white px-5 py-2.5 text-sm font-semibold text-slate-700 shadow-sm transition hover:bg-slate-50 disabled:cursor-wait disabled:opacity-60"
    >
      {busy ? "⏳ Generating…" : "⬇ Export Red Team Report (PDF)"}
    </button>
  );
}
