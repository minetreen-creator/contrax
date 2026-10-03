import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { getCurrentUser, type AuthUser } from "~/lib/auth";
import { trackEvent } from "~/lib/track";
// PIPELINE CSV EXPORT gate (owner decision 2, 2026-09-26): export is a Bid
// Scout ($99/mo) feature. The click IS the attempt — the prompt opens only for a
// gated attempt (never on the page view), paired with the standalone
// `export_attempted`/"gated" event.
import { ATTEMPT_EVENT_FOR_ACTION, GATE_ATTEMPT_LABEL, gatePrompt } from "~/lib/plan-gates";
import { PremiumUpgradeModal } from "~/components/PremiumUpgradeModal";
import { displayCompanyName, formatAwardAmount } from "~/lib/award-check";

/**
 * /pipeline — "My Pipeline"
 *
 * Auth-gated personal list of saved bids (saved_matches joined to bids).
 * Uses the PR #139 wrapper pattern: the guard lives in PipelineRoute (which has
 * only unconditional hooks) so PipelinePage's hooks always run in the same
 * order — no early-return-before-hooks.
 */

interface PipelineItem {
  id: number;
  bid_id: number;
  status: string;
  pursuit_status: string;
  notes: string;
  next_action: string;
  follow_up_date: string | null;
  contact_name: string;
  contact_organization: string;
  contact_role: string;
  contact_email: string;
  created_at: string | null;
  title: string;
  agency: string;
  estimated_value: string;
  due_date: string | null;
  location: string | null;
  category: string | null;
  source_url: string | null;
  set_aside: string | null;
  /** SAM.gov award posted after the deadline ("Did I win?", owner 2026-10-03). */
  award?: { awardee_name: string; amount: number | null; award_date: string | null } | null;
}

export const Route = createFileRoute("/pipeline")({
  loader: async (): Promise<{ user: AuthUser | null }> => ({
    user: await getCurrentUser(),
  }),
  component: PipelineRoute,
  head: () => ({
    meta: [
      { title: "My Pipeline | Contrax" },
      { name: "robots", content: "noindex, nofollow" },
    ],
  }),
});

// ── Helpers ──────────────────────────────────────────────────────────────────
function fmtDate(d: string | null | undefined): string {
  if (!d) return "Not specified";
  const date = new Date(d);
  return Number.isNaN(date.getTime())
    ? "Not specified"
    : date.toLocaleDateString("en-US", {
        month: "short", day: "numeric", year: "numeric",
        // Date-only strings are calendar days, not midnight in the viewer's zone.
        timeZone: /^\d{4}-\d{2}-\d{2}$/.test(d) ? "UTC" : undefined,
      });
}

// ── Route wrapper (auth guard — hooks stay unconditional) ────────────────────
function PipelineRoute() {
  const { user } = Route.useLoaderData();
  const navigate = useNavigate();
  if (!user) {
    navigate({ to: "/login" });
    return null;
  }
  return <PipelinePage user={user} />;
}

const pursuitStatuses = ["evaluating", "preparing", "submitted", "won", "lost"] as const;
type WorkspaceKey = "pursuit_status" | "notes" | "next_action" | "follow_up_date" | "contact_name" | "contact_organization" | "contact_role" | "contact_email";

function BidWorkspace({ item, onSaved }: { item: PipelineItem; onSaved: (updated: Partial<PipelineItem>) => void }) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(item);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState("");
  function update(key: WorkspaceKey, value: string) { setDraft((old) => ({ ...old, [key]: value })); }
  async function save() {
    setSaving(true);
    setSaveError("");
    try {
      const res = await fetch("/api/pipeline-workspace", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          bid_id: item.bid_id, pursuit_status: draft.pursuit_status,
          notes: draft.notes, next_action: draft.next_action,
          follow_up_date: draft.follow_up_date || null,
          contact_name: draft.contact_name, contact_organization: draft.contact_organization,
          contact_role: draft.contact_role, contact_email: draft.contact_email,
        }),
      });
      if (!res.ok) {
        const payload = await res.json().catch(() => null);
        throw new Error(payload?.error || "Could not save bid details");
      }
      const payload = await res.json();
      onSaved(payload.data);
      setDraft((old) => ({ ...old, ...payload.data }));
      setEditing(false);
    } catch (error) {
      setSaveError(error instanceof Error ? error.message : "Could not save bid details");
    } finally { setSaving(false); }
  }
  const input = "w-full rounded-lg border border-slate-300 px-3 py-2 text-sm text-slate-900";
  return (
    <div className="mt-4 border-t border-slate-100 pt-4 text-sm">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="space-y-1 text-slate-600">
          <p><span className="font-semibold text-slate-800">Pursuit:</span> {item.pursuit_status}</p>
          {item.next_action && <p><span className="font-semibold text-slate-800">Next action:</span> {item.next_action}{item.follow_up_date ? ` · ${item.follow_up_date}` : ""}</p>}
          {item.contact_name && <p><span className="font-semibold text-slate-800">Contact:</span> {item.contact_name}{item.contact_organization ? ` · ${item.contact_organization}` : ""}</p>}
          {item.notes && <p className="whitespace-pre-wrap"><span className="font-semibold text-slate-800">Notes:</span> {item.notes}</p>}
        </div>
        <button type="button" className="rounded-lg border border-slate-300 px-3 py-1.5 font-medium text-slate-700 hover:bg-slate-50" onClick={() => { if (editing) setDraft(item); setSaveError(""); setEditing(!editing); }}>{editing ? "Cancel" : "Manage bid"}</button>
      </div>
      {editing && <div className="mt-4 grid gap-3 rounded-xl bg-slate-50 p-4 sm:grid-cols-2">
        <label className="space-y-1">Pursuit status<select className={input} value={draft.pursuit_status} onChange={(e) => update("pursuit_status", e.target.value)}>{pursuitStatuses.map((status) => <option key={status} value={status}>{status[0].toUpperCase() + status.slice(1)}</option>)}</select></label>
        <label className="space-y-1">Follow-up date<input className={input} type="date" value={draft.follow_up_date ?? ""} onChange={(e) => update("follow_up_date", e.target.value)} /></label>
        <label className="space-y-1 sm:col-span-2">Next action<input className={input} maxLength={300} value={draft.next_action} onChange={(e) => update("next_action", e.target.value)} placeholder="Email the procurement contact" /></label>
        <label className="space-y-1">Contact name<input className={input} maxLength={300} value={draft.contact_name} onChange={(e) => update("contact_name", e.target.value)} /></label>
        <label className="space-y-1">Organization<input className={input} maxLength={300} value={draft.contact_organization} onChange={(e) => update("contact_organization", e.target.value)} /></label>
        <label className="space-y-1">Contact role<input className={input} maxLength={300} value={draft.contact_role} onChange={(e) => update("contact_role", e.target.value)} /></label>
        <label className="space-y-1">Contact email<input className={input} type="email" maxLength={300} value={draft.contact_email} onChange={(e) => update("contact_email", e.target.value)} /></label>
        <label className="space-y-1 sm:col-span-2">Notes<textarea className={input} rows={3} maxLength={5000} value={draft.notes} onChange={(e) => update("notes", e.target.value)} /></label>
        {saveError && <p role="alert" className="text-red-700 sm:col-span-2">{saveError}</p>}
        <div className="sm:col-span-2"><button type="button" disabled={saving} onClick={save} className="rounded-lg bg-amber-500 px-4 py-2 font-semibold text-white hover:bg-amber-600 disabled:opacity-50">{saving ? "Saving…" : "Save bid details"}</button></div>
      </div>}
    </div>
  );
}

// ── Page ─────────────────────────────────────────────────────────────────────
function PipelinePage({ user: _user }: { user: AuthUser }) {
  const navigate = useNavigate();
  const [items, setItems] = useState<PipelineItem[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [removing, setRemoving] = useState<number | null>(null);
  const [error, setError] = useState("");
  const [loggingOut, setLoggingOut] = useState(false);
  const [exportGate, setExportGate] = useState(false);
  const [exportBusy, setExportBusy] = useState(false);

  useEffect(() => {
    let cancelled = false;
    fetch("/api/my-pipeline")
      .then((r) => {
        if (!r.ok) throw new Error("Failed to load pipeline");
        return r.json();
      })
      .then((d: { data?: PipelineItem[] }) => {
        if (!cancelled) {
          setItems(d.data ?? []);
          setLoading(false);
        }
      })
      .catch(() => {
        if (!cancelled) {
          setError("Could not load your pipeline. Please try again.");
          setLoading(false);
        }
      });
    return () => {
      cancelled = true;
    };
  }, []);

  async function handleRemove(bidId: number) {
    if (removing !== null) return;
    setRemoving(bidId);
    try {
      const res = await fetch("/api/remove-saved", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ bidId }),
      });
      if (!res.ok) throw new Error("Failed to remove");
      setItems((prev) => (prev ?? []).filter((i) => i.bid_id !== bidId));
      trackEvent("save_remove", String(bidId));
    } catch {
      setError("Could not remove that bid. Please try again.");
    } finally {
      setRemoving(null);
    }
  }

  /**
   * ATTEMPT-ONLY CSV export (owner decision 2 + rule 8). Pipeline export is a
   * Bid Scout ($99/mo) feature: the click IS the attempt, so a non-customer gets
   * the Bid Scout prompt HERE (with the standalone gated-attempt event) and a
   * customer gets a real download of their own saved rows.
   */
  async function handleExport() {
    if (exportBusy) return;
    trackEvent(ATTEMPT_EVENT_FOR_ACTION.export, "attempt", "/pipeline");
    setExportBusy(true);
    try {
      const res = await fetch("/api/pipeline-export");
      if (res.status === 402) {
        trackEvent(ATTEMPT_EVENT_FOR_ACTION.export, GATE_ATTEMPT_LABEL, "/pipeline");
        setExportGate(true);
        return;
      }
      if (!res.ok) throw new Error("export failed");
      // The server names the file (date-stamped, the user's own data only).
      const disposition = res.headers.get("content-disposition") ?? "";
      const named = disposition.match(/filename="([^"]+)"/)?.[1];
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = named ?? "contrax-pipeline.csv";
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
      trackEvent(ATTEMPT_EVENT_FOR_ACTION.export, "exported", "/pipeline");
    } catch {
      setError("Could not export your pipeline. Please try again.");
    } finally {
      setExportBusy(false);
    }
  }

  return (
    <div className="min-h-screen bg-slate-50">
      {/* Header */}
      <header className="sticky top-0 z-10 border-b border-slate-200 bg-white">
        <div className="mx-auto max-w-5xl px-4 py-3 flex items-center justify-between">
          <a href="/" className="inline-flex items-center gap-2">
            <img src="/logo.png" alt="Contrax" className="h-8 w-auto" />
          </a>
          <div className="flex items-center gap-4">
            <a href="/dashboard" className="text-sm font-medium text-slate-500 hover:text-slate-700 transition-colors">Dashboard</a>
            <a href="/pipeline" className="text-sm font-semibold text-amber-600 hover:text-amber-500 transition-colors" aria-current="page">⭐ Pipeline</a>
            <button
              type="button"
              onClick={async () => {
                setLoggingOut(true);
                try {
                  await fetch("/api/logout", { method: "POST" });
                  navigate({ to: "/" });
                } catch {
                  setLoggingOut(false);
                }
              }}
              disabled={loggingOut}
              className="text-sm font-medium text-slate-500 hover:text-slate-700 disabled:opacity-50"
            >
              {loggingOut ? "Signing out..." : "Sign out"}
            </button>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-5xl px-4 py-8">
        <div className="mb-6 flex flex-wrap items-center justify-between gap-3">
          <div>
            <h1 className="text-2xl font-bold text-slate-900">My Pipeline</h1>
            <p className="mt-1 text-sm text-slate-500">
              Bids you've saved to track and pursue.
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={handleExport}
              disabled={exportBusy}
              className="inline-flex items-center gap-1.5 rounded-lg border border-slate-300 bg-white px-4 py-2 text-sm font-semibold text-slate-700 shadow-sm transition-colors hover:bg-slate-100 disabled:cursor-wait disabled:opacity-60"
            >
              {exportBusy ? "Preparing CSV…" : "⤓ Export pipeline (CSV)"}
            </button>
            <a
              href="/awards"
              className="inline-flex items-center gap-1.5 rounded-lg bg-amber-500 px-4 py-2 text-sm font-semibold text-white shadow-sm hover:bg-amber-600"
            >
              ⭐ Find more bids to save
            </a>
          </div>
        </div>

        {error && (
          <div className="mb-4 rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700">{error}</div>
        )}

        {loading ? (
          <div className="space-y-3">
            {[0, 1, 2].map((i) => (
              <div key={i} className="h-24 animate-pulse rounded-xl border border-slate-200 bg-white" />
            ))}
          </div>
        ) : items && items.length === 0 ? (
          <div className="rounded-2xl border border-dashed border-slate-300 bg-white px-6 py-16 text-center">
            <p className="text-3xl">⭐</p>
            <h2 className="mt-3 text-lg font-semibold text-slate-900">Your pipeline is empty</h2>
            <p className="mx-auto mt-2 max-w-md text-sm text-slate-600">
              Hit "Save to My Pipeline" on any opportunity or award card and it
              will show up here — saved bids are one click away from a deadline
              countdown and a win-probability analysis.
            </p>
            <div className="mt-5 flex flex-wrap justify-center gap-3">
              <a href="/awards" className="rounded-lg bg-amber-500 px-4 py-2 text-sm font-semibold text-white hover:bg-amber-600">
                Browse opportunities
              </a>
              <a href="/dashboard" className="rounded-lg bg-white px-4 py-2 text-sm font-semibold text-slate-700 ring-1 ring-inset ring-slate-300 hover:bg-slate-100">
                Go to dashboard
              </a>
            </div>
          </div>
        ) : (
          <div className="space-y-3">
            {items?.map((item) => (
              <div key={item.bid_id} className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
                <div className="flex flex-wrap items-start justify-between gap-4">
                  <div className="min-w-0 flex-1">
                    <h3 className="font-semibold leading-snug text-slate-900">
                      {item.source_url ? (
                        <a href={item.source_url} target="_blank" rel="noopener noreferrer" className="hover:text-blue-600">
                          {item.title}
                        </a>
                      ) : (
                        item.title
                      )}
                    </h3>
                    <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-slate-500">
                      <span className="font-medium text-slate-700">{item.agency}</span>
                      <span>·</span>
                      <span className="font-semibold text-green-700">{item.estimated_value}</span>
                      <span>·</span>
                      <span>Due {fmtDate(item.due_date)}</span>
                    </div>
                    <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-slate-400">
                      {item.set_aside && <span className="font-medium text-blue-600">{item.set_aside}</span>}
                      {item.category && <span>{item.category}</span>}
                      {item.location && <span>{item.location}</span>}
                      {item.created_at && <span>Saved {fmtDate(item.created_at)}</span>}
                    </div>
                    {item.award && (
                      <p className="mt-2 rounded-md bg-amber-50 px-3 py-2 text-sm text-amber-900">
                        🏆 Awarded to <strong>{displayCompanyName(item.award.awardee_name)}</strong>
                        {formatAwardAmount(item.award.amount) && <> for <strong>{formatAwardAmount(item.award.amount)}</strong></>}
                        {item.award.award_date && <> on {fmtDate(item.award.award_date)}</>}
                      </p>
                    )}
                  </div>
                  <button
                    type="button"
                    onClick={() => handleRemove(item.bid_id)}
                    disabled={removing !== null}
                    className="shrink-0 rounded-lg border border-slate-200 px-3 py-1.5 text-sm font-medium text-slate-500 transition-colors hover:border-red-200 hover:bg-red-50 hover:text-red-700 disabled:cursor-wait disabled:opacity-50"
                  >
                    {removing === item.bid_id ? "Removing…" : "Remove"}
                  </button>
                </div>
                <BidWorkspace item={item} onSaved={(updated) => setItems((previous) => previous?.map((entry) => entry.bid_id === item.bid_id ? { ...entry, ...updated } : entry) ?? null)} />
              </div>
            ))}
          </div>
        )}
      </main>
      {/* ATTEMPT-ONLY Bid Scout prompt (owner rule 8) — opened solely by the
          gated export attempt above, never by the page view. */}
      <PremiumUpgradeModal
        open={exportGate}
        onClose={() => setExportGate(false)}
        title={gatePrompt("bid_scout").title}
        message={gatePrompt("bid_scout").body}
        ctaLabel={gatePrompt("bid_scout").ctaLabel}
        priceNote={gatePrompt("bid_scout").priceNote}
        ctaHref={gatePrompt("bid_scout").href}
      />
    </div>
  );
}
