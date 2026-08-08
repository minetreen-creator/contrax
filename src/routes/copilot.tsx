import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";
import { getCurrentUser } from "~/lib/auth";
import { TrialGate } from "~/components/TrialGate";
import { normalizeCert } from "~/lib/profile-context";
import { getUserPatterns } from "~/lib/learning";
import { sql } from "~/db";

// ── Types ──────────────────────────────────────────────────────────────────

interface ChatMessage {
  role: "user" | "assistant";
  content: string;
}

interface CopilotStats {
  certifications: string[];
  activeBids: number;
  winRate: number;
  knowledgeDocs: number;
}



const SUGGESTED_PROMPTS = [
  "Which bids should I prioritize?",
  "What's my competitive position?",
  "Analyze my win/loss patterns",
  "What set-asides am I missing?",
];

// ── Route ───────────────────────────────────────────────────────────────────

export const Route = createFileRoute("/copilot")({
  loader: () => getCurrentUser(),
  component: CopilotPage,
  head: () => ({
    meta: [{ name: "robots", content: "noindex, nofollow" },
      {
        title:
          "Contract Intelligence Copilot — AI Government Contracting Strategist | Contrax",
      },
      {
        name: "description",
        content:
          "AI copilot for government contracting, set-aside bid strategy, and federal proposal assistance. Contrax knows your certifications, bids, and win/loss patterns.",
      },
    ],
  }),
});

// ── Component ───────────────────────────────────────────────────────────────

function CopilotPage() {
  const currentUser = Route.useLoaderData();

  if (!currentUser) return <PublicCopilot />;

  // Trial-gate the authenticated product; the public marketing page stays open.
  return (
    <TrialGate>
      <AuthenticatedCopilot />
    </TrialGate>
  );
}

function PublicCopilot() {
  return (
    <div className="min-h-screen bg-slate-950 text-white">
      <main>
        <section className="relative overflow-hidden px-4 pb-20 pt-20 sm:px-6 lg:px-8 lg:pb-28 lg:pt-28">
          <div className="absolute inset-0 bg-[radial-gradient(circle_at_top_right,_rgba(37,99,235,0.28),_transparent_45%)]" />
          <div className="relative mx-auto max-w-6xl">
            <div className="max-w-3xl">
              <div className="mb-6 inline-flex items-center gap-2 rounded-full border border-blue-400/30 bg-blue-400/10 px-3 py-1.5 text-sm font-medium text-blue-200">
                <span aria-hidden="true">✦</span> Contract Intelligence Copilot
              </div>
              <h1 className="text-4xl font-bold tracking-tight sm:text-6xl">
                Your AI Government Contracting Strategist
              </h1>
              <p className="mt-6 max-w-2xl text-lg leading-8 text-slate-300 sm:text-xl">
                Turn your certifications, active bids, win/loss history, and business knowledge into specific, actionable guidance for your next federal contract.
              </p>
              <div className="mt-9 flex flex-wrap gap-4">
                <a href="/signup" className="rounded-xl bg-blue-500 px-6 py-3.5 text-sm font-semibold text-white shadow-lg shadow-blue-500/25 transition hover:bg-blue-400">
                  Start Your Free Trial <span aria-hidden="true">→</span>
                </a>
                <a href="#how-it-works" className="rounded-xl border border-slate-700 px-6 py-3.5 text-sm font-semibold text-slate-200 transition hover:border-slate-500 hover:bg-slate-900">
                  See how it works
                </a>
              </div>
            </div>
          </div>
        </section>

        <section id="how-it-works" className="bg-white px-4 py-20 text-slate-900 sm:px-6 lg:px-8">
          <div className="mx-auto max-w-6xl">
            <div className="max-w-3xl">
              <p className="text-sm font-semibold uppercase tracking-wider text-blue-600">A strategist built around your business</p>
              <h2 className="mt-3 text-3xl font-bold tracking-tight sm:text-4xl">Go beyond generic AI answers</h2>
              <div className="mt-6 space-y-4 text-base leading-7 text-slate-600">
                <p>The Contract Intelligence Copilot is an AI government contracting strategist designed for the decisions that determine whether a small business wins federal work. It helps you understand which opportunities deserve your team's limited time, how to position your capabilities, and what to do next. Instead of returning broad procurement advice, it connects every recommendation to the opportunities and outcomes in your Contrax workspace.</p>
                <p>Copilot uses your business context: certifications such as 8(a), SDVOSB, WOSB, or HUBZone; NAICS codes and capabilities; active bids and their scores; past awards; win/loss history; learning patterns; pricing data; and documents in your knowledge base. That context lets it identify set-aside fit, surface competitive patterns, and explain tradeoffs in plain language. As your team records results and adds proposal knowledge, its guidance becomes more relevant to how your business actually competes.</p>
                <p>Ask practical questions such as “Which of my active bids should I prioritize?”, “What's my win rate on 8(a) set-asides?”, or “Draft a capability statement for this NAICS.” Copilot can help compare deadlines and competition, suggest teaming or pricing angles, reveal recurring weaknesses across losses, and turn your own source documents into a focused next step. Unlike ChatGPT, the Copilot already knows your business — you do not have to rebuild your context in every conversation, and it will not pretend to know facts that are not in your account.</p>
              </div>
            </div>

            <div className="mt-14 grid gap-5 md:grid-cols-3">
              <FeatureCard icon="◈" title="Knows Your Business" text="Your certifications, NAICS codes, active opportunities, and past wins are part of every strategic conversation." />
              <FeatureCard icon="✦" title="Strategic Guidance" text="Prioritize bids, sharpen pricing, evaluate set-aside fit, and find teaming suggestions grounded in your goals." />
              <FeatureCard icon="↗" title="Learns From Your Results" text="Win/loss patterns and recurring weaknesses turn each proposal outcome into a smarter next decision." />
            </div>
          </div>
        </section>

        <section className="bg-blue-600 px-4 py-16 sm:px-6 lg:px-8">
          <div className="mx-auto flex max-w-6xl flex-col items-start justify-between gap-8 md:flex-row md:items-center">
            <div>
              <h2 className="text-3xl font-bold">Make every bid decision count.</h2>
              <p className="mt-2 text-blue-100">Start your free trial. Plans start at $49/month, with Professional at $149 and Agency at $399.</p>
            </div>
            <a href="/signup" className="shrink-0 rounded-xl bg-white px-6 py-3.5 text-sm font-semibold text-blue-700 shadow-lg transition hover:bg-blue-50">Start Your Free Trial <span aria-hidden="true">→</span></a>
          </div>
        </section>
      </main>
    </div>
  );
}

function FeatureCard({ icon, title, text }: { icon: string; title: string; text: string }) {
  return (
    <article className="rounded-2xl border border-slate-200 bg-slate-50 p-6 shadow-sm">
      <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-blue-100 text-lg text-blue-700" aria-hidden="true">{icon}</div>
      <h3 className="mt-5 text-lg font-bold text-slate-900">{title}</h3>
      <p className="mt-2 text-sm leading-6 text-slate-600">{text}</p>
    </article>
  );
}

function AuthenticatedCopilot() {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState("");
  const [sending, setSending] = useState(false);
  const [error, setError] = useState("");
  const [historyLoaded, setHistoryLoaded] = useState(false);
  const [stats, setStats] = useState<CopilotStats | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    fetch("/api/copilot/history").then((r) => r.json())
      .then((res) => {
        setMessages(res);
        setHistoryLoaded(true);
      })
      .catch(() => setHistoryLoaded(true));
    fetch("/api/copilot/stats").then((r) => r.json()).then(setStats).catch(() => {});
  }, []);

  useEffect(() => {
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [messages, sending]);

  async function send(text?: string) {
    const msg = (text ?? input).trim();
    if (!msg || sending) return;
    setInput("");
    setError("");
    setMessages((prev) => [...prev, { role: "user", content: msg }]);
    setSending(true);
    try {
      const res = await fetch("/api/copilot", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message: msg }),
      }).then((r) => r.json());
      if (!res.reply) throw new Error(res.error || "Failed to get a reply. Please try again.");
      setMessages((prev) => [...prev, { role: "assistant", content: res.reply }]);
    } catch (err) {
      // Roll back the optimistic user bubble so UI stays in sync with the DB.
      setMessages((prev) => prev.filter((m) => !(m.role === "user" && m.content === msg)));
      setError(err instanceof Error ? err.message : "Failed to get a reply. Please try again.");
    } finally {
      setSending(false);
    }
  }

  return (
    <div className="min-h-screen bg-slate-50">
      <main className="mx-auto max-w-6xl px-4 py-6">
        {/* Header */}
        <div className="mb-6">
          <h1 className="text-2xl font-bold text-slate-900">
            ✨ Contract Intelligence Copilot
          </h1>
          <p className="mt-1 text-sm text-slate-500">
            Your AI strategist for government contracting
          </p>
        </div>

        <div className="grid gap-6 lg:grid-cols-[280px_1fr]">
          {/* Sidebar: what the copilot knows */}
          <aside className="space-y-4">
            <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
              <h2 className="text-xs font-semibold uppercase tracking-wider text-slate-400">
                What the Copilot knows
              </h2>
              <div className="mt-4 space-y-4">
                <div>
                  <p className="text-sm font-semibold text-slate-800">📋 Your Certifications</p>
                  <p className="mt-1 text-sm text-slate-500">
                    {stats && stats.certifications.length > 0
                      ? stats.certifications.join(", ")
                      : "None added yet — set them in onboarding."}
                  </p>
                </div>
                <div>
                  <p className="text-sm font-semibold text-slate-800">📊 Active Bids</p>
                  <p className="mt-1 text-sm text-slate-500">
                    {stats ? `${stats.activeBids} scored or recommended` : "—"}
                  </p>
                </div>
                <div>
                  <p className="text-sm font-semibold text-slate-800">📈 Win Rate</p>
                  <p className="mt-1 text-sm text-slate-500">
                    {stats ? `${stats.winRate}% across tracked outcomes` : "—"}
                  </p>
                </div>
                <div>
                  <p className="text-sm font-semibold text-slate-800">📚 Knowledge Docs</p>
                  <p className="mt-1 text-sm text-slate-500">
                    {stats ? `${stats.knowledgeDocs} documents in your base` : "—"}
                  </p>
                </div>
              </div>
            </div>
            <div className="rounded-2xl border border-blue-100 bg-blue-50 p-5 text-sm text-blue-900">
              <b>Pro tip:</b> Copilot reads your real profile, bids, scores, losses, and
              documents — ask it to recommend specific next actions and it will cite
              your actual data.
            </div>
          </aside>

          {/* Chat panel */}
          <section className="flex h-[calc(100vh-13rem)] min-h-[480px] flex-col overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
            {/* Messages */}
            <div ref={scrollRef} className="flex-1 space-y-4 overflow-y-auto p-5">
              {!historyLoaded ? (
                <p className="text-center text-sm text-slate-400">Loading conversation…</p>
              ) : messages.length === 0 ? (
                <div className="flex h-full flex-col items-center justify-center text-center">
                  <span className="text-4xl">✨</span>
                  <p className="mt-3 text-sm font-medium text-slate-700">
                    Ask your contracting strategist anything
                  </p>
                  <p className="mt-1 max-w-sm text-xs text-slate-400">
                    "Which bids should I prioritize?" is a great place to start.
                  </p>
                </div>
              ) : (
                messages.map((m, i) =>
                  m.role === "user" ? (
                    <div key={i} className="flex justify-end">
                      <div className="max-w-[80%] rounded-2xl rounded-br-sm bg-blue-600 px-4 py-2.5 text-sm text-white shadow-sm">
                        <p className="whitespace-pre-wrap">{m.content}</p>
                      </div>
                    </div>
                  ) : (
                    <div key={i} className="flex justify-start">
                      <div className="max-w-[85%] rounded-2xl rounded-bl-sm bg-slate-100 px-4 py-2.5 text-sm text-slate-800">
                        <p className="whitespace-pre-wrap">{m.content}</p>
                      </div>
                    </div>
                  ),
                )
              )}
              {sending && (
                <div className="flex justify-start">
                  <div className="rounded-2xl rounded-bl-sm bg-slate-100 px-4 py-2.5 text-sm text-slate-500">
                    <span className="animate-pulse">Thinking…</span>
                  </div>
                </div>
              )}
            </div>

            {/* Error */}
            {error && (
              <div className="border-t border-red-100 bg-red-50 px-5 py-2.5 text-xs text-red-700">
                {error}
              </div>
            )}

            {/* Input bar */}
            <div className="border-t border-slate-100 p-4">
              {/* Suggested prompts */}
              <div className="mb-3 flex flex-wrap gap-2">
                {SUGGESTED_PROMPTS.map((p) => (
                  <button
                    key={p}
                    type="button"
                    onClick={() => send(p)}
                    disabled={sending}
                    className="rounded-full border border-slate-200 bg-slate-50 px-3 py-1.5 text-xs font-medium text-slate-600 transition-colors hover:border-blue-300 hover:bg-blue-50 hover:text-blue-700 disabled:opacity-50"
                  >
                    {p}
                  </button>
                ))}
              </div>
              <p className="mb-3 text-xs text-slate-400">
                Your input is sent to OpenAI for processing. Data is not used for model training. <a href="/privacy#6-ai-data-handling" className="underline underline-offset-2 hover:text-slate-600">Learn more →</a>
              </p>
              <form
                onSubmit={(e) => {
                  e.preventDefault();
                  send();
                }}
                className="flex items-center gap-2"
              >
                <input
                  value={input}
                  onChange={(e) => setInput(e.target.value)}
                  placeholder="Ask about your bids, strategy, or set-asides…"
                  className="flex-1 rounded-xl border border-slate-200 bg-slate-50 px-4 py-2.5 text-sm text-slate-900 placeholder:text-slate-400 focus:border-blue-400 focus:bg-white focus:outline-none focus:ring-2 focus:ring-blue-100"
                  disabled={sending}
                />
                <button
                  type="submit"
                  disabled={sending || !input.trim()}
                  className="rounded-xl bg-slate-900 px-5 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-40"
                >
                  Send
                </button>
              </form>
            </div>
          </section>
        </div>
      </main>
    </div>
  );
}
