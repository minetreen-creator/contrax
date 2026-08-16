import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { getCurrentUser, type AuthUser } from "~/lib/auth";
import { trackEvent } from "~/lib/track";

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
  created_at: string | null;
  title: string;
  agency: string;
  estimated_value: string;
  due_date: string | null;
  location: string | null;
  category: string | null;
  source_url: string | null;
  set_aside: string | null;
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
    : date.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
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

// ── Page ─────────────────────────────────────────────────────────────────────
function PipelinePage({ user }: { user: AuthUser }) {
  const navigate = useNavigate();
  const [items, setItems] = useState<PipelineItem[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [removing, setRemoving] = useState<number | null>(null);
  const [error, setError] = useState("");
  const [loggingOut, setLoggingOut] = useState(false);

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
          <a
            href="/awards"
            className="inline-flex items-center gap-1.5 rounded-lg bg-amber-500 px-4 py-2 text-sm font-semibold text-white shadow-sm hover:bg-amber-600"
          >
            ⭐ Find more bids to save
          </a>
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
              </div>
            ))}
          </div>
        )}
      </main>
    </div>
  );
}
