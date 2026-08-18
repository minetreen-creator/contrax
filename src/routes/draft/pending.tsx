import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { createServerFn } from "@tanstack/react-start";
import { useCallback, useEffect, useState, type ReactNode } from "react";
import { getCurrentUser } from "~/lib/auth";
import { sql } from "~/db";
import { trackEvent } from "~/lib/track";

/**
 * /draft/pending — the user's Technical Approach draft for the solicitation
 * they pasted into /score (part B of the signup-conversion fix).
 *
 * The solicitation is persisted server-side (pending_drafts) at signup and
 * fulfilled on onboarding completion through the same FAR-grounded path as
 * /api/bids-draft. This page:
 *   - shows the finished draft (draft_text + hyperlinked citations) when
 *     status = 'fulfilled',
 *   - shows an honest "being prepared" state with a Generate/Retry button
 *     when status = 'awaiting_profile' (incl. after a failed generation —
 *     the error is surfaced here, never in the signup/onboarding flow),
 *   - is fail-open end to end: it never breaks onboarding, signup, or
 *     redirects.
 */

interface PendingDraftData {
  id: number;
  status: string;
  draft_text: string | null;
  citations: { clause_number: string; title: string; full_text: string }[];
  error: string | null;
  solicitation_excerpt: string;
}

// Server-side read of the user's latest pending draft (authenticated via the
// session cookie, like every loader).
const getPendingDraft = createServerFn({ method: "GET" }).handler(async (): Promise<PendingDraftData | null> => {
  const user = await getCurrentUser();
  if (!user) return null;
  try {
    const rows = await sql()`
      SELECT id, status, draft_text, citations, error, solicitation_text
      FROM pending_drafts
      WHERE user_id = ${user.id}
      ORDER BY id DESC LIMIT 1
    `;
    if (rows.length === 0) return null;
    const r = rows[0] as any;
    return {
      id: Number(r.id),
      status: String(r.status || "awaiting_profile"),
      draft_text: typeof r.draft_text === "string" ? r.draft_text : null,
      citations: Array.isArray(r.citations) ? (r.citations as any[]) : [],
      error: typeof r.error === "string" ? r.error : null,
      solicitation_excerpt: String(r.solicitation_text || "").slice(0, 80),
    };
  } catch {
    return null;
  }
});

export const Route = createFileRoute("/draft/pending")({
  loader: async () => ({ currentUser: await getCurrentUser() }),
  component: DraftPendingRoute,
  head: () => ({
    meta: [
      { title: "Your Technical Approach Draft | Contrax" },
      { name: "robots", content: "noindex, nofollow" },
    ],
  }),
});

// Route wrapper: auth guard lives here so DraftPendingPage's hooks always run
// in the same order (same pattern as onboarding/dashboard route wrappers).
function DraftPendingRoute() {
  const { currentUser } = Route.useLoaderData();
  const navigate = useNavigate();
  if (!currentUser) {
    navigate({ to: "/login" });
    return null;
  }
  return <DraftPendingPage />;
}

// Renders draft text with every valid citation hyperlinked to its public
// /clauses/{number} page (compact version of the dashboard renderer).
function renderDraftText(
  text: string,
  citations: { clause_number: string; title: string; full_text: string }[],
): ReactNode {
  if (!citations.length) return text;
  const list = citations
    .map((c) => c.clause_number)
    .sort((a, b) => b.length - a.length);
  const re = new RegExp(
    list.map((n) => `(?:\\[FAR\\s+)?${n}(?:\\])?`).join("|"),
    "g",
  );
  const byNumber = new Map(citations.map((c) => [c.clause_number, c]));
  const parts: ReactNode[] = [];
  let last = 0;
  let key = 0;
  for (const m of text.matchAll(re)) {
    const token = m[0];
    const unwrapped = token.replace(/^\[FAR\s+/, "").replace(/\]$/, "");
    const citation = byNumber.get(unwrapped);
    if (citation) {
      if (m.index > last) parts.push(text.slice(last, m.index));
      parts.push(
        <a
          key={`cit-${key++}`}
          href={`/clauses/${citation.clause_number}`}
          className="font-medium text-blue-600 underline decoration-dotted underline-offset-2 hover:text-blue-700 hover:decoration-solid"
        >
          {token}
        </a>,
      );
      last = m.index + token.length;
    }
  }
  if (last < text.length) parts.push(text.slice(last));
  return parts.length ? parts : text;
}

function DraftPendingPage() {
  const [loading, setLoading] = useState(true);
  const [data, setData] = useState<PendingDraftData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [generating, setGenerating] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const result = await getPendingDraft();
      setData(result);
    } catch {
      setData(null);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const generate = async () => {
    if (generating) return;
    setGenerating(true);
    setError(null);
    try {
      const res = await fetch("/api/pending-drafts/fulfill", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
      });
      const json = (await res.json().catch(() => null)) as { draft_text?: string; error?: string } | null;
      if (!res.ok || !json?.draft_text) {
        // Honest error surfaced ONLY here — never in signup/onboarding.
        setError(json?.error || "We couldn't generate your draft right now. Please try again.");
        await load();
        return;
      }
      trackEvent("pending_draft_fulfilled");
      await load();
    } catch {
      setError("We couldn't generate your draft right now. Please try again.");
    } finally {
      setGenerating(false);
    }
  };

  return (
    <div className="min-h-screen bg-slate-50">
      <header className="border-b border-slate-200 bg-white">
        <div className="mx-auto max-w-3xl px-4 py-4 flex items-center justify-between">
          <a href="/" className="inline-flex items-center gap-2">
            <img src="/logo.png" alt="Contrax" className="h-8 w-auto" />
          </a>
          <a href="/dashboard" className="text-sm font-medium text-blue-600 hover:text-blue-500">
            ← Back to dashboard
          </a>
        </div>
      </header>

      <main className="mx-auto max-w-3xl px-4 py-10">
        <div className="rounded-2xl border border-slate-200 bg-white p-8 shadow-sm">
          {loading ? (
            <p className="text-sm text-slate-500">Loading your draft…</p>
          ) : data === null ? (
            <div className="text-center">
              <h1 className="text-xl font-bold text-slate-900">No pending draft</h1>
              <p className="mt-2 text-sm text-slate-600">
                We couldn't find a Technical Approach draft tied to your account. Score a
                solicitation on the free tool and we'll draft one for you after you sign up.
              </p>
              <a
                href="/score"
                className="mt-5 inline-flex items-center rounded-xl bg-blue-600 px-6 py-3 text-sm font-semibold text-white transition hover:bg-blue-700"
              >
                Score a solicitation
              </a>
            </div>
          ) : data.status === "fulfilled" && data.draft_text ? (
            <div>
              <span className="inline-flex items-center gap-1.5 rounded-full border border-amber-300 bg-white px-3 py-1 text-[11px] font-bold uppercase tracking-wider text-amber-700">
                Drafting Intelligence
              </span>
              <h1 className="mt-3 text-xl font-bold text-slate-900">Your Technical Approach draft</h1>
              <p className="mt-1 text-sm text-slate-500">
                Drafted from the solicitation you pasted — every claim links to its real FAR clause.
              </p>
              <div className="mt-4 rounded-lg bg-slate-50 px-4 py-3 text-[13px] text-slate-600">
                <span className="font-semibold text-slate-700">Solicitation:</span>{" "}
                {data.solicitation_excerpt}
                {data.solicitation_excerpt.length >= 80 ? "…" : ""}
              </div>
              <div className="mt-6 whitespace-pre-line text-[14.5px] leading-relaxed text-slate-700">
                {renderDraftText(data.draft_text, data.citations)}
              </div>
              {data.citations.length > 0 && (
                <div className="mt-8 rounded-xl border border-slate-200 bg-slate-50 p-5">
                  <h2 className="text-sm font-bold text-slate-900">Cited FAR/DFARS clauses</h2>
                  <ul className="mt-3 space-y-2">
                    {data.citations.map((c) => (
                      <li key={c.clause_number} className="text-[13px] text-slate-700">
                        <a
                          href={`/clauses/${c.clause_number}`}
                          className="font-semibold text-blue-600 underline-offset-2 hover:underline"
                        >
                          {c.clause_number}
                        </a>{" "}
                        — {c.title}
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </div>
          ) : (
            /* awaiting_profile (or a failed generation that stayed awaiting) */
            <div className="text-center">
              <h1 className="text-xl font-bold text-slate-900">Your Technical Approach draft</h1>
              <p className="mt-2 text-sm leading-relaxed text-slate-600">
                {data.error
                  ? "We couldn't generate your draft the first time. Your solicitation is saved —"
                  : "We're preparing your draft from the solicitation you pasted. It takes a few seconds."}
              </p>
              {data.error && (
                <p className="mt-3 rounded-lg bg-red-50 border border-red-200 px-4 py-3 text-[13px] text-red-700">
                  {data.error}
                </p>
              )}
              <button
                onClick={generate}
                disabled={generating}
                className="mt-5 inline-flex items-center gap-2 rounded-xl bg-amber-500 px-7 py-3.5 text-sm font-semibold text-white shadow-lg shadow-amber-500/25 transition-all hover:bg-amber-400 disabled:cursor-not-allowed disabled:opacity-60 active:scale-[0.98]"
              >
                {generating ? (
                  <>
                    <svg className="h-4 w-4 animate-spin" viewBox="0 0 24 24" fill="none">
                      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                    </svg>
                    Generating…
                  </>
                ) : data.error ? (
                  "Retry draft generation"
                ) : (
                  "Generate my draft"
                )}
              </button>
              <p className="mt-4 text-[13px] text-slate-500">
                Every claim is grounded in real FAR/DFARS clauses — no invented citations.
              </p>
            </div>
          )}
        </div>
      </main>
    </div>
  );
}
