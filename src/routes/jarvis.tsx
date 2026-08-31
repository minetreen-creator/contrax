import { createFileRoute, redirect } from "@tanstack/react-router";
import { useState, useEffect, useRef, useCallback } from "react";
import { getCurrentUser } from "~/lib/auth";

/**
 * Contrax Jarvis — admin-only, read-only grounded executive assistant.
 *
 * VOICE MODEL (owner choice 2026-08-31): WAKE-WORD, not push-to-talk.
 *   - Voice is a conscious opt-in: the owner clicks "Enable voice" before the
 *     mic turns on. It is NEVER enabled automatically on load.
 *   - Once enabled, the browser Web Speech API runs in CONTINUOUS mode in an
 *     idle/"armed" state that watches the interim transcript for the wake word
 *     "Jarvis".
 *   - On the wake word, Jarvis arms a capture state that takes the NEXT speech
 *     after the wake word as the question. The wake word itself is never sent
 *     to /api/jarvis — it is stripped from the transcript before any question
 *     is submitted (see extractAfterWake + the armed/capture handlers).
 *   - The answer is read back via SpeechSynthesis (en-GB first, else a clear
 *     English voice), cancellable with the 🔇 Stop button.
 *
 * HONESTY (owner aware): this is not true always-on background keyword
 *   spotting — it is the Web Speech API running continuously in this tab while
 *   armed. The mic is genuinely active while listening and may pick up ambient
 *   speech; interim results are discarded until the wake word appears. The UI
 *   says so visibly. Text input remains a first-class fallback.
 *
 * BACKEND UNCHANGED: POST /api/jarvis + lib/jarvis readers are untouched. This
 *   file only changes the voice capture UI. Chat history stays client-side only
 *   (in-memory + sessionStorage) — never the DB.
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
const WAKE_WORD = "jarvis";

type VoicePhase = "off" | "armed" | "capture" | "speaking";

// ── Web Speech API types (browser-only; wrapped defensively) ──────────────
type SRAlt = { transcript: string; confidence?: number };
type SRResult = { isFinal: boolean; length: number; [index: number]: SRAlt };

type SpeechRecognitionLike = {
  lang: string;
  interimResults: boolean;
  maxAlternatives: number;
  continuous: boolean;
  onresult: ((e: { results: ArrayLike<SRResult> }) => void) | null;
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

/**
 * Given a transcript, return whether it contains the wake word and, if so, the
 * text AFTER it (with leading punctuation/space stripped). Everything up to and
 * including the wake word is discarded — this is precisely how we guarantee the
 * wake word itself is never re-sent as the question.
 */
function extractAfterWake(transcript: string): { hasWake: boolean; after: string } {
  const idx = transcript.toLowerCase().indexOf(WAKE_WORD);
  if (idx === -1) return { hasWake: false, after: "" };
  let after = transcript.slice(idx + WAKE_WORD.length);
  after = after.replace(/^[\s,.:;!?'"\-—–]+/, "");
  return { hasWake: true, after };
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
  const [speaking, setSpeaking] = useState(false);
  const [voicePhase, setVoicePhase] = useState<VoicePhase>("off");
  const [speechSupported] = useState(() => getSpeechRecognition() !== null);
  const [error, setError] = useState("");

  const recognitionRef = useRef<SpeechRecognitionLike | null>(null);
  const cancelSpeechRef = useRef<(() => void) | null>(null);
  const scrollRef = useRef<HTMLDivElement | null>(null);

  // Wake-word state (refs so the long-lived recognition callbacks read fresh
  // values without stale closures).
  const phaseRef = useRef<VoicePhase>("off");
  const shouldRunRef = useRef(false); // true while the owner has voice enabled
  const pendingQuestionRef = useRef(""); // text captured after the wake word

  const sendQuestionRef = useRef<
    ((raw: string) => Promise<void>) | null
  >(null);

  const setPhase = useCallback((p: VoicePhase) => {
    phaseRef.current = p;
    setVoicePhase(p);
  }, []);

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

  // Keep the mic + listening off when the component unmounts.
  useEffect(() => {
    const rec = recognitionRef.current;
    return () => {
      shouldRunRef.current = false;
      rec?.abort();
      if (typeof speechSynthesis !== "undefined") speechSynthesis.cancel();
    };
  }, []);

  const stopSpeaking = useCallback(() => {
    cancelSpeechRef.current?.();
    cancelSpeechRef.current = null;
    if (typeof speechSynthesis !== "undefined") speechSynthesis.cancel();
    setSpeaking(false);
  }, []);

  // ── Wake-word voice ─────────────────────────────────────────────────────
  // Turn the mic + listening completely off (owner opt-out).
  const disableVoice = useCallback(() => {
    shouldRunRef.current = false;
    pendingQuestionRef.current = "";
    recognitionRef.current?.abort();
    recognitionRef.current = null;
    setPhase("off");
  }, [setPhase]);

  // Wire the shared handlers onto a recognition instance. Used both on initial
  // enable and on every re-arm after speech, so the armed/capture/wake-word
  // handling is identical on both paths.
  const wireRecognition = useCallback(
    (rec: SpeechRecognitionLike) => {
      rec.lang = "en-US";
      rec.interimResults = true; // needed to catch the wake word as it is spoken
      rec.maxAlternatives = 1;
      rec.continuous = true; // stay armed across many utterances

      rec.onresult = (e) => {
        const last = e.results[e.results.length - 1];
        if (!last || !last[0]) return;
        const transcript = last[0].transcript ?? "";
        const isFinal = !!last.isFinal;
        const { hasWake, after } = extractAfterWake(transcript);
        const ph = phaseRef.current;

        if (ph === "armed") {
          if (hasWake) {
            // Wake word heard — capture what follows as the question.
            pendingQuestionRef.current = after;
            setPhase("capture");
            if (after.trim() && isFinal) {
              // Whole "Jarvis + question" landed as one finalized utterance.
              const q = after.trim();
              pendingQuestionRef.current = "";
              setPhase("armed");
              void sendQuestionRef.current?.(q);
            }
            // else remain in "capture" awaiting the next utterance.
          }
          // No wake word → interim discarded, keep listening (never sent).
        } else if (ph === "capture") {
          // Accumulate the trailing text. If the question is a new utterance that
          // does not repeat the wake word, treat the whole transcript as content;
          // otherwise keep only what follows the wake word.
          const candidate = hasWake ? after : transcript;
          if (candidate.length >= pendingQuestionRef.current.length) {
            pendingQuestionRef.current = candidate;
          }
          if (isFinal) {
            const q = pendingQuestionRef.current.trim();
            pendingQuestionRef.current = "";
            // Only a non-empty question gets sent AND returns us to idle/armed.
            // If the wake word fired with no follow-up (e.g. a lone "Jarvis"
            // finalized, or an empty next utterance), STAY in capture so the
            // next utterance is picked up as the question — never re-arm and
            // discard it, and never send the wake word itself.
            if (q) {
              setPhase("armed");
              void sendQuestionRef.current?.(q);
            } else {
              setPhase("capture");
            }
          } else {
            setPhase("capture");
          }
        }
      };

      rec.onerror = (e) => {
        // no-speech / aborted are routine; only hard failures turn the mic off.
        if (e.error === "not-allowed" || e.error === "service-not-allowed") {
          setError("Microphone permission denied — type your question instead, or allow the mic and Enable voice again.");
          disableVoice();
        } else if (e.error !== "no-speech" && e.error !== "aborted") {
          disableVoice();
        }
      };

      rec.onend = () => {
        // If voice is still meant to be on AND we're not paused while Jarvis is
        // reading its answer, restart to stay armed (Web Speech can end a segment
        // after a pause). While speaking (phase "speaking") we deliberately keep
        // the mic off so Jarvis can't trigger on its own TTS output — re-arming
        // happens explicitly in rearmForSpeech once the answer stops playing.
        if (!shouldRunRef.current || phaseRef.current === "off") {
          recognitionRef.current = null;
          setPhase("off");
          return;
        }
        // Only the currently-attached instance may self-restart; a stale instance
        // that ended during a speech pause must not resurrect itself after we've
        // already re-armed a fresh one.
        if (phaseRef.current !== "speaking" && recognitionRef.current === rec) {
          try {
            rec.start();
          } catch {
            /* recognition may be mid-restart — safe to ignore */
          }
        }
      };

      return rec;
    },
    [setPhase, disableVoice],
  );

  // Conscious opt-in: the owner clicks "Enable voice" before the mic turns on.
  const enableVoice = useCallback(() => {
    if (voicePhase !== "off" || thinking) return;
    stopSpeaking();
    const rec = getSpeechRecognition();
    if (!rec) {
      setError("Speech recognition is not supported in this browser. Type your question instead.");
      return;
    }

    wireRecognition(rec);
    recognitionRef.current = rec;
    shouldRunRef.current = true;
    pendingQuestionRef.current = "";
    try {
      rec.start();
      setPhase("armed");
    } catch {
      setError("Could not start the microphone. Type your question instead.");
      disableVoice();
    }
  }, [voicePhase, thinking, stopSpeaking, setPhase, disableVoice, wireRecognition]);

  // Re-arm recognition after Jarvis finishes speaking, so the owner can say the
  // wake word again without re-clicking Enable. No-op if voice was already off
  // (owner disabled it) — we never re-enable the mic behind their back.
  const rearmForSpeech = useCallback(() => {
    if (!shouldRunRef.current) return;
    const rec = getSpeechRecognition();
    if (!rec) {
      setPhase("off");
      return;
    }
    wireRecognition(rec);
    recognitionRef.current = rec;
    try {
      rec.start();
      setPhase("armed");
    } catch {
      setError("Could not restore the microphone after speaking. Type your question instead.");
      disableVoice();
    }
  }, [setPhase, disableVoice, wireRecognition]);

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
        // Pause recognition while the answer is read aloud so Jarvis can't hear
        // (and trigger on) its own TTS output — owner criterion (5) "Recognition
        // pauses while TTS is speaking". If voice is already off this is a no-op.
        if (shouldRunRef.current) {
          setPhase("speaking");
          recognitionRef.current?.abort();
          // Detach the paused instance so its (async) onend can't resurrect
          // itself once we re-arm a fresh one in rearmForSpeech.
          recognitionRef.current = null;
        }
        // Speak the answer back (wake-word feedback loop), keeping the cancel
        // handle so 🔇 Stop can cut speech off mid-sentence.
        cancelSpeechRef.current = speak(res.answer.replace(/[•\n]+/g, " ").slice(0, 600));
        setSpeaking(true);
        const poll = window.setInterval(() => {
          if (typeof speechSynthesis === "undefined" || !speechSynthesis.speaking) {
            window.clearInterval(poll);
            cancelSpeechRef.current = null;
            setSpeaking(false);
            // Speech done → automatically re-arm recognition (owner criterion (6)
            // "After speaking, recognition automatically re-arms"). No-op if the
            // owner disabled voice while we were reading.
            rearmForSpeech();
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
    [thinking, push, stopSpeaking, rearmForSpeech],
  );
  sendQuestionRef.current = sendQuestion;

  const clearChat = useCallback(() => {
    stopSpeaking();
    setMessages([]);
    try {
      sessionStorage.removeItem(SESSION_KEY);
    } catch {
      /* ignore */
    }
  }, [stopSpeaking, setMessages]);

  // Voice enabled (armed or capture) → show the armed-listening affordance.
  const voiceArmed = voicePhase !== "off";

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

        {/* Wake-word status banner */}
        {voiceArmed && (
          <div
            className={`mb-4 flex items-center gap-2.5 rounded-xl border px-3 py-2 text-sm ${
              voicePhase === "capture"
                ? "border-cyan-500/50 bg-cyan-500/15 text-cyan-200"
                : voicePhase === "speaking"
                  ? "border-emerald-500/40 bg-emerald-500/10 text-emerald-200"
                  : "border-amber-500/40 bg-amber-500/10 text-amber-200"
            }`}
          >
            <span className={`inline-block h-2.5 w-2.5 rounded-full ${voicePhase === "capture" ? "bg-cyan-400" : voicePhase === "speaking" ? "bg-emerald-400" : "bg-amber-400 animate-pulse"}`} />
            <span>
              {voicePhase === "armed"
                ? <>Listening for <strong className="font-semibold">“Jarvis”</strong>…</>
                : voicePhase === "capture"
                  ? <>Heard you. <strong className="font-semibold">Ask your question…</strong></>
                  : <strong className="font-semibold">Speaking…</strong>}
            </span>
            <button
              type="button"
              onClick={() => disableVoice()}
              title="Turn the microphone and listening off"
              className="ml-auto inline-flex items-center gap-1 rounded-lg border border-red-500/40 bg-red-500/15 px-2.5 py-1 text-xs font-semibold text-red-300 hover:bg-red-500/25"
            >
              ● Disable
            </button>
          </div>
        )}

        {/* Chat transcript */}
        <div
          ref={scrollRef}
          className="h-[46vh] min-h-[280px] overflow-y-auto rounded-2xl border border-slate-800 bg-slate-900/60 p-4 space-y-3"
        >
          {messages.length === 0 && !thinking && (
            <div className="flex h-full items-center justify-center">
              <div className="text-center max-w-md">
                <p className="text-3xl">🎙️</p>
                <p className="mt-2 text-sm font-medium text-slate-300">Enable voice, say “Jarvis”, then your question — or type below.</p>
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
        <div className="mt-4 flex flex-wrap items-center gap-2">
          {!voiceArmed ? (
            <button
              type="button"
              onClick={enableVoice}
              disabled={!speechSupported || thinking}
              title={
                speechSupported
                  ? "Enable voice — say “Jarvis”, then your question (no need to press a button)"
                  : "Speech recognition not supported in this browser"
              }
              className="inline-flex items-center gap-2 rounded-full bg-cyan-500/15 px-4 py-2.5 text-sm font-semibold text-cyan-300 border border-cyan-500/30 hover:bg-cyan-500/25 disabled:opacity-40"
            >
              🎙️ Enable voice <span className="hidden sm:inline text-xs font-normal text-cyan-400/70">(wake word “Jarvis”)</span>
            </button>
          ) : (
            <span className="inline-flex items-center gap-2 rounded-full bg-slate-800 px-4 py-2.5 text-sm text-slate-300 border border-slate-700">
              <span className="text-base">🎙️</span>{" "}
              {voicePhase === "armed"
                ? "Listening for “Jarvis”…"
                : voicePhase === "capture"
                  ? "Listening…"
                  : "Speaking…"}
            </span>
          )}
          <input
            type="text"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter") void sendQuestion(input); }}
            placeholder="Type a question (optional)…"
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
          <strong className="text-slate-400">Voice:</strong> enable it once, then just say
          <em className="text-slate-400 not-italic"> “Jarvis, …”</em> and ask — no button press needed.
          While listening, the microphone is active in this tab and may pick up ambient speech; only
          audio after the word “Jarvis” is used as your question, everything else is discarded. This is
          in-tab continuous listening, not always-on background listening. The mic pauses while
          Jarvis reads its answer (so it can't trigger on its own voice) and re-arms automatically
          when it finishes. Answers are read aloud in a
          British-English voice when available and can be stopped with 🔇 Stop.
        </p>
        <p className="mt-1 text-[10px] text-slate-600">
          V1 is <strong className="text-slate-400">read-only</strong> and admin-gated: Jarvis can inspect analytics, visitors, users,
          bids and outreach data, but cannot send emails, change plans, or modify records. Conversation history lives only in this
          browser tab (sessionStorage).
        </p>
      </main>
    </div>
  );
}
