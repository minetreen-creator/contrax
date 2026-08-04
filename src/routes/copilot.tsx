import { createFileRoute } from "@tanstack/react-router";
import { createServerFn } from "@tanstack/react-start";
import { useEffect, useRef, useState } from "react";
import { getCurrentUser } from "~/lib/auth";
import { TrialGate } from "~/components/TrialGate";
import { callAI } from "~/lib/ai";
import { fetchCopilotContext } from "~/lib/copilot";
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

const SYSTEM_PROMPT = `You are Contrax Copilot, a senior government contracting strategist with deep expertise in federal procurement, set-aside programs (8(a), SDVOSB, WOSB, HUBZone), and small business growth. You have full access to this business's profile, certifications, bid history, win/loss patterns, and knowledge base.

Your job: give clear, actionable, specific strategic advice. Cite the business's actual data — mention their NAICS codes, recent bids, win rates, and patterns by name. Be direct about competitive weaknesses. When you spot an opportunity (e.g. "Three of your active bids are 8(a) set-asides expiring in Q3 — prioritize the $250K DHS contract"), say so.

Never make up data. If you don't have enough information, say so and ask. Keep responses concise but substantive — 2-4 paragraphs unless the user asks for detail.`;

const SUGGESTED_PROMPTS = [
  "Which bids should I prioritize?",
  "What's my competitive position?",
  "Analyze my win/loss patterns",
  "What set-asides am I missing?",
];

// ── Server Functions ────────────────────────────────────────────────────────

/** Saves a chat message, creating the table on first use. */
async function saveMessage(userEmail: string, role: string, content: string) {
  await sql()`CREATE TABLE IF NOT EXISTS copilot_messages (
    id SERIAL PRIMARY KEY,
    user_email TEXT NOT NULL,
    role TEXT NOT NULL,
    content TEXT NOT NULL,
    created_at TIMESTAMPTZ DEFAULT NOW()
  )`;
  await sql()`INSERT INTO copilot_messages (user_email, role, content) VALUES (${userEmail}, ${role}, ${content})`;
}

const sendMessage = createServerFn({ method: "POST" })
  .validator((data: unknown) => {
    const d = data as { message?: unknown };
    if (!d || typeof d.message !== "string" || d.message.trim().length === 0) {
      throw new Error("Message is required");
    }
    return { message: d.message.trim() };
  })
  .handler(async ({ data }): Promise<{ reply: string }> => {
    const user = await getCurrentUser();
    if (!user) throw new Error("Not authenticated");

    // Save the user's message first so the conversation is never lost.
    await saveMessage(user.email, "user", data.message);

    // Assemble context: system prompt + business context + last 20 messages + new message.
    const context = await fetchCopilotContext(user.email);
    const historyRows = await sql()`
      SELECT role, content FROM copilot_messages
      WHERE user_email = ${user.email}
      ORDER BY id DESC LIMIT 20`;
    const history = (historyRows as { role: string; content: string }[])
      .slice()
      .reverse()
      .map((m) => ({ role: m.role, content: m.content }));

    const messages = [
      { role: "system", content: SYSTEM_PROMPT },
      { role: "system", content: `BUSINESS DATA CONTEXT (real data from this business's Contrax account — cite it by name):\n${context}` },
      ...history,
      { role: "user", content: data.message },
    ];

    let reply: string;
    try {
      reply = await callAI(messages, { max_tokens: 900, temperature: 0.4 });
    } catch (err) {
      throw new Error(
        `AI request failed: ${err instanceof Error ? err.message : String(err)}`,
      );
    }

    await saveMessage(user.email, "assistant", reply);
    return { reply };
  });

const loadHistory = createServerFn({ method: "GET" }).handler(
  async (): Promise<ChatMessage[]> => {
    const user = await getCurrentUser();
    if (!user) return [];
    try {
      const rows = await sql()`
        SELECT role, content FROM copilot_messages
        WHERE user_email = ${user.email}
        ORDER BY id DESC LIMIT 50`;
      return (rows as { role: string; content: string }[])
        .slice()
        .reverse()
        .map((m) => ({
          role: m.role === "assistant" ? "assistant" : "user",
          content: m.content,
        }));
    } catch {
      return [];
    }
  },
);

const getCopilotStats = createServerFn({ method: "GET" }).handler(
  async (): Promise<CopilotStats> => {
    const user = await getCurrentUser();
    const empty: CopilotStats = { certifications: [], activeBids: 0, winRate: 0, knowledgeDocs: 0 };
    if (!user) return empty;
    const stats: CopilotStats = { ...empty };

    try {
      const rows = await sql()`SELECT certifications FROM business_profiles WHERE user_id = ${user.id} LIMIT 1`;
      if (rows.length > 0) {
        const certs = (rows[0] as { certifications: unknown }).certifications;
        stats.certifications = (Array.isArray(certs) ? certs : []).map((c) =>
          normalizeCert(String(c)),
        );
      }
    } catch { /* no profile yet */ }

    try {
      await sql()`CREATE TABLE IF NOT EXISTS bid_scores (id SERIAL PRIMARY KEY, user_id TEXT NOT NULL, bid_id INTEGER NOT NULL REFERENCES bids(id), win_probability INTEGER NOT NULL, competition_level TEXT NOT NULL, agency_sentiment TEXT NOT NULL, size_fit TEXT NOT NULL DEFAULT '', experience_match TEXT NOT NULL, similar_awards_note TEXT NOT NULL DEFAULT '', ai_explanation TEXT NOT NULL, generated_at TIMESTAMPTZ DEFAULT NOW(), UNIQUE(user_id, bid_id))`;
      await sql()`CREATE TABLE IF NOT EXISTS bid_recommendations (id SERIAL PRIMARY KEY, user_email TEXT NOT NULL, bid_id TEXT NOT NULL, bid_title TEXT NOT NULL, win_probability INTEGER, effort_level TEXT DEFAULT 'medium', competition_level TEXT DEFAULT 'medium', strategic_fit TEXT DEFAULT 'moderate', recommendation TEXT DEFAULT 'CAUTIOUS', summary TEXT DEFAULT '', factors JSONB DEFAULT '[]'::jsonb, created_at TIMESTAMPTZ DEFAULT NOW(), UNIQUE(user_email, bid_id))`;
      const rows = await sql()`
        SELECT COUNT(DISTINCT b.id)::int AS count
        FROM bids b
        LEFT JOIN bid_scores bs ON bs.bid_id = b.id AND bs.user_id = ${user.id}
        LEFT JOIN bid_recommendations br ON br.bid_id = b.id::text AND br.user_email = ${user.email}
        WHERE bs.bid_id IS NOT NULL OR br.bid_id IS NOT NULL`;
      stats.activeBids = Number((rows[0] as { count: number }).count || 0);
    } catch { /* tables not available yet */ }

    try {
      const patterns = await getUserPatterns(user.email);
      stats.winRate = patterns.winRate;
    } catch { /* no learning data */ }

    try {
      const rows = await sql()`
        SELECT COUNT(*)::int AS count FROM knowledge_documents
        WHERE is_public = true OR user_id = ${user.id}`;
      stats.knowledgeDocs = Number((rows[0] as { count: number }).count || 0);
    } catch { /* knowledge table not available yet */ }

    return stats;
  },
);

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
    loadHistory()
      .then((res) => {
        setMessages(res);
        setHistoryLoaded(true);
      })
      .catch(() => setHistoryLoaded(true));
    getCopilotStats().then(setStats).catch(() => {});
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
      const res = await sendMessage({ data: { message: msg } });
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
