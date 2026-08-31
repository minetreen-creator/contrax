import { createFileRoute, redirect } from "@tanstack/react-router";
import { useState, useEffect, useRef, useCallback } from "react";
import { getCurrentUser } from "~/lib/auth";

/**
 * Contrax Jarvis V1 — admin-only, read-only grounded executive assistant.
 *
 * Owner-approved scope (2026-08-31): an internal Executive Operating Assistant
 * for the owner/CEO — NOT customer-facing. Voice = PUSH-TO-TALK (Web Speech
 * API), answers read back via SpeechSynthesis (en-GB first, else a clear
 * English voice, cancellable). Text input fallback included. Chat history is
 * kept client-side only (in-memory + sessionStorage) — nothing is stored in the
 * DB in V1. The API is POST /api/jarvis (admin-gated server-side too).
 */

interface ChatMsg {
  role: "user" | "assistant";
  text: string;
  sources?: string[];
  grounded?: boolean;
  time: number;
}

interface JarvisResult {
  answer: string;
  sources?: string[];
  grounded?: boolean;
}

const SESSION_KEY = "jarvis-history-v1";

type SpeechRecognitionLike = {
  lang: string;
  interimResults: boolean;
  maxAlternatives: number;
  continuous: boolean;
  onresult: ((e: { results: ArrayLike<ArrayLike<{ transcript: string }>> }) => void) | null;
  onerror: ((e: { error?: string }) => void) | null;
  onend: (() => void) | null;
  start: () => void;
  stop: () => void;
  abort: () => void;
};

function getSpeechRecognition(): SpeechRecognitionLike | null {
  if (typeof window === "undefined") return null;
  const w = window as unknown as Record<string, unknown>;
  const Ctor = (w.SpeechRecognition ?? w.webkitSpeechRecognition) as
    | (new () => SpeechRecognitionLike)
    | undefined;
  return Ctor ? new Ctor() : null;
}

function pickVoice(enGbFirst: boolean): SpeechSynthesisVoice | null {
  if (typeof speechSynthesis === "undefined") return null;
  const voices = speechSynthesis.getVoices();
  if (!voices.length) return null;
  const enGb = voices.find((v) => v.lang.toLowerCase().startsWith("en-gb"));
  const clearEn = voices.find(
    (v) => v.lang.toLowerCase() === "en-us" && /natural|google us english|samantha|aria/i.test(v.name),
  );
  const anyEn = voices.find((v) => v.lang.toLowerCase().startsWith("en"));
  return (enGbFirst ? enGb : null) ?? clearEn ?? anyEn ?? null;
}

function speak(text: string): () => void {
  if (typeof speechSynthesis === "undefined") return () => {};
  speechSynthesis.cancel();
  const utterance = new SpeechSynthesisUtterance(text);
  const voice = pickVoice(true); // prefer en-GB, then clear English
  if (voice) utterance.voice = voice;
  utterance.rate = 1.02;
  utterance.pitch = 1;
  speechSynthesis.speak(utterance);
  return () => speechSynthesis.cancel();
}

async function askJarvis(question: string): Promise<JarvisResult> {
  const res = await fetch("/api/jarvis", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ question }),
  });
  if (!res.ok) {
    const err = (await res.json().catch(() => ({}))) as { error?: string };
    throw new Error(err.error || "Jarvis request failed");
  }
  return res.json();
}

function formatTime(ms: number): string {
  return new Date(ms).toLocaleString("en-US", { hour: "numeric", minute: "2-digit" });
}

export const Route = createFileRoute("/jarvis")({
  loader: async () => {
    const user = await getCurrentUser();
    if (!user) throw redirect({ to: "/login" });
    if (!user.is_admin) throw redirect({ href: "/dashboard?notice=admin-only" });
    return { user };
  },
  component: JarvisPage,
  head: () => ({
    meta: [
      { name: "robots", content: "noindex, nofollow" },
      { title: "Jarvis | Contrax" },
    ],
  }),
});

function JarvisPage() {
  const [messages, setMessages] = useState<ChatMsg[]>([]);
  const [input, setInput] = useState("");
  const [thinking, setThinking] = useState(false);
  const [listening, setListening] = useState(false);
  const [speaking, setSpeaking] = useState(false);
  const [speechSupported] = useState(() => getSpeechRecognition() !== null);
  const [error, setError] = useState("");

  const recognitionRef = useRef<SpeechRecognitionLike | null>(null);
  const cancelSpeechRef = useRef<(() => void) | null>(null);
  const scrollRef = useRef<HTMLDivElement | null>(null);

  // Restore client-side history (sessionStorage only — never the DB).
  useEffect(() => {
    try {
      const raw = sessionStorage.getItem(SESSION_KEY);
      if (raw) {
        const parsed = JSON.parse(raw) as ChatMsg[];
        if (Array.isArray(parsed)) setMessages(parsed.slice(-50));
      }
    } catch {
      /* sessionStorage unavailable — start empty */
    }
  }, []);

  const push = useCallback((msg: ChatMsg) => {
    setMessages((prev) => {
      const next = [...prev, msg].slice(-50);
      try {
        sessionStorage.setItem(SESSION_KEY, JSON.stringify(next));
      } catch {
        /* best-effort */
      }
      return next;
    });
  }, []);

  useEffect(() => {
    if (scrollRef.current) scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
  }, [messages, thinking]);

  // Preload voice list (some browsers populate it async).
  useEffect(() => {
    if (typeof speechSynthesis !== "undefined") {
      speechSynthesis.getVoices();
      const onVoices = () => speechSynthesis.getVoices();
      speechSynthesis.addEventListener?.("voiceschanged", onVoices);
      return () => speechSynthesis.removeEventListener?.("voiceschanged", onVoices);
    }
  }, []);

  const stopSpeaking = useCallback(() => {
    cancelSpeechRef.current?.();
    cancelSpeechRef.current = null;
    if (typeof speechSynthesis !== "undefined") speechSynthesis.cancel();
    setSpeaking(false);
  }, []);

  const sendQuestion = useCallback(
    async (raw: string) => {
      const question = raw.trim();
      if (!question || thinking) return;
      setError("");
      setInput("");
      stopSpeaking();
      push({ role: "user", text: question, time: Date.now() });
      setThinking(true);
      try {
        const res = await askJarvis(question);
        push({
          role: "assistant",
          text: res.answer,
          sources: res.sources,
          grounded: res.grounded,
          time: Date.now(),
        });
        // Speak the answer back (push-to-talk style feedback loop), keeping the
        // cancel handle so 🔇 Stop can cut speech off mid-sentence.
        cancelSpeechRef.current = speak(res.answer.replace(/[•\n]+/g, " ").slice(0, 600));
        setSpeaking(true);
        const poll = window.setInterval(() => {
          if (typeof speechSynthesis === "undefined" || !speechSynthesis.speaking) {
            window.clearInterval(poll);
            cancelSpeechRef.current = null;
            setSpeaking(false);
          }
        }, 300);
      } catch (err) {
        setError(err instanceof Error ? err.message : "Something went wrong asking Jarvis.");
        push({
          role: "assistant",
          text: err instanceof Error ? err.message : "Something went wrong asking Jarvis.",
          time: Date.now(),
        });
      } finally {
        setThinking(false);
      }
    },
    [thinking, push, stopSpeaking],
  );

  // ── Push-to-talk ─────────────────────────────────────────────────────────
  const startListening = useCallback(() => {
    if (listening || thinking) return;
    stopSpeaking();
    const rec = getSpeechRecognition();
    if (!rec) return;
    rec.lang = "en-US";
    rec.interimResults = false;
    rec.maxAlternatives = 1;
    rec.continuous = false;
    rec.onresult = (e) => {
      const transcript = e.results[0]?.[0]?.transcript ?? "";
      if (transcript.trim()) void sendQuestion(transcript);
    };
    rec.onerror = () => setListening(false);
    rec.onend = () => setListening(false);
    recognitionRef.current = rec;
    try {
      rec.start();
      setListening(true);
    } catch {
      setListening(false);
    }
  }, [listening, thinking, stopSpeaking, sendQuestion]);

  const stopListening = useCallback(() => {
    recognitionRef.current?.abort();
    recognitionRef.current = null;
    setListening(false);
  }, []);

  const clearChat = useCallback(() => {
    stopSpeaking();
    setMessages([]);
    try {
      sessionStorage.removeItem(SESSION_KEY);
    } catch {
      /* ignore */
    }
  }, [stopSpeaking, setMessages]);

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100">
      <header className="border-b border-slate-800 bg-slate-950 sticky top-0 z-10">
        <div className="mx-auto max-w-4xl px-4 py-3 flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <a href="/" className="inline-flex items-center gap-2">
              <img src="/logo.png" alt="Contrax" className="h-8 w-auto rounded" />
            </a>
            <span className="text-sm font-bold tracking-wide text-slate-100">JARVIS</span>
            <span className="rounded-full bg-amber-500/15 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-amber-400">
              Admin only
            </span>
          </div>
          <div className="flex items-center gap-3">
            <span className="hidden sm:inline text-[10px] text-slate-500">
              Read-only · grounded in real data · 30 msg/hr
            </span>
            <a href="/admin" className="text-xs font-medium text-slate-400 hover:text-slate-200">
              Admin Dashboard &rarr;
            </a>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-4xl px-4 py-6">
        <div className="mb-5">
          <h1 className="text-xl font-bold text-white">
            Executive Operating Assistant
          </h1>
          <p className="mt-1 text-sm text-slate-400">
            Ask about today's activity, signups, high-intent visitors, closing opportunities, or
            outreach. Every answer is built from live queries of the platform's data — Jarvis never
            invents numbers, and it is read-only.
          </p>
        </div>

        {/* Chat transcript */}
        <div
          ref={scrollRef}
          className="h-[46vh] min-h-[280px] overflow-y-auto rounded-2xl border border-slate-800 bg-slate-900/60 p-4 space-y-3"
        >
          {messages.length === 0 && !thinking && (
            <div className="flex h-full items-center justify-center">
              <div className="text-center">
                <p className="text-3xl">🎙️</p>
                <p className="mt-2 text-sm font-medium text-slate-300">Tap the mic and ask, or type below.</p>
                <p className="mt-1 text-xs text-slate-500">
                  e.g. “Why aren't people signing up?” · “What HVAC opportunities are closing soon?” · “What should I focus on today?”
                </p>
              </div>
            </div>
          )}
          {messages.map((m, i) => (
            <div key={i} className={`flex ${m.role === "user" ? "justify-end" : "justify-start"}`}>
              <div
                className={`max-w-[85%] rounded-2xl px-4 py-2.5 text-sm leading-relaxed ${
                  m.role === "user"
                    ? "bg-cyan-500/15 text-cyan-100 border border-cyan-500/20"
                    : "bg-slate-800/80 text-slate-100 border border-slate-700/60"
                }`}
              >
                <p className="whitespace-pre-wrap">{m.text}</p>
                {m.role === "assistant" && (m.grounded || (m.sources && m.sources.length > 0)) && (
                  <p className="mt-2 border-t border-slate-700 pt-1.5 text-[10px] text-slate-400">
                    {m.grounded && <span className="text-emerald-400 font-medium">✓ grounded in real data</span>}
                    {m.sources && m.sources.length > 0 && (
                      <span> · {m.sources.join(" · ")}</span>
                    )}
                  </p>
                )}
                <p className="mt-1 text-[9px] text-slate-500">{formatTime(m.time)}</p>
              </div>
            </div>
          ))}
          {thinking && (
            <div className="flex justify-start">
              <div className="rounded-2xl border border-slate-700/60 bg-slate-800/80 px-4 py-2.5 text-sm text-slate-300">
                <span className="inline-flex items-center gap-1.5">
                  <span className="h-2 w-2 animate-pulse rounded-full bg-cyan-400" />
                  Retrieving live data…
                </span>
              </div>
            </div>
          )}
        </div>

        {error && (
          <p className="mt-2 rounded-xl border border-red-500/30 bg-red-500/10 px-3 py-2 text-xs text-red-300">
            {error}
          </p>
        )}

        {/* Controls */}
        <div className="mt-4 flex items-center gap-2">
          {listening ? (
            <button
              type="button"
              onClick={stopListening}
              className="inline-flex items-center gap-2 rounded-full bg-red-500/20 px-4 py-2.5 text-sm font-semibold text-red-300 border border-red-500/40 animate-pulse"
            >
              <span className="text-base">●</span> Listening… tap to stop
            </button>
          ) : (
            <button
              type="button"
              onClick={startListening}
              disabled={!speechSupported || thinking}
              title={speechSupported ? "Push to talk — speak your question" : "Speech recognition not supported in this browser"}
              className="inline-flex items-center gap-2 rounded-full bg-cyan-500/15 px-4 py-2.5 text-sm font-semibold text-cyan-300 border border-cyan-500/30 hover:bg-cyan-500/25 disabled:opacity-40"
            >
              🎙️ Push to talk
            </button>
          )}
          <input
            type="text"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter") void sendQuestion(input); }}
            placeholder="Ask Jarvis…"
            className="min-w-0 flex-1 rounded-xl border border-slate-700 bg-slate-900 px-4 py-2.5 text-sm text-slate-100 placeholder:text-slate-600 focus:border-cyan-500/50 focus:outline-none"
            aria-label="Question for Jarvis"
          />
          <button
            type="button"
            onClick={() => void sendQuestion(input)}
            disabled={thinking || !input.trim()}
            className="inline-flex items-center rounded-xl bg-cyan-500 px-4 py-2.5 text-sm font-semibold text-slate-950 hover:bg-cyan-400 disabled:opacity-40"
          >
            Send
          </button>
          {speaking ? (
            <button
              type="button"
              onClick={stopSpeaking}
              title="Stop reading the answer"
              className="inline-flex items-center gap-1 rounded-xl border border-red-500/40 bg-red-500/15 px-3 py-2.5 text-sm font-medium text-red-300 hover:bg-red-500/25"
            >
              🔇 Stop
            </button>
          ) : (
            <button
              type="button"
              onClick={clearChat}
              title="Clear this conversation (stored only in this browser tab)"
              className="rounded-xl border border-slate-700 px-3 py-2.5 text-sm text-slate-400 hover:text-slate-200"
            >
              Clear
            </button>
          )}
        </div>

        <p className="mt-3 text-[10px] text-slate-600">
          V1 is <strong className="text-slate-400">read-only</strong> and admin-gated: Jarvis can inspect analytics, visitors, users,
          bids and outreach data, but cannot send emails, change plans, or modify records. Conversation history lives only in this
          browser tab (sessionStorage). Voice uses your browser's speech tools and a British-English voice when available.
        </p>
      </main>
    </div>
  );
}