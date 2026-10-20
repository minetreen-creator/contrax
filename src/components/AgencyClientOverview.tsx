/**
 * Across your client workspaces — the Agency tier's CROSS-CLIENT DASHBOARD
 * (phase 2, owner decision 2026-10-20). It sits directly under the Phase 1
 * WorkspaceSwitcher in the Agency section of /workspace.
 *
 * WHY IT EXISTS. The switcher answers "which client am I looking at?". A consultant
 * supervising up to 10 clients also needs the opposite question answered without
 * clicking through each one: which of my clients has a deadline this week, which
 * has bids already past due, whose pipeline is actually moving, and who has gone
 * quiet. One row per client, attention first.
 *
 * NOTHING IS COMPUTED HERE. Every number comes from GET /api/agency-overview, which
 * is already scoped to the caller's OWN workspaces and to each client's own
 * `workspace_id` rows. This component never counts, never guesses a limit and never
 * invents a client — it renders the payload and its error text verbatim (the phase-1
 * WorkspaceSwitcher rule).
 *
 * "View this client" reuses the EXISTING phase-1 switch action (POST
 * /api/workspaces { action: "switch" }) and reloads, so the Radar/pipeline/CRM
 * sections below follow the new active client exactly as they already do. No new
 * write path, no new entitlement.
 */
import { useCallback, useEffect, useState } from "react";
import type { AgencyOverview, WorkspaceRollup } from "~/lib/agency-overview";

/** "just now" / "3 hours ago" / "yesterday" / "12 days ago" — or null when never. */
function relative(iso: string | null): string | null {
  if (!iso) return null;
  const then = new Date(iso).getTime();
  if (!Number.isFinite(then)) return null;
  const mins = Math.floor((Date.now() - then) / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins} minute${mins === 1 ? "" : "s"} ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours} hour${hours === 1 ? "" : "s"} ago`;
  const days = Math.floor(hours / 24);
  return days === 1 ? "yesterday" : `${days} days ago`;
}

function Stat({ label, value, tone }: { label: string; value: number; tone?: "amber" | "red" | "blue" }) {
  const classes =
    value === 0
      ? "bg-slate-50 text-slate-500"
      : tone === "red"
        ? "bg-red-50 text-red-700"
        : tone === "amber"
          ? "bg-amber-50 text-amber-800"
          : tone === "blue"
            ? "bg-blue-50 text-blue-700"
            : "bg-slate-100 text-slate-700";
  return (
    <span className={`rounded-full px-2.5 py-1 font-semibold ${classes}`}>
      {value} {label}
    </span>
  );
}

function ClientRow({ workspace, busy, onView }: { workspace: WorkspaceRollup; busy: boolean; onView: () => void }) {
  const last = relative(workspace.lastActivityAt);
  return (
    <div className="border-b border-slate-100 py-3 last:border-b-0">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="font-semibold text-slate-800">{workspace.name}</p>
          <p className="text-xs text-slate-400">
            {workspace.states.length > 0 ? workspace.states.join(", ") : "no states"} ·{" "}
            {workspace.trades.length > 0 ? workspace.trades.join(", ") : "no trades"}
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-3 text-xs">
          {workspace.attention.length === 0 && <span className="text-slate-400">nothing urgent</span>}
          <button
            disabled={busy}
            onClick={onView}
            className="font-semibold text-blue-600 hover:underline disabled:opacity-50"
          >
            View this client
          </button>
        </div>
      </div>
      <div className="mt-2 flex flex-wrap items-center gap-2 text-xs">
        <Stat label="saved" value={workspace.savedBids} />
        <Stat label="due in 7 days" value={workspace.dueInWindow} tone="amber" />
        <Stat label="overdue" value={workspace.overdue} tone="red" />
        <Stat label="advancing" value={workspace.advancing} tone="blue" />
        <Stat label="contacts" value={workspace.contacts} />
        <span className="text-slate-400">{last ? `Last activity ${last}` : "No activity yet"}</span>
      </div>
    </div>
  );
}

export default function AgencyClientOverview() {
  const [overview, setOverview] = useState<AgencyOverview | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<number | null>(null);

  const load = useCallback(async () => {
    try {
      const response = await fetch("/api/agency-overview", { headers: { Accept: "application/json" } });
      if (!response.ok) {
        setError("Could not load your clients.");
        return;
      }
      setOverview((await response.json()) as AgencyOverview);
      setError(null);
    } catch {
      setError("Could not load your clients.");
    }
  }, []);

  useEffect(() => {
    void load();
    // The WorkspaceSwitcher above dispatches this after creating or renaming a
    // client, so a new client shows up here without a page reload.
    const onChange = () => void load();
    window.addEventListener("agency-workspaces-changed", onChange);
    return () => window.removeEventListener("agency-workspaces-changed", onChange);
  }, [load]);

  async function viewClient(id: number) {
    setBusyId(id);
    setError(null);
    try {
      const response = await fetch("/api/workspaces", {
        method: "POST",
        headers: { "Content-Type": "application/json", Accept: "application/json" },
        body: JSON.stringify({ action: "switch", id }),
      });
      if (!response.ok) {
        const payload = (await response.json().catch(() => ({}))) as { message?: string };
        setError(payload.message ?? "Could not switch to that client.");
        return;
      }
      // Reload so the dashboard, pipeline and CRM sections all follow the newly
      // active client (the same switch the WorkspaceSwitcher performs).
      window.location.reload();
    } catch {
      setError("Could not switch to that client.");
    } finally {
      setBusyId(null);
    }
  }

  const totals = overview?.totals;

  return (
    <section>
      <div className="mb-4">
        <h2 className="text-xl font-bold text-slate-900">Across your client workspaces</h2>
        <p className="text-sm text-slate-500">
          Deadlines, pipeline movement and CRM activity for every client at once — busiest first, so you can see who
          needs attention without switching through each one.
        </p>
      </div>
      <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
        {error && (
          <p role="alert" className="mb-3 rounded-lg bg-red-50 p-2 text-sm text-red-700">
            {error}
          </p>
        )}
        {overview === null ? (
          <p className="py-4 text-sm text-slate-500">Loading your clients…</p>
        ) : overview.workspaces.length === 0 ? (
          <p className="py-2 text-sm text-slate-500">
            No client workspaces yet. Add one above and its deadlines and pipeline will appear here.
          </p>
        ) : (
          <>
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
              {[
                { label: "Clients", value: totals?.workspaces ?? 0 },
                { label: "Saved bids", value: totals?.savedBids ?? 0 },
                { label: "Due in the next 7 days", value: totals?.dueInWindow ?? 0 },
                { label: "Overdue", value: totals?.overdue ?? 0 },
              ].map((item) => (
                <div key={item.label} className="rounded-xl bg-slate-50 p-3">
                  <p className="text-2xl font-bold text-slate-900">{item.value}</p>
                  <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">{item.label}</p>
                </div>
              ))}
            </div>
            <div className="mt-4">
              {overview.workspaces.map((workspace) => (
                <ClientRow
                  key={workspace.id}
                  workspace={workspace}
                  busy={busyId === workspace.id}
                  onView={() => viewClient(workspace.id)}
                />
              ))}
            </div>
            <p className="mt-3 border-t border-slate-100 pt-3 text-xs text-slate-500">
              Counts are pulled from each client&apos;s own saved bids and CRM contacts. Saved bids and contacts in your
              own account view (not filed under a client) are shown on the pages below when you switch back to it.
            </p>
          </>
        )}
      </div>
    </section>
  );
}
