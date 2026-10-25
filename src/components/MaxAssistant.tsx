import { useEffect, useRef, useState } from "react";
import { KONAMI, maxEasterEgg, type MaxCta, type MaxEffect } from "~/lib/max";
import { trackEvent } from "~/lib/track";
import { trackingIds } from "~/lib/visitor";
import { markEmailGiven } from "~/lib/return-visitor";

/**
 * Max on the homepage (src/lib/max.ts): ask out loud or type, Max searches live
 * Contrax data (/api/max/ask), answers in his own voice (/api/max/voice), and
 * shows the real bids. Secret phrases trigger effects (maxEasterEgg).
 */

interface BidCard {
  id: number;
  title: string;
  agency: string | null;
  location: string | null;
  due: string | null;
  setAside: string | null;
}
interface Turn {
  role: "user" | "assistant";
  content: string;
}
type MaxState = "idle" | "listening" | "thinking" | "speaking";

type Recognizer = {
  lang: string;
  interimResults: boolean;
  continuous: boolean;
  onresult: ((e: { results: ArrayLike<ArrayLike<{ transcript: string }>> }) => void) | null;
  onerror: ((e: { error: string }) => void) | null;
  onend: (() => void) | null;
  start: () => void;
  stop: () => void;
};
function makeRecognizer(): Recognizer | null {
  if (typeof window === "undefined") return null;
  const W = window as unknown as { SpeechRecognition?: new () => Recognizer; webkitSpeechRecognition?: new () => Recognizer };
  const C = W.SpeechRecognition ?? W.webkitSpeechRecognition;
  if (!C) return null;
  const r = new C();
  r.lang = "en-US";
  r.interimResults = false;
  r.continuous = false;
  return r;
}

const SUGGESTIONS = [
  "Any cleaning contracts in Virginia?",
  "Who's winning construction work in Texas?",
  "Industry days in South Carolina?",
  "How do I get started with government contracts?",
];

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function dueLabel(d: string | null): string {
  if (!d) return "";
  return `Due ${new Date(`${d}T12:00:00Z`).toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" })}`;
}

export function MaxAssistant() {
  const [state, setState] = useState<MaxState>("idle");
  const [turns, setTurns] = useState<Turn[]>([]);
  const [bids, setBids] = useState<BidCard[]>([]);
  const [cta, setCta] = useState<{ kind: MaxCta; trade: string | null; state: string | null }>({ kind: null, trade: null, state: null });
  const [typed, setTyped] = useState("");
  const [voiceOn, setVoiceOn] = useState(true);
  const [hasMic, setHasMic] = useState(false);
  const [effect, setEffect] = useState<MaxEffect>(null);
  const [note, setNote] = useState("");
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const busy = useRef(false);
  const turnsRef = useRef<Turn[]>([]);
  turnsRef.current = turns;

  useEffect(() => setHasMic(!!makeRecognizer()), []);

  const fire = (fx: MaxEffect) => {
    if (!fx) return;
    setEffect(fx);
    window.setTimeout(() => setEffect(null), fx === "money" || fx === "konami" ? 4200 : 2200);
  };

  // Konami code anywhere on the page.
  useEffect(() => {
    let i = 0;
    const onKey = (e: KeyboardEvent) => {
      const k = e.key.length === 1 ? e.key.toLowerCase() : e.key;
      i = k === KONAMI[i] ? i + 1 : k === KONAMI[0] ? 1 : 0;
      if (i === KONAMI.length) {
        i = 0;
        trackEvent("max_easter_egg", "konami");
        fire("konami");
        setTurns((t) => [...t, { role: "assistant" as const, content: "Cheat code accepted! Thirty extra lives... and a head start on government contracts." }].slice(-8));
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const stopSpeaking = () => {
    audioRef.current?.pause();
    if ("speechSynthesis" in window) window.speechSynthesis.cancel();
  };

  const speakBrowser = (text: string) =>
    new Promise<void>((done) => {
      if (!("speechSynthesis" in window)) return done();
      const u = new SpeechSynthesisUtterance(text);
      const v = window.speechSynthesis.getVoices().find((x) => x.lang === "en-US");
      if (v) u.voice = v;
      u.onend = u.onerror = () => done();
      window.speechSynthesis.speak(u);
    });

  const speak = async (text: string) => {
    if (!voiceOn) return;
    stopSpeaking();
    setState("speaking");
    let src = "";
    try {
      const res = await fetch("/api/max/voice", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ text }) });
      if (res.ok) src = URL.createObjectURL(await res.blob());
    } catch {
      /* fall back */
    }
    if (!src) return speakBrowser(text);
    const audio = new Audio(src);
    audioRef.current = audio;
    await new Promise<void>((done) => {
      const end = () => {
        URL.revokeObjectURL(src);
        done();
      };
      audio.onended = audio.onerror = audio.onpause = end;
      audio.play().catch(() => {
        audio.onended = audio.onerror = audio.onpause = null;
        URL.revokeObjectURL(src);
        speakBrowser(text).then(done);
      });
    });
  };

  const ask = async (question: string) => {
    const q = question.trim().slice(0, 300);
    if (!q || busy.current) return;
    busy.current = true;
    setNote("");
    const history = turnsRef.current.slice(-8);
    setTurns((t) => [...t, { role: "user" as const, content: q }].slice(-8));
    try {
      const egg = maxEasterEgg(q);
      if (egg) {
        trackEvent("max_easter_egg", egg.effect ?? q.slice(0, 30));
        fire(egg.effect);
        setTurns((t) => [...t, { role: "assistant" as const, content: egg.say }].slice(-8));
        await speak(egg.say);
        return;
      }
      trackEvent("max_ask", q.slice(0, 80));
      setState("thinking");
      const res = await fetch("/api/max/ask", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ question: q, history }) });
      const j = (await res.json().catch(() => ({}))) as { say?: string; error?: string; bids?: BidCard[]; cta?: MaxCta; trade?: string | null; state?: string | null };
      const say = j.say ?? (res.status === 429 ? "I've answered a lot of questions for you today. Search Contract Radar for the full list, or come back in a little while." : j.error ?? "Sorry, something went wrong.");
      setTurns((t) => [...t, { role: "assistant" as const, content: say }].slice(-8));
      if (j.bids?.length) setBids(j.bids.slice(0, 4));
      setCta({ kind: j.cta ?? null, trade: j.trade ?? null, state: j.state ?? null });
      await speak(say);
    } catch {
      setNote("I couldn't connect. Check your internet and try again.");
    } finally {
      busy.current = false;
      setState("idle");
    }
  };

  const listen = () => {
    if (state === "speaking") return stopSpeaking();
    if (busy.current) return;
    const r = makeRecognizer();
    if (!r) {
      setNote("Voice works in Chrome, Edge and Safari. You can type below.");
      return;
    }
    let heard = "";
    r.onresult = (e) => {
      heard = Array.from(e.results).map((x) => x[0].transcript).join(" ");
    };
    r.onerror = (e) => e.error === "not-allowed" && setNote("Allow the microphone to talk to Max, or type below.");
    r.onend = () => {
      setState("idle");
      if (heard.trim()) ask(heard);
    };
    setState("listening");
    trackEvent("max_mic", "start");
    try {
      r.start();
    } catch {
      setState("idle");
    }
  };

  const last = turns.slice(-4);
  const label = { idle: hasMic ? "Tap the core to talk, or type" : "Type a question", listening: "Listening…", thinking: "Searching live government data…", speaking: "Speaking… tap to stop" }[state];

  return (
    <section aria-label="Ask Max, the Contrax AI" className={`max-wrap fx-${effect ?? "none"} relative overflow-hidden bg-[#050d1f] px-4 py-14 text-white sm:px-8`}>
      <style>{MAX_CSS}</style>
      <div className="max-grid" aria-hidden="true" />
      {effect === "money" || effect === "konami" ? <Rain glyph={effect === "money" ? "$" : "★"} /> : null}
      {effect === "beam" ? <div className="max-beam" aria-hidden="true" /> : null}
      <div className={`max-panel relative mx-auto grid max-w-6xl gap-10 lg:grid-cols-[320px_1fr] lg:items-center`}>
        <div className="flex flex-col items-center text-center">
          <button type="button" onClick={listen} className={`max-core is-${state}`} aria-label="Talk to Max">
            <span className="max-ring r1" />
            <span className="max-ring r2" />
            <span className="max-ring r3" />
            <span className="max-heart">MAX</span>
          </button>
          <p className="mt-5 text-xs font-bold uppercase tracking-[0.35em] text-cyan-300">Contrax AI</p>
          <p className="mt-1 text-sm text-slate-400">{label}</p>
          <label className="mt-3 flex items-center gap-2 text-xs text-slate-400">
            <input type="checkbox" checked={voiceOn} onChange={(e) => { setVoiceOn(e.target.checked); if (!e.target.checked) stopSpeaking(); }} />
            Max speaks out loud
          </label>
        </div>

        <div className="min-w-0">
          <h2 className="text-3xl font-extrabold tracking-tight sm:text-4xl">
            Meet <span className="text-cyan-300">Max</span>. Ask him anything about government contracts.
          </h2>
          <p className="mt-2 text-slate-300">He searches live bids, winners and events across all 50 states, and tells you what matters.</p>

          {last.length ? (
            <ul className="mt-5 space-y-2" aria-live="polite">
              {last.map((t, i) => (
                <li key={i} className={t.role === "user" ? "text-sm text-slate-400" : "max-say rounded-2xl border border-cyan-400/20 bg-cyan-400/5 p-4 text-base text-cyan-50"}>
                  {t.role === "user" ? `You: ${t.content}` : t.content}
                </li>
              ))}
            </ul>
          ) : (
            <div className="mt-5 flex flex-wrap gap-2">
              {SUGGESTIONS.map((s) => (
                <button key={s} type="button" onClick={() => ask(s)} className="rounded-full border border-cyan-400/30 bg-cyan-400/5 px-4 py-2 text-sm text-cyan-100 hover:bg-cyan-400/15">
                  {s}
                </button>
              ))}
            </div>
          )}

          {bids.length ? (
            <div className="mt-4 grid gap-3 sm:grid-cols-2">
              {bids.map((b, i) => (
                <a key={b.id} href={`/bid/${b.id}`} onClick={() => trackEvent("max_bid_click", String(b.id))} className="max-card rounded-2xl border border-cyan-400/25 bg-white/5 p-4 hover:border-cyan-300" style={{ animationDelay: `${i * 110}ms` }}>
                  <p className="line-clamp-2 font-bold text-white">{b.title}</p>
                  <p className="mt-1 text-xs text-slate-400">{[b.agency, b.location].filter(Boolean).join(" · ")}</p>
                  <p className="mt-2 text-xs font-semibold text-amber-300">
                    {dueLabel(b.due)}
                    {b.setAside ? ` · ${b.setAside}` : ""}
                  </p>
                </a>
              ))}
            </div>
          ) : null}

          {cta.kind === "email" ? <MaxEmail trade={cta.trade} state={cta.state} /> : null}
          {cta.kind === "radar" ? (
            <a href={`/radar?${new URLSearchParams({ cert: "sdvosb", size: "any", ...(cta.trade ? { trade: cta.trade } : {}), ...(cta.state ? { state: cta.state } : {}) })}`} onClick={() => trackEvent("max_cta_radar", cta.trade ?? "")} className="mt-4 inline-block rounded-xl bg-amber-500 px-5 py-3 font-bold text-slate-950">
              See every match in Contract Radar →
            </a>
          ) : null}
          {cta.kind === "trial" ? (
            <a href="/pricing" onClick={() => trackEvent("max_cta_trial", "")} className="mt-4 inline-block rounded-xl bg-amber-500 px-5 py-3 font-bold text-slate-950">
              See plans →
            </a>
          ) : null}

          <form
            className="mt-5 flex gap-2"
            onSubmit={(e) => {
              e.preventDefault();
              ask(typed);
              setTyped("");
            }}
          >
            <label htmlFor="max-input" className="sr-only">
              Ask Max
            </label>
            <input id="max-input" value={typed} onChange={(e) => setTyped(e.target.value)} maxLength={300} placeholder="e.g. Any landscaping bids near Richmond?" className="min-w-0 flex-1 rounded-xl border border-cyan-400/30 bg-white/5 px-4 py-3 text-base text-white placeholder:text-slate-500 outline-none focus:border-cyan-300" />
            <button type="submit" disabled={state === "thinking"} className="rounded-xl bg-cyan-400 px-5 py-3 font-bold text-slate-950 disabled:opacity-60">
              Ask
            </button>
          </form>
          {note ? <p className="mt-2 text-sm text-amber-300">{note}</p> : null}
          <p className="mt-3 text-xs text-slate-500">Max answers from live Contrax data and can make mistakes. Always check the official notice.</p>
        </div>
      </div>
    </section>
  );
}

function MaxEmail({ trade, state }: { trade: string | null; state: string | null }) {
  const [email, setEmail] = useState("");
  const [status, setStatus] = useState<"idle" | "sending" | "done" | "error">("idle");
  if (status === "done") return <p className="mt-4 rounded-xl bg-emerald-500/15 p-3 text-sm font-semibold text-emerald-200">Done! New matching bids will come to your inbox. Check it to confirm.</p>;
  return (
    <form
      className="mt-4 rounded-2xl border border-amber-400/40 bg-amber-400/10 p-4"
      onSubmit={async (e) => {
        e.preventDefault();
        const v = email.trim().toLowerCase();
        if (!EMAIL_PATTERN.test(v)) return setStatus("error");
        setStatus("sending");
        const ids = trackingIds();
        try {
          const res = await fetch("/api/radar/lead", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ email: v, trade: trade || undefined, state: state || undefined, visitor_id: ids.visitor_id || undefined, visit_id: ids.visit_id || undefined }),
          });
          const j = (await res.json().catch(() => null)) as { success?: boolean } | null;
          if (!res.ok || !j?.success) return setStatus("error");
          markEmailGiven();
          trackEvent("max_email", `${trade ?? ""}|${state ?? ""}`);
          setStatus("done");
        } catch {
          setStatus("error");
        }
      }}
    >
      <p className="text-sm font-bold text-amber-200">📬 Want Max to send you new {trade ?? "matching"} bids{state ? ` in ${state}` : ""} as they post? Free.</p>
      <div className="mt-2 flex gap-2">
        <label htmlFor="max-email" className="sr-only">
          Email
        </label>
        <input id="max-email" type="email" autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="you@company.com" className="min-w-0 flex-1 rounded-xl border border-white/20 bg-white/10 px-4 py-2.5 text-white placeholder:text-slate-400" />
        <button type="submit" disabled={status === "sending"} className="rounded-xl bg-amber-500 px-4 py-2.5 font-bold text-slate-950">
          {status === "sending" ? "…" : "Send them"}
        </button>
      </div>
      {status === "error" ? <p className="mt-2 text-xs text-red-300">Please enter a valid email and try again.</p> : null}
    </form>
  );
}

function Rain({ glyph }: { glyph: string }) {
  const drops = Array.from({ length: 34 }, (_, i) => i);
  return (
    <div className="max-rain" aria-hidden="true">
      {drops.map((i) => (
        <span key={i} style={{ left: `${(i * 29) % 100}%`, animationDelay: `${(i % 9) * 0.22}s`, fontSize: `${18 + ((i * 7) % 22)}px` }}>
          {glyph}
        </span>
      ))}
    </div>
  );
}

const MAX_CSS = `
.max-grid{position:absolute;inset:0;background-image:linear-gradient(rgba(34,211,238,.06) 1px,transparent 1px),linear-gradient(90deg,rgba(34,211,238,.06) 1px,transparent 1px);background-size:44px 44px;mask-image:radial-gradient(ellipse at 30% 40%,#000 30%,transparent 75%)}
.max-core{position:relative;width:190px;height:190px;border-radius:9999px;display:grid;place-items:center;cursor:pointer;background:radial-gradient(circle,rgba(34,211,238,.35),rgba(8,47,73,.2) 60%,transparent 70%);transition:transform .3s}
.max-core:hover{transform:scale(1.04)}
.max-ring{position:absolute;inset:0;border-radius:9999px;border:2px solid rgba(34,211,238,.55);animation:maxspin 9s linear infinite}
.max-ring.r1{border-style:dashed}
.max-ring.r2{inset:18px;border-color:rgba(165,243,252,.45);animation-duration:6s;animation-direction:reverse;border-width:3px;border-left-color:transparent}
.max-ring.r3{inset:38px;border-color:rgba(34,211,238,.8);animation-duration:4s;border-top-color:transparent;border-bottom-color:transparent}
.max-heart{width:78px;height:78px;border-radius:9999px;display:grid;place-items:center;font-weight:900;letter-spacing:.12em;color:#ecfeff;background:radial-gradient(circle,#67e8f9,#0891b2 70%);box-shadow:0 0 40px 10px rgba(34,211,238,.55),inset 0 0 18px rgba(255,255,255,.6)}
.max-core.is-listening .max-heart{animation:maxpulse .7s ease-in-out infinite;background:radial-gradient(circle,#a5f3fc,#06b6d4 70%)}
.max-core.is-thinking .max-ring{animation-duration:1.2s}
.max-core.is-speaking .max-heart{animation:maxpulse 1.1s ease-in-out infinite}
.max-say{animation:maxin .4s ease-out both}
.max-card{animation:maxin .45s ease-out both}
@keyframes maxspin{to{transform:rotate(360deg)}}
@keyframes maxpulse{50%{transform:scale(1.12);box-shadow:0 0 70px 22px rgba(34,211,238,.7)}}
@keyframes maxin{from{opacity:0;transform:translateY(10px)}to{opacity:1;transform:none}}
.max-rain{position:absolute;inset:0;pointer-events:none;overflow:hidden;z-index:5}
.max-rain span{position:absolute;top:-40px;color:#fbbf24;font-weight:900;text-shadow:0 0 12px rgba(251,191,36,.8);animation:maxfall 3.6s linear forwards}
.fx-konami .max-rain span{color:#f472b6;text-shadow:0 0 12px rgba(244,114,182,.8)}
@keyframes maxfall{to{transform:translateY(900px) rotate(200deg);opacity:.2}}
.fx-barrel .max-panel{animation:maxroll 1.4s ease-in-out}
@keyframes maxroll{to{transform:rotate(360deg)}}
.fx-ironman .max-heart{background:radial-gradient(circle,#fde68a,#f59e0b 70%);box-shadow:0 0 90px 30px rgba(245,158,11,.8)}
.fx-ironman .max-ring{border-color:rgba(251,191,36,.8)}
.fx-redalert{animation:maxred .5s ease-in-out 4}
@keyframes maxred{50%{background:#450a0a}}
.fx-redalert .max-heart{background:radial-gradient(circle,#fca5a5,#dc2626 70%);box-shadow:0 0 80px 26px rgba(220,38,38,.8)}
.max-beam{position:absolute;inset:0;pointer-events:none;z-index:5;background:linear-gradient(90deg,transparent,rgba(165,243,252,.5),transparent);animation:maxbeam 1.6s ease-in-out}
@keyframes maxbeam{from{transform:translateX(-100%)}to{transform:translateX(100%)}}
@media (prefers-reduced-motion:reduce){.max-ring,.max-heart,.max-rain span,.fx-barrel .max-panel,.max-beam,.fx-redalert{animation:none!important}}
`;
