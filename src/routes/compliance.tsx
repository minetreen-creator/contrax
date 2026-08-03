import { createFileRoute, redirect } from "@tanstack/react-router";
import { createServerFn } from "@tanstack/react-start";
import { useState, useCallback, useEffect } from "react";
import { sql } from "~/db";
import { getCurrentUser } from "~/lib/auth";
import { TrialGate } from "~/components/TrialGate";
import { detectCredentialRequirements, licenseMatches, daysUntilExpiry, type License } from "~/lib/healthcare";

// ── Types ────────────────────────────────────────────────────────────────────
interface ComplianceIssue {
  severity: "CRITICAL" | "HIGH" | "MEDIUM" | "LOW";
  requirement: string;
  finding: string;
  recommendation: string;
}
interface ComplianceResult {
  id: number;
  user_email: string;
  bid_title: string | null;
  compliance_score: number;
  issues: ComplianceIssue[];
  pass_count: number;
  fail_count: number;
  warning_count: number;
  summary: string;
  created_at: string;
}
interface CheckResult {
  result: ComplianceResult;
}
interface LicenseProfile {
  licenses: License[];
  requiredCredentials: string[];
}

// ── DB helpers ────────────────────────────────────────────────────────────────
async function ensureTable() {
  await sql()`CREATE TABLE IF NOT EXISTS compliance_checks (id SERIAL PRIMARY KEY, user_email TEXT NOT NULL, bid_title TEXT, rfp_text TEXT NOT NULL, proposal_text TEXT NOT NULL, compliance_score INTEGER NOT NULL DEFAULT 0, issues JSONB DEFAULT '[]'::jsonb, pass_count INTEGER DEFAULT 0, fail_count INTEGER DEFAULT 0, warning_count INTEGER DEFAULT 0, summary TEXT DEFAULT '', created_at TIMESTAMPTZ DEFAULT NOW())`;
  for (const c of ["bid_title TEXT", "issues JSONB DEFAULT '[]'::jsonb", "pass_count INTEGER DEFAULT 0", "fail_count INTEGER DEFAULT 0", "warning_count INTEGER DEFAULT 0", "summary TEXT DEFAULT ''"]) {
    try { await sql.unsafe(`ALTER TABLE compliance_checks ADD COLUMN IF NOT EXISTS ${c}`); } catch {}
  }
}

function mapResult(r: any): ComplianceResult {
  return {
    id: Number(r.id),
    user_email: String(r.user_email),
    bid_title: r.bid_title ? String(r.bid_title) : null,
    compliance_score: Number(r.compliance_score),
    issues: Array.isArray(r.issues) ? r.issues : [],
    pass_count: Number(r.pass_count || 0),
    fail_count: Number(r.fail_count || 0),
    warning_count: Number(r.warning_count || 0),
    summary: String(r.summary || ""),
    created_at: String(r.created_at),
  };
}

// ── Server Functions ──────────────────────────────────────────────────────────

const getHistory = createServerFn({ method: "GET" }).handler(async (): Promise<ComplianceResult[]> => {
  const user = await getCurrentUser(); if (!user) throw new Error("Not authenticated");
  await ensureTable();
  const rows = await sql()`SELECT * FROM compliance_checks WHERE user_email = ${user.email} ORDER BY created_at DESC LIMIT 30`;
  return (rows as any[]).map(mapResult);
});

const getBidContext = createServerFn({ method: "GET" }).handler(async ({ data }: { data: { bidId: number } }) => {
  const user = await getCurrentUser(); if (!user) throw new Error("Not authenticated");
  const bids = await sql()`SELECT title, description FROM bids WHERE id = ${data.bidId}`;
  if (!bids.length) return { bidTitle: null, bidDescription: null, proposalText: null };
  const bid = bids[0] as any;
  const drafts = await sql()`SELECT draft_text FROM proposal_drafts WHERE bid_id = ${data.bidId} AND user_id = ${user.id}`;
  return {
    bidTitle: String(bid.title),
    bidDescription: bid.description ? String(bid.description) : null,
    proposalText: drafts.length > 0 ? String(drafts[0].draft_text) : null,
  };
});

const getLicenseProfile = createServerFn({ method: "GET" }).handler(async (): Promise<LicenseProfile> => {
  const user = await getCurrentUser(); if (!user) return { licenses: [], requiredCredentials: [] };
  try {
    await sql()`ALTER TABLE business_profiles ADD COLUMN IF NOT EXISTS licenses JSONB DEFAULT '[]'::jsonb`;
    const rows = await sql()`SELECT licenses FROM business_profiles WHERE user_id = ${user.id} LIMIT 1`;
    const licenses = rows.length && Array.isArray((rows[0] as any).licenses) ? (rows[0] as any).licenses : [];
    return { licenses, requiredCredentials: [] };
  } catch {
    return { licenses: [], requiredCredentials: [] };
  }
});

export const checkCompliance = createServerFn({ method: "POST" })
  .validator((d: unknown) => d as { rfpText: string; proposalText: string; bidTitle?: string })
  .handler(async ({ data }): Promise<CheckResult> => {
    const user = await getCurrentUser(); if (!user) throw new Error("Not authenticated");
    await ensureTable();

    if (!data.rfpText || !data.rfpText.trim()) throw new Error("RFP text is required");
    if (!data.proposalText || !data.proposalText.trim()) throw new Error("Proposal draft text is required");

    const prompt = `You are a government contract compliance expert. Your job is to compare a proposal draft against an RFP/solicitation and identify every compliance issue.

Review the RFP and identify ALL explicit requirements: required sections, formatting rules, certifications, page limits, submission instructions, evaluation criteria, required attachments, and any other mandatory elements.

Then check the proposal against each requirement and flag every gap.

For each issue, return an object with:
- severity: "CRITICAL" (missing mandatory section, would cause automatic rejection), "HIGH" (format violation, page limit exceeded, missing signature), "MEDIUM" (weakly addressed evaluation criterion), "LOW" (minor improvement suggestion)
- requirement: the exact RFP requirement text you're checking against
- finding: what's wrong with the proposal regarding this requirement
- recommendation: specific actionable fix

Also provide:
- complianceScore: integer 0-100 where 100 means fully compliant
- summary: a paragraph summarizing overall compliance and top risks
- passCount: number of requirements that are met
- failCount: number of critical and high issues
- warningCount: number of medium and low issues

Return ONLY valid JSON, no markdown:
{"complianceScore": number, "summary": "string", "passCount": number, "failCount": number, "warningCount": number, "issues": [{ "severity": "CRITICAL"|"HIGH"|"MEDIUM"|"LOW", "requirement": "string", "finding": "string", "recommendation": "string" }]}

RFP / SOLICITATION TEXT:
---
${data.rfpText.substring(0, 8000)}
---

PROPOSAL DRAFT:
---
${data.proposalText.substring(0, 8000)}
---`;

    let parsed: any;
    try {
      const key = process.env.OPENAI_API_KEY; if (!key) throw new Error("OpenAI API key not configured");
      const res = await fetch("https://api.openai.com/v1/chat/completions", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${key}` },
        body: JSON.stringify({ model: "gpt-4o-mini", messages: [{ role: "user", content: prompt }], max_tokens: 3000, temperature: 0.2 }),
      });
      if (!res.ok) throw new Error(`OpenAI API error (${res.status})`);
      const j = await res.json() as any;
      const m = j.choices?.[0]?.message?.content?.match(/\{[\s\S]*\}/);
      if (!m) throw new Error("Could not parse AI response");
      parsed = JSON.parse(m[0]);
    } catch (e) {
      throw new Error(`Compliance check failed: ${e instanceof Error ? e.message : "AI request failed"}`);
    }

    const score = Math.max(0, Math.min(100, Math.round(Number(parsed.complianceScore) || 0)));
    const issues: ComplianceIssue[] = (Array.isArray(parsed.issues) ? parsed.issues : []).slice(0, 20).map((i: any) => ({
      severity: ["CRITICAL", "HIGH", "MEDIUM", "LOW"].includes(i.severity) ? i.severity : "MEDIUM",
      requirement: String(i.requirement || "Requirement not specified"),
      finding: String(i.finding || "No finding provided"),
      recommendation: String(i.recommendation || "Review and address this gap."),
    }));

    let passCount = Math.max(0, Number(parsed.passCount) || 0);
    let failCount = Math.max(0, Number(parsed.failCount) || issues.filter(i => i.severity === "CRITICAL" || i.severity === "HIGH").length);
    let warningCount = Math.max(0, Number(parsed.warningCount) || issues.filter(i => i.severity === "MEDIUM" || i.severity === "LOW").length);
    let summary = String(parsed.summary || "Compliance analysis complete. Review the flagged issues below.");

    // ── License & credential gap check ─────────────────────────────────────
    // Cross-reference credentials the solicitation requires against the user's
    // stored licenses and flag gaps / expirations.
    const licenseIssues: ComplianceIssue[] = [];
    try {
      await sql()`ALTER TABLE business_profiles ADD COLUMN IF NOT EXISTS licenses JSONB DEFAULT '[]'::jsonb`;
      const lrows = await sql()`SELECT licenses FROM business_profiles WHERE user_id = ${user.id} LIMIT 1`;
      const licenses: License[] = lrows.length && Array.isArray((lrows[0] as any).licenses) ? (lrows[0] as any).licenses : [];
      const required = detectCredentialRequirements(data.rfpText);
      for (const req of required) {
        const match = licenses.find((l) => licenseMatches(l, req));
        if (!match) {
          licenseIssues.push({
            severity: "HIGH",
            requirement: `Credential requirement: ${req}`,
            finding: `⚠️ This RFP requires ${req} — not found in your profile's licenses`,
            recommendation: `Add ${req} to your Licenses & Credentials in Settings, or obtain it before bidding.`,
          });
        } else if (match.expires) {
          const days = daysUntilExpiry(match.expires);
          if (days !== null && days < 0) {
            licenseIssues.push({
              severity: "HIGH",
              requirement: `Credential requirement: ${req}`,
              finding: `⚠️ Your stored ${req} expired on ${String(match.expires).slice(0, 10)}`,
              recommendation: `Renew ${req} before submitting — an expired credential can disqualify your proposal.`,
            });
          } else if (days !== null && days <= 90) {
            licenseIssues.push({
              severity: "MEDIUM",
              requirement: `Credential requirement: ${req}`,
              finding: `Your stored ${req} expires in ${days} day${days === 1 ? "" : "s"} (${String(match.expires).slice(0, 10)})`,
              recommendation: `Renew ${req} before it lapses to stay compliant for this contract.`,
            });
          }
        }
      }
    } catch { /* licenses column may not exist on older databases — skip gap check */ }

    if (licenseIssues.length > 0) {
      issues.unshift(...licenseIssues);
      for (const li of licenseIssues) {
        if (li.severity === "CRITICAL" || li.severity === "HIGH") failCount += 1;
        else if (li.severity === "MEDIUM" || li.severity === "LOW") warningCount += 1;
      }
      summary = summary + " License gap check found " + licenseIssues.length + " credential issue" + (licenseIssues.length === 1 ? "" : "s") + " (see flagged items).";
    }

    const insert = await sql()`INSERT INTO compliance_checks (user_email, bid_title, rfp_text, proposal_text, compliance_score, issues, pass_count, fail_count, warning_count, summary) VALUES (${user.email}, ${data.bidTitle || null}, ${data.rfpText}, ${data.proposalText}, ${score}, ${JSON.stringify(issues)}::jsonb, ${passCount}, ${failCount}, ${warningCount}, ${summary}) RETURNING *`;
    return { result: mapResult(insert[0]) };
  });

// ── Route ────────────────────────────────────────────────────────────────────
export const Route = createFileRoute("/compliance")({
  loader: async () => {
    const user = await getCurrentUser();
    if (!user) throw redirect({ to: "/login" });
    return getHistory();
  },
  component: CompliancePageGated,
  head: () => ({ meta: [{ title: "Compliance Checker | Contrax" }, { name: "description", content: "Check your proposal against RFP requirements with AI-powered compliance scanning." }] }),
});

/** Trial gate: expired-trial users see an upgrade prompt instead of the page. */
function CompliancePageGated() {
  return (
    <TrialGate>
      <CompliancePage />
    </TrialGate>
  );
}


// ── Helpers ──────────────────────────────────────────────────────────────────
const severityStyles: Record<string, string> = {
  CRITICAL: "bg-red-100 text-red-700 border-red-200",
  HIGH: "bg-orange-100 text-orange-700 border-orange-200",
  MEDIUM: "bg-amber-100 text-amber-700 border-amber-200",
  LOW: "bg-blue-100 text-blue-700 border-blue-200",
};
const severityBadge = (s: string) => severityStyles[s] || "bg-slate-100 text-slate-600";
const severityOrder: Record<string, number> = { CRITICAL: 0, HIGH: 1, MEDIUM: 2, LOW: 3 };

function ScoreCard({ score, passCount, failCount, warningCount }: { score: number; passCount: number; failCount: number; warningCount: number }) {
  const color = score >= 80 ? "text-green-600" : score >= 50 ? "text-amber-600" : "text-red-600";
  const bg = score >= 80 ? "border-green-200 bg-gradient-to-br from-green-50 to-white" : score >= 50 ? "border-amber-200 bg-gradient-to-br from-amber-50 to-white" : "border-red-200 bg-gradient-to-br from-red-50 to-white";
  return (
    <div className={`rounded-2xl border ${bg} p-6 shadow-sm`}>
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Compliance Score</p>
          <p className={`mt-1 text-5xl font-bold ${color}`}>{score}<span className="text-2xl">/100</span></p>
        </div>
        <div className="flex flex-wrap gap-3">
          <div className="rounded-xl bg-green-100 px-4 py-3 text-center">
            <p className="text-2xl font-bold text-green-700">{passCount}</p>
            <p className="text-xs font-semibold text-green-600 uppercase">Passed</p>
          </div>
          <div className="rounded-xl bg-red-100 px-4 py-3 text-center">
            <p className="text-2xl font-bold text-red-700">{failCount}</p>
            <p className="text-xs font-semibold text-red-600 uppercase">Failed</p>
          </div>
          <div className="rounded-xl bg-amber-100 px-4 py-3 text-center">
            <p className="text-2xl font-bold text-amber-700">{warningCount}</p>
            <p className="text-xs font-semibold text-amber-600 uppercase">Warnings</p>
          </div>
        </div>
      </div>
    </div>
  );
}

function IssuesList({ issues }: { issues: ComplianceIssue[] }) {
  const grouped = issues.reduce((acc, issue) => {
    const sev = issue.severity;
    if (!acc[sev]) acc[sev] = [];
    acc[sev].push(issue);
    return acc;
  }, {} as Record<string, ComplianceIssue[]>);

  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({});

  const toggle = (sev: string) => setCollapsed(p => ({ ...p, [sev]: !p[sev] }));

  const sevLabels: Record<string, string> = {
    CRITICAL: "Critical — Will Cause Rejection",
    HIGH: "High — Major Violations",
    MEDIUM: "Medium — Needs Improvement",
    LOW: "Low — Minor Suggestions",
  };

  const sorted: string[] = Object.keys(grouped).sort((a, b) => (severityOrder[a] ?? 99) - (severityOrder[b] ?? 99));

  return (
    <div className="space-y-4">
      {sorted.map(sev => {
        const items = grouped[sev];
        const isCollapsed = collapsed[sev] ?? false;
        const styles = severityStyles[sev] || "bg-slate-100 text-slate-700";
        return (
          <div key={sev} className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
            <button type="button" onClick={() => toggle(sev)} className={`flex w-full items-center justify-between px-5 py-4 text-left ${sev === "CRITICAL" ? "bg-red-50" : sev === "HIGH" ? "bg-orange-50" : sev === "MEDIUM" ? "bg-amber-50" : "bg-blue-50"}`}>
              <div className="flex items-center gap-3">
                <span className={`inline-flex rounded-full px-2.5 py-1 text-xs font-bold uppercase ${styles}`}>{sev}</span>
                <span className="font-semibold text-slate-900">{sevLabels[sev] || sev}</span>
                <span className="text-sm text-slate-500">{items.length} issue{items.length !== 1 ? "s" : ""}</span>
              </div>
              <svg className={`h-5 w-5 text-slate-400 transition-transform ${isCollapsed ? "" : "rotate-180"}`} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" /></svg>
            </button>
            {!isCollapsed && (
              <div className="divide-y divide-slate-100">
                {items.map((issue, idx) => (
                  <div key={idx} className="px-5 py-4">
                    <div className="mb-2 rounded-lg border border-slate-200 bg-slate-50 p-3">
                      <p className="text-xs font-semibold uppercase tracking-wide text-slate-400">RFP Requirement</p>
                      <p className="mt-1 text-sm text-slate-700 leading-relaxed">{issue.requirement}</p>
                    </div>
                    <div className="mb-2 rounded-lg border border-red-100 bg-red-50/50 p-3">
                      <p className="text-xs font-semibold uppercase tracking-wide text-red-500">Finding</p>
                      <p className="mt-1 text-sm text-slate-700 leading-relaxed">{issue.finding}</p>
                    </div>
                    <div className="rounded-lg border border-green-100 bg-green-50/50 p-3">
                      <p className="text-xs font-semibold uppercase tracking-wide text-green-600">Recommendation</p>
                      <p className="mt-1 text-sm text-slate-700 leading-relaxed">{issue.recommendation}</p>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

// ── Component ────────────────────────────────────────────────────────────────
function CompliancePage() {
  const history = Route.useLoaderData() as ComplianceResult[];
  const [results, setResults] = useState<ComplianceResult | null>(null);
  const [allHistory, setAllHistory] = useState<ComplianceResult[]>(history);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [form, setForm] = useState({ rfpText: "", proposalText: "", bidTitle: "" });
  const [loadingContext, setLoadingContext] = useState(false);
  const [contextBidTitle, setContextBidTitle] = useState<string | null>(null);
  const [licenseProfile, setLicenseProfile] = useState<License[] | null>(null);

  // On mount, load the user's stored licenses for the gap check
  useEffect(() => {
    getLicenseProfile().then((lp) => setLicenseProfile(lp.licenses)).catch(() => {});
  }, []);

  // On mount, check for ?bid_id=X query param
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const bidId = params.get("bid_id");
    if (bidId) {
      setLoadingContext(true);
      getBidContext({ data: { bidId: Number(bidId) } })
        .then((ctx) => {
          setForm({
            rfpText: ctx.bidDescription || "",
            proposalText: ctx.proposalText || "",
            bidTitle: ctx.bidTitle || "",
          });
          if (ctx.bidTitle) setContextBidTitle(ctx.bidTitle);
        })
        .catch(() => {})
        .finally(() => setLoadingContext(false));
    }
  }, []);

  const submit = useCallback(async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError("");
    try {
      const r = await checkCompliance({ data: form });
      setResults(r.result);
      setAllHistory(prev => [r.result, ...prev]);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Compliance check failed");
    } finally {
      setBusy(false);
    }
  }, [form]);

  const loadHistoryItem = useCallback((item: ComplianceResult) => {
    setResults(item);
    // Scroll to results
    setTimeout(() => {
      document.getElementById("results-section")?.scrollIntoView({ behavior: "smooth" });
    }, 100);
  }, []);

  return (
    <div className="min-h-screen bg-slate-50">
      {/* Header */}
      <header className="border-b border-slate-200 bg-white sticky top-0 z-10">
        <div className="mx-auto flex max-w-7xl items-center justify-between px-4 py-3">
          <a href="/dashboard" className="inline-flex items-center gap-2">
            <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-slate-900">
              <svg className="h-4 w-4 text-amber-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
            </span>
            <span className="text-lg font-bold tracking-tight text-slate-900">Contrax</span>
          </a>
          <div className="flex items-center gap-4">
            <a href="/dashboard" className="text-sm font-medium text-slate-400 hover:text-slate-600 transition-colors">Dashboard</a>
            <a href="/awards" className="text-sm font-medium text-slate-400 hover:text-slate-600 hidden sm:inline transition-colors">Awards</a>
            <a href="/losses" className="text-sm font-medium text-slate-400 hover:text-slate-600 hidden sm:inline transition-colors">Losses</a>
            <a href="/compliance" className="text-sm font-medium text-amber-600 hidden sm:inline transition-colors">Compliance</a>
            <a href="/partners" className="text-sm font-medium text-slate-400 hover:text-slate-600 hidden sm:inline transition-colors">Partners</a>
            <span className="text-sm text-slate-400 hidden sm:inline">{allHistory.length} check{allHistory.length !== 1 ? "s" : ""}</span>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-7xl px-4 py-8">
        <div className="flex flex-col lg:flex-row gap-8">
          {/* Main content */}
          <div className="flex-1 min-w-0">
            <div className="mb-8">
              <h1 className="text-3xl font-bold text-slate-900">Compliance Checker</h1>
              <p className="mt-2 text-slate-500">Paste an RFP and your proposal draft — AI checks for compliance gaps, missing sections, and evaluation criteria mismatches.</p>
            </div>

            {/* Stored licenses (cross-referenced by the gap check) */}
            {licenseProfile && (
              <div className="mb-6 rounded-2xl border border-teal-200 bg-teal-50/60 px-4 py-3">
                <p className="text-xs font-semibold uppercase tracking-wide text-teal-700 mb-2">
                  Credentials cross-referenced from your profile ({licenseProfile.length})
                </p>
                {licenseProfile.length === 0 ? (
                  <p className="text-xs text-teal-700/70">
                    No licenses stored yet — the license gap check will flag every credential this RFP requires.{" "}
                    <a href="/settings" className="font-semibold underline hover:text-teal-900">Add licenses in Settings →</a>
                  </p>
                ) : (
                  <div className="flex flex-wrap gap-1.5">
                    {licenseProfile.map((lic, i) => {
                      const days = daysUntilExpiry(lic.expires);
                      const expired = days !== null && days < 0;
                      const expiringSoon = days !== null && !expired && days <= 90;
                      return (
                        <span key={i} className={`inline-flex items-center gap-1 rounded-full border px-2.5 py-1 text-xs font-medium ${expired ? "border-red-200 bg-red-50 text-red-700" : expiringSoon ? "border-amber-200 bg-amber-50 text-amber-700" : "border-teal-200 bg-white text-teal-800"}`}>
                          {lic.type}
                          {lic.state ? ` (${lic.state})` : ""}
                          {expired ? <span className="font-bold">● Expired</span> : expiringSoon ? <span className="font-bold">● {days}d left</span> : null}
                        </span>
                      );
                    })}
                  </div>
                )}
              </div>
            )}

            {/* Context banner */}
            {contextBidTitle && (
              <div className="mb-6 rounded-xl border border-blue-200 bg-blue-50 px-4 py-3 text-sm text-blue-800">
                <span className="font-semibold">Pre-filled from bid:</span> {contextBidTitle}
                {loadingContext && <span className="ml-2 text-blue-500">Loading proposal…</span>}
              </div>
            )}

            {/* Form */}
            <form onSubmit={submit} className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm sm:p-6">
              <h2 className="text-lg font-bold text-slate-900">Check your proposal</h2>
              <div className="mt-4 grid gap-4">
                <div>
                  <label className="text-sm font-medium text-slate-700">Bid Title (optional)</label>
                  <input
                    value={form.bidTitle}
                    onChange={e => setForm({ ...form, bidTitle: e.target.value })}
                    placeholder="e.g. IT Support Services RFP"
                    className="mt-1 w-full rounded-xl border border-slate-300 px-3 py-2.5 text-sm outline-none focus:border-amber-500 focus:ring-2 focus:ring-amber-500/20"
                  />
                </div>
                <div className="grid gap-4 lg:grid-cols-2">
                  <div>
                    <label className="text-sm font-medium text-slate-700">RFP / Solicitation Text *</label>
                    <textarea
                      required
                      value={form.rfpText}
                      onChange={e => setForm({ ...form, rfpText: e.target.value })}
                      rows={12}
                      placeholder="Paste the RFP or solicitation document text here…"
                      className="mt-1 w-full rounded-xl border border-slate-300 p-3 text-sm outline-none focus:border-amber-500 focus:ring-2 focus:ring-amber-500/20 resize-y font-mono"
                    />
                  </div>
                  <div>
                    <label className="text-sm font-medium text-slate-700">Your Proposal Draft *</label>
                    <textarea
                      required
                      value={form.proposalText}
                      onChange={e => setForm({ ...form, proposalText: e.target.value })}
                      rows={12}
                      placeholder="Paste your proposal draft text here…"
                      className="mt-1 w-full rounded-xl border border-slate-300 p-3 text-sm outline-none focus:border-amber-500 focus:ring-2 focus:ring-amber-500/20 resize-y font-mono"
                    />
                  </div>
                </div>
              </div>
              {error && <p className="mt-3 text-sm text-red-600">{error}</p>}
              <button
                type="submit"
                disabled={busy}
                className="mt-5 rounded-xl bg-amber-500 px-6 py-3 font-semibold text-slate-900 hover:bg-amber-400 disabled:opacity-50 active:scale-[0.98] transition-all"
              >
                {busy ? (
                  <span className="inline-flex items-center gap-2">
                    <svg className="h-4 w-4 animate-spin" fill="none" viewBox="0 0 24 24"><circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" /><path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" /></svg>
                    Analyzing compliance…
                  </span>
                ) : "Check Compliance →"}
              </button>
            </form>

            {/* Results */}
            <div id="results-section">
              {busy && (
                <div className="mt-8 flex flex-col items-center justify-center py-12">
                  <div className="flex items-center gap-1.5 mb-4">
                    <span className="h-2.5 w-2.5 rounded-full bg-amber-500 animate-bounce" style={{ animationDelay: "0ms" }} />
                    <span className="h-2.5 w-2.5 rounded-full bg-amber-500 animate-bounce" style={{ animationDelay: "150ms" }} />
                    <span className="h-2.5 w-2.5 rounded-full bg-amber-500 animate-bounce" style={{ animationDelay: "300ms" }} />
                  </div>
                  <p className="text-sm font-medium text-slate-600">AI is scanning your proposal against the RFP…</p>
                  <p className="text-xs text-slate-400 mt-1">Checking requirements, format, certifications, and evaluation criteria</p>
                </div>
              )}

              {results && !busy && (
                <div className="mt-8 space-y-6">
                  <ScoreCard score={results.compliance_score} passCount={results.pass_count} failCount={results.fail_count} warningCount={results.warning_count} />

                  {/* Summary */}
                  <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
                    <h3 className="font-semibold text-slate-900 mb-2">AI Summary</h3>
                    <p className="text-sm text-slate-700 leading-relaxed">{results.summary}</p>
                    {results.bid_title && (
                      <p className="mt-3 text-xs text-slate-400">Bid: {results.bid_title} · Checked {new Date(results.created_at).toLocaleString("en-US", { month: "short", day: "numeric", year: "numeric", hour: "numeric", minute: "2-digit" })}</p>
                    )}
                  </div>

                  {/* Issues */}
                  <div>
                    <h3 className="font-semibold text-slate-900 mb-3">Issues Found ({results.issues.length})</h3>
                    {results.issues.length === 0 ? (
                      <div className="rounded-2xl border border-green-200 bg-green-50 p-8 text-center">
                        <p className="text-green-700 font-semibold">No issues found!</p>
                        <p className="text-sm text-green-600 mt-1">Your proposal appears fully compliant with the RFP requirements.</p>
                      </div>
                    ) : (
                      <IssuesList issues={results.issues} />
                    )}
                  </div>
                </div>
              )}
            </div>
          </div>

          {/* History Sidebar */}
          <div className="lg:w-80 shrink-0">
            <div className="lg:sticky lg:top-20">
              <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
                <h3 className="font-semibold text-slate-900 mb-1">History</h3>
                <p className="text-xs text-slate-500 mb-4">Past compliance checks</p>
                {allHistory.length === 0 ? (
                  <p className="text-sm text-slate-400 text-center py-6">No compliance checks yet.</p>
                ) : (
                  <div className="space-y-2 max-h-[500px] overflow-y-auto">
                    {allHistory.map((item) => {
                      const scoreColor = item.compliance_score >= 80 ? "text-green-600 bg-green-50" : item.compliance_score >= 50 ? "text-amber-600 bg-amber-50" : "text-red-600 bg-red-50";
                      return (
                        <button
                          key={item.id}
                          type="button"
                          onClick={() => loadHistoryItem(item)}
                          className={`w-full rounded-xl border border-slate-100 p-3 text-left transition hover:border-blue-200 hover:bg-blue-50/50 ${results?.id === item.id ? "border-blue-300 bg-blue-50 ring-1 ring-blue-200" : ""}`}
                        >
                          <div className="flex items-center justify-between gap-2">
                            <div className="min-w-0 flex-1">
                              <p className="truncate text-sm font-medium text-slate-800">{item.bid_title || "Untitled check"}</p>
                              <p className="text-xs text-slate-400 mt-0.5">{new Date(item.created_at).toLocaleDateString("en-US", { month: "short", day: "numeric" })}</p>
                            </div>
                            <span className={`shrink-0 inline-flex rounded-full px-2 py-0.5 text-xs font-bold ${scoreColor}`}>{item.compliance_score}</span>
                          </div>
                          <div className="mt-1.5 flex gap-2 text-[10px] font-semibold">
                            <span className="text-red-500">{item.fail_count} fail</span>
                            <span className="text-amber-500">{item.warning_count} warn</span>
                            <span className="text-green-500">{item.pass_count} pass</span>
                          </div>
                        </button>
                      );
                    })}
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>
      </main>

      {/* Footer */}
      <footer className="border-t border-slate-200 bg-slate-50 mt-16">
        <div className="mx-auto max-w-7xl px-6 py-8 flex flex-col sm:flex-row items-center justify-between gap-4">
          <p className="text-sm text-slate-500">© 2026 Contrax. All rights reserved.</p>
          <div className="flex items-center gap-6">
            <a href="/privacy" className="text-sm text-slate-500 hover:text-slate-700 transition-colors">Privacy Policy</a>
            <a href="/terms" className="text-sm text-slate-500 hover:text-slate-700 transition-colors">Terms of Service</a>
            <a href="mailto:minetreen@gmail.com" className="text-sm text-slate-500 hover:text-slate-700 transition-colors">Contact</a>
          </div>
        </div>
      </footer>
    </div>
  );
}
