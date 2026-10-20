/**
 * Client workspaces — the Agency tier's switcher (owner decision 2026-10-20, phase 1).
 *
 * One login, many clients: every row here is a workspace this Agency account owns.
 * Switching one makes it the account's ACTIVE client context, which is what the
 * Radar/dashboard feed (through `users.active_profile_id`) and the saved-bid / CRM
 * reads (through `workspace_id`) follow — so the page below shows that client's
 * matched bids and pipeline, not the previous client's.
 *
 * NOTHING IS COMPUTED HERE: the cap, the entitlement and every validation live in
 * src/lib/workspaces.ts and /api/workspaces. This component renders what the endpoint
 * returns and shows its error messages verbatim — it never invents a limit, a state
 * code or a success state.
 *
 * Inputs are plain comma-separated text (states: "VA, MD"; trades: "Janitorial,
 * HVAC") because that is how the rest of the app asks for states and trades.
 */
import { useCallback, useEffect, useState } from "react";

interface WorkspaceRow {
  id: number;
  name: string;
  states: string[];
  trades: string[];
}

interface WorkspaceList {
  data: WorkspaceRow[];
  activeWorkspaceId: number | null;
  canCreate: boolean;
  limit: number;
}

/** "VA, MD" → ["VA","MD"] (trimmed, upper-cased, blanks dropped). */
function splitList(value: string): string[] {
  return value
    .split(",")
    .map((part) => part.trim())
    .filter((part) => part.length > 0);
}

export default function WorkspaceSwitcher() {
  const [list, setList] = useState<WorkspaceList | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [name, setName] = useState("");
  const [states, setStates] = useState("");
  const [trades, setTrades] = useState("");
  const [renaming, setRenaming] = useState<{ id: number; value: string } | null>(null);

  const load = useCallback(async () => {
    try {
      const response = await fetch("/api/workspaces", { headers: { Accept: "application/json" } });
      if (!response.ok) {
        setError("Could not load your client workspaces.");
        return;
      }
      setList((await response.json()) as WorkspaceList);
      setError(null);
    } catch {
      setError("Could not load your client workspaces.");
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function send(body: Record<string, unknown>): Promise<boolean> {
    setBusy(true);
    setError(null);
    try {
      const response = await fetch("/api/workspaces", {
        method: "POST",
        headers: { "Content-Type": "application/json", Accept: "application/json" },
        body: JSON.stringify(body),
      });
      if (!response.ok) {
        const payload = (await response.json().catch(() => ({}))) as { message?: string };
        setError(payload.message ?? "Could not save that change.");
        return false;
      }
      await load();
      return true;
    } catch {
      setError("Could not save that change.");
      return false;
    } finally {
      setBusy(false);
    }
  }

  const count = list?.data.length ?? 0;
  const limit = list?.limit ?? 0;

  return (
    <section>
      <div className="mb-4">
        <h2 className="text-xl font-bold text-slate-900">Client workspaces</h2>
        <p className="text-sm text-slate-500">
          One login, many clients. Switching a client shows its own matched bids, saved bids and CRM contacts.
          {list && limit > 0 ? ` ${count} of ${limit} client workspaces used.` : ""}
        </p>
      </div>
      <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
        {error && (
          <p role="alert" className="mb-3 rounded-lg bg-red-50 p-2 text-sm text-red-700">
            {error}
          </p>
        )}
        {list === null ? (
          <p className="py-4 text-sm text-slate-500">Loading client workspaces…</p>
        ) : (
          <>
            {list.data.length === 0 ? (
              <p className="py-2 text-sm text-slate-500">No client workspaces yet.</p>
            ) : (
              <div className="space-y-2">
                {list.data.map((workspace) => {
                  const active = workspace.id === list.activeWorkspaceId;
                  return (
                    <div
                      key={workspace.id}
                      className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-100 py-2 text-sm"
                    >
                      <div className="min-w-0">
                        {renaming?.id === workspace.id ? (
                          <span className="flex gap-2">
                            <input
                              value={renaming.value}
                              onChange={(e) => setRenaming({ id: workspace.id, value: e.target.value })}
                              maxLength={80}
                              aria-label="Client name"
                              className="min-w-0 rounded-lg border border-slate-300 px-2 py-1 text-sm"
                            />
                            <button
                              disabled={busy}
                              onClick={async () => {
                                if (await send({ action: "rename", id: workspace.id, name: renaming.value })) {
                                  setRenaming(null);
                                }
                              }}
                              className="rounded-lg bg-slate-900 px-2 py-1 text-xs font-semibold text-white"
                            >
                              Save
                            </button>
                            <button onClick={() => setRenaming(null)} className="text-xs text-slate-500">
                              Cancel
                            </button>
                          </span>
                        ) : (
                          <>
                            <span className={active ? "font-semibold text-blue-700" : "font-semibold text-slate-800"}>
                              {workspace.name}
                              {active ? " (viewing)" : ""}
                            </span>
                            <span className="ml-2 text-xs text-slate-400">
                              {workspace.states.length > 0 ? workspace.states.join(", ") : "no states"} ·{" "}
                              {workspace.trades.length > 0 ? workspace.trades.join(", ") : "no trades"}
                            </span>
                          </>
                        )}
                      </div>
                      <div className="flex shrink-0 items-center gap-3 text-xs">
                        {active ? (
                          <span className="font-semibold text-emerald-700">Active</span>
                        ) : (
                          <button
                            disabled={busy}
                            onClick={() => send({ action: "switch", id: workspace.id })}
                            className="font-semibold text-blue-600 hover:underline"
                          >
                            View this client
                          </button>
                        )}
                        {list.canCreate && renaming?.id !== workspace.id && (
                          <button
                            onClick={() => setRenaming({ id: workspace.id, value: workspace.name })}
                            className="text-slate-500 hover:text-slate-700"
                          >
                            Rename
                          </button>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}

            {list.activeWorkspaceId !== null && (
              <button
                disabled={busy}
                onClick={() => send({ action: "switch", id: null })}
                className="mt-3 text-xs font-semibold text-slate-500 hover:text-slate-700"
              >
                Back to my own account view
              </button>
            )}

            {list.canCreate ? (
              <div className="mt-4 space-y-2 border-t border-slate-100 pt-4">
                <div className="flex flex-wrap gap-2">
                  <input
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    placeholder="Client name"
                    maxLength={80}
                    aria-label="New client name"
                    className="min-w-0 flex-1 rounded-lg border border-slate-300 px-3 py-2 text-sm"
                  />
                  <input
                    value={states}
                    onChange={(e) => setStates(e.target.value)}
                    placeholder="States (VA, MD)"
                    aria-label="New client states"
                    className="min-w-0 flex-1 rounded-lg border border-slate-300 px-3 py-2 text-sm"
                  />
                  <input
                    value={trades}
                    onChange={(e) => setTrades(e.target.value)}
                    placeholder="Trades (Janitorial, HVAC)"
                    aria-label="New client trades"
                    className="min-w-0 flex-1 rounded-lg border border-slate-300 px-3 py-2 text-sm"
                  />
                </div>
                <button
                  disabled={busy || count >= limit}
                  onClick={async () => {
                    const ok = await send({
                      action: "create",
                      name,
                      states: splitList(states),
                      trades: splitList(trades),
                    });
                    if (ok) {
                      setName("");
                      setStates("");
                      setTrades("");
                    }
                  }}
                  className="rounded-lg bg-slate-900 px-3 py-2 text-sm font-semibold text-white disabled:opacity-50"
                >
                  {count >= limit ? `Plan limit reached (${limit})` : "Add client workspace"}
                </button>
              </div>
            ) : (
              <p className="mt-4 border-t border-slate-100 pt-4 text-xs text-slate-500">
                Client workspaces are part of the Agency plan. Your existing workspaces stay readable.
              </p>
            )}
          </>
        )}
      </div>
    </section>
  );
}
