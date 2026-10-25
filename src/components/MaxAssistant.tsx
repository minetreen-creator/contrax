import { useEffect, useRef, useState } from "react";
import { KONAMI, maxEasterEgg, mergeCapability, type MaxCapability, type MaxCta, type MaxEffect, type MaxLang } from "~/lib/max";
import { LAUNCHPAD_KEY, emptyLaunchpad, parseLaunchpad } from "~/lib/launchpad";
import { trackEvent } from "~/lib/track";
import { trackingIds } from "~/lib/visitor";
import { markEmailGiven } from "~/lib/return-visitor";

/**
 * Max on the homepage (src/lib/max.ts): ask out loud or type, Max searches live
 * Contrax data (/api/max/ask), answers in his own voice (/api/max/voice), and
 * shows the real bids. Secret phrases trigger effects (maxEasterEgg). Every
 * bid card has "Remind me" (/api/max/remind), and the EN/ES switch makes Max
 * listen, answer and speak in Spanish.
 *
 * On the homepage Max opens with his pick of the day (/api/max/pick). On a bid
 * page (`bid` prop) he starts collapsed as "Ask Max about this bid" and knows
 * which bid "this" is. A capability statement interview ends with a draft
 * handed to Launchpad (mergeCapability).
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
function makeRecognizer(lang: MaxLang = "en"): Recognizer | null {
  if (typeof window === "undefined") return null;
  const W = window as unknown as { SpeechRecognition?: new () => Recognizer; webkitSpeechRecognition?: new () => Recognizer };
  const C = W.SpeechRecognition ?? W.webkitSpeechRecognition;
  if (!C) return null;
  const r = new C();
  r.lang = lang === "es" ? "es-US" : "en-US";
  r.interimResults = false;
  r.continuous = false;
  return r;
}

const SUGGESTIONS: Record<MaxLang, string[]> = {
  en: [
    "Any cleaning contracts in Virginia?",
    "I'm a woman-owned landscaping company in Ohio. What should I bid on?",
    "Who's winning construction work in Texas?",
    "Help me write my capability statement",
  ],
  es: [
    "¿Hay contratos de limpieza en Virginia?",
    "Tengo una compañía de construcción en Texas. ¿A qué debo ofertar?",
    "¿Quién está ganando contratos de jardinería en Florida?",
    "Ayúdame a escribir mi declaración de capacidades",
  ],
};

const BID_SUGGESTIONS: Record<MaxLang, string[]> = {
  en: ["Explain this bid in plain English", "Is this worth bidding on for a small business?", "Who already does this kind of work?", "What do I need to bid on this?"],
  es: ["Explícame esta oferta en palabras simples", "¿Vale la pena para un pequeño negocio?", "¿Quién ya hace este tipo de trabajo?", "¿Qué necesito para ofertar?"],
};

const T = {
  en: {
    idleMic: "Tap the core to talk, or type",
    idle: "Type a question",
    listening: "Listening…",
    thinking: "Searching live government data…",
    speaking: "Speaking… tap to stop",
    speaks: "Max speaks out loud",
    title: ["Meet ", "Max", ". Ask him anything about government contracts."],
    sub: "He searches live bids, winners and events across all 50 states, tells you what fits your business, and explains any bid you paste.",
    you: "You",
    placeholder: "e.g. Any landscaping bids near Richmond? Or paste a bid link",
    ask: "Ask",
    remind: "⏰ Remind me",
    disclaimer: "Max answers from live Contrax data and can make mistakes. Always check the official notice.",
    limit: "I've answered a lot of questions for you today. Search Contract Radar for the full list, or come back in a little while.",
    limitEmail: "I'm having fun! Pop your email in below and I'll keep going, free. I'll also send you new bids that match.",
    limitPaid: "That's all my free answers for today. Paid plans get me without limits, plus every match. Or come back tomorrow!",
    oops: "Sorry, something went wrong.",
    offline: "I couldn't connect. Check your internet and try again.",
    noMic: "Voice works in Chrome, Edge and Safari. You can type below.",
    micBlocked: "Allow the microphone to talk to Max, or type below.",
    due: "Due",
  },
  es: {
    idleMic: "Toca el núcleo para hablar, o escribe",
    idle: "Escribe una pregunta",
    listening: "Escuchando…",
    thinking: "Buscando datos del gobierno en vivo…",
    speaking: "Hablando… toca para parar",
    speaks: "Max habla en voz alta",
    title: ["Conoce a ", "Max", ". Pregúntale lo que sea sobre contratos del gobierno."],
    sub: "Busca ofertas abiertas, ganadores y eventos en los 50 estados, te dice cuáles le convienen a tu negocio y te explica cualquier oferta que pegues.",
    you: "Tú",
    placeholder: "p. ej. ¿Hay contratos de jardinería cerca de Richmond?",
    ask: "Preguntar",
    remind: "⏰ Recordarme",
    disclaimer: "Max responde con datos en vivo de Contrax y puede equivocarse. Revisa siempre el aviso oficial.",
    limit: "Ya respondí muchas preguntas hoy. Busca en Contract Radar la lista completa, o vuelve en un rato.",
    limitEmail: "¡Me estoy divirtiendo! Escribe tu correo abajo y sigo ayudándote, gratis. También te envío las nuevas ofertas.",
    limitPaid: "Esas son todas mis respuestas gratis de hoy. Los planes pagados me tienen sin límites. ¡O vuelve mañana!",
    oops: "Perdón, algo salió mal.",
    offline: "No pude conectarme. Revisa tu internet e inténtalo de nuevo.",
    noMic: "La voz funciona en Chrome, Edge y Safari. Puedes escribir abajo.",
    micBlocked: "Permite el micrófono para hablar con Max, o escribe abajo.",
    due: "Vence",
  },
} as const;

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function dueLabel(d: string | null, lang: MaxLang = "en"): string {
  if (!d) return "";
  return `${T[lang].due} ${new Date(`${d}T12:00:00Z`).toLocaleDateString(lang === "es" ? "es-US" : "en-US", { month: "short", day: "numeric", timeZone: "UTC" })}`;
}

export function MaxAssistant({ bid }: { bid?: { id: number; title: string } } = {}) {
  const [open, setOpen] = useState(!bid);
  const [state, setState] = useState<MaxState>("idle");
  const [turns, setTurns] = useState<Turn[]>([]);
  const [bids, setBids] = useState<BidCard[]>([]);
  const [cta, setCta] = useState<{ kind: MaxCta; trade: string | null; state: string | null; bid: number | null }>({ kind: null, trade: null, state: null, bid: null });
  const [lang, setLang] = useState<MaxLang>("en");
  const [remindFor, setRemindFor] = useState<number | null>(null);
  const [email, setEmail] = useState("");
  const [capability, setCapability] = useState<MaxCapability | null>(null);
  const [typed, setTyped] = useState("");
  const [voiceOn, setVoiceOn] = useState(true);
  const [hasMic, setHasMic] = useState(false);
  const [effect, setEffect] = useState<MaxEffect>(null);
  const [note, setNote] = useState("");
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const busy = useRef(false);
  const turnsRef = useRef<Turn[]>([]);
  turnsRef.current = turns;
  const t = T[lang];

  // A Spanish-speaking browser starts in Spanish. On the homepage Max then
  // greets with his pick of the day (shown, not spoken: browsers block sound
  // until the visitor interacts).
  useEffect(() => {
    const l: MaxLang = typeof navigator !== "undefined" && navigator.language?.toLowerCase().startsWith("es") ? "es" : "en";
    if (l === "es") setLang("es");
    if (bid) return;
    let alive = true;
    fetch(`/api/max/pick?lang=${l}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((j: { pick?: BidCard & { value?: string | null }; say?: string } | null) => {
        if (!alive || !j?.pick || !j.say || turnsRef.current.length) return;
        const p = j.pick;
        setTurns([{ role: "assistant", content: j.say }]);
        setBids([{ id: p.id, title: p.title, agency: p.agency, location: p.location, due: p.due, setAside: p.setAside }]);
        trackEvent("max_pick_view", String(p.id));
      })
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, []);

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

  const speakBrowser = (text: string, l: MaxLang) =>
    new Promise<void>((done) => {
      if (!("speechSynthesis" in window)) return done();
      const u = new SpeechSynthesisUtterance(text);
      u.lang = l === "es" ? "es-US" : "en-US";
      // Backup voice: the most natural one the browser has (Edge's "Natural"
      // voices, Chrome's Google voices, Apple's Siri/Samantha), not the first.
      const voices = window.speechSynthesis.getVoices().filter((x) => (l === "es" ? x.lang.startsWith("es") : x.lang === "en-US"));
      const rank = (x: SpeechSynthesisVoice) => (/natural|neural|online/i.test(x.name) ? 0 : /google/i.test(x.name) ? 1 : /siri|samantha|alex|aaron|nicky/i.test(x.name) ? 2 : 3);
      const v = voices.sort((a, b) => rank(a) - rank(b))[0];
      if (v) u.voice = v;
      u.rate = 1.03;
      u.onend = u.onerror = () => done();
      window.speechSynthesis.speak(u);
    });

  const speak = async (text: string, l: MaxLang = lang) => {
    if (!voiceOn) return;
    stopSpeaking();
    setState("speaking");
    let src = "";
    try {
      const res = await fetch("/api/max/voice", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ text, lang: l }) });
      if (res.ok) src = URL.createObjectURL(await res.blob());
    } catch {
      /* fall back */
    }
    if (!src) return speakBrowser(text, l);
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
        speakBrowser(text, l).then(done);
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
        await speak(egg.say, /[¿¡ñáéíóú]/.test(egg.say) ? "es" : lang);
        return;
      }
      trackEvent("max_ask", q.slice(0, 80));
      setState("thinking");
      const res = await fetch("/api/max/ask", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ question: q, history, lang, bid_id: bid?.id }) });
      const j = (await res.json().catch(() => ({}))) as { say?: string; error?: string; gate?: "email" | "paid" | "wait"; bids?: BidCard[]; cta?: MaxCta; remindBid?: number | null; capability?: MaxCapability | null; trade?: string | null; state?: string | null; lang?: MaxLang };
      const gate = res.status === 429 ? j.gate ?? "wait" : null;
      const say = j.say ?? (gate === "email" ? t.limitEmail : gate === "paid" ? t.limitPaid : gate ? t.limit : j.error ?? t.oops);
      if (gate) {
        trackEvent("max_gate", gate);
        setTurns((t) => [...t, { role: "assistant" as const, content: say }].slice(-8));
        setCta({ kind: gate === "email" ? "email" : gate === "paid" ? "trial" : null, trade: cta.trade, state: cta.state, bid: null });
        setRemindFor(null);
        await speak(say);
        return;
      }
      const replyLang: MaxLang = j.lang === "es" || j.lang === "en" ? j.lang : lang;
      if (replyLang !== lang) {
        setLang(replyLang);
        trackEvent("max_lang", replyLang);
      }
      setTurns((t) => [...t, { role: "assistant" as const, content: say }].slice(-8));
      if (j.bids?.length) setBids(j.bids.slice(0, 4));
      setCta({ kind: j.cta ?? null, trade: j.trade ?? null, state: j.state ?? null, bid: j.remindBid ?? null });
      if (j.cta === "remind" && j.remindBid) setRemindFor(j.remindBid);
      if (j.cta === "capability" && j.capability) {
        setCapability(j.capability);
        trackEvent("max_capability_ready", j.capability.trade ?? "");
      }
      await speak(say, replyLang);
    } catch {
      setNote(t.offline);
    } finally {
      busy.current = false;
      setState("idle");
    }
  };

  const listen = () => {
    if (state === "speaking") return stopSpeaking();
    if (busy.current) return;
    const r = makeRecognizer(lang);
    if (!r) {
      setNote(t.noMic);
      return;
    }
    let heard = "";
    r.onresult = (e) => {
      heard = Array.from(e.results).map((x) => x[0].transcript).join(" ");
    };
    r.onerror = (e) => e.error === "not-allowed" && setNote(t.micBlocked);
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
  const asked = turns.some((m) => m.role === "user");
  const suggestions = (bid ? BID_SUGGESTIONS : SUGGESTIONS)[lang];

  if (!open) {
    return (
      <section aria-label="Ask Max about this bid" className="mt-6">
        <style>{MAX_CSS}</style>
        <button
          type="button"
          onClick={() => {
            setOpen(true);
            trackEvent("max_bid_open", String(bid?.id ?? ""));
          }}
          className="max-wrap flex w-full items-center gap-4 rounded-2xl border border-cyan-400/40 bg-[#050d1f] p-4 text-left text-white hover:border-cyan-300"
        >
          <span className="max-heart max-mini" aria-hidden="true">MAX</span>
          <span className="min-w-0">
            <span className="block text-lg font-extrabold">Ask Max about this bid 🤖</span>
            <span className="block text-sm text-slate-400">Plain-English summary, who can bid, who already does this work, and whether it's worth chasing.</span>
          </span>
        </button>
      </section>
    );
  }
  const label = { idle: hasMic ? t.idleMic : t.idle, listening: t.listening, thinking: t.thinking, speaking: t.speaking }[state];
  const remindBid = remindFor ? bids.find((b) => b.id === remindFor) ?? null : null;

  return (
    <section aria-label="Ask Max, the Contrax AI" className={`max-wrap fx-${effect ?? "none"} relative overflow-hidden bg-[#050d1f] px-4 text-white sm:px-8 ${bid ? "mt-6 rounded-3xl border border-cyan-400/30 py-6" : "py-14"}`}>
      <style>{MAX_CSS}</style>
      <div className="max-grid" aria-hidden="true" />
      {effect === "money" || effect === "konami" ? <Rain glyph={effect === "money" ? "$" : "★"} /> : null}
      {effect === "beam" ? <div className="max-beam" aria-hidden="true" /> : null}
      <div className={`max-panel relative mx-auto grid max-w-6xl gap-10 ${bid ? "max-compact gap-4" : "lg:grid-cols-[320px_1fr]"} lg:items-center`}>
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
            {t.speaks}
          </label>
          <div className="mt-3 inline-flex rounded-full border border-cyan-400/30 p-0.5 text-xs font-bold" role="group" aria-label="Language">
            {(["en", "es"] as const).map((l) => (
              <button
                key={l}
                type="button"
                aria-pressed={lang === l}
                onClick={() => {
                  setLang(l);
                  trackEvent("max_lang", l);
                }}
                className={`rounded-full px-3 py-1 ${lang === l ? "bg-cyan-400 text-slate-950" : "text-cyan-200"}`}
              >
                {l === "en" ? "English" : "Español"}
              </button>
            ))}
          </div>
        </div>

        <div className="min-w-0">
          {bid ? (
            <h2 className="text-2xl font-extrabold tracking-tight" lang={lang}>
              {lang === "es" ? "Pregúntale a " : "Ask "}
              <span className="text-cyan-300">Max</span>
              {lang === "es" ? " sobre esta oferta" : " about this bid"}
            </h2>
          ) : (
            <>
              <h2 className="text-3xl font-extrabold tracking-tight sm:text-4xl" lang={lang}>
                {t.title[0]}
                <span className="text-cyan-300">{t.title[1]}</span>
                {t.title[2]}
              </h2>
              <p className="mt-2 text-slate-300">{t.sub}</p>
            </>
          )}

          {last.length ? (
            <ul className="mt-5 space-y-2" aria-live="polite">
              {last.map((m, i) => (
                <li key={i} className={m.role === "user" ? "text-sm text-slate-400" : "max-say rounded-2xl border border-cyan-400/20 bg-cyan-400/5 p-4 text-base text-cyan-50"}>
                  {m.role === "user" ? `${t.you}: ${m.content}` : m.content}
                </li>
              ))}
            </ul>
          ) : null}
          {!asked ? (
            <div className="mt-5 flex flex-wrap gap-2">
              {suggestions.map((s) => (
                <button key={s} type="button" onClick={() => ask(s)} className="rounded-full border border-cyan-400/30 bg-cyan-400/5 px-4 py-2 text-sm text-cyan-100 hover:bg-cyan-400/15">
                  {s}
                </button>
              ))}
            </div>
          ) : null}

          {bids.length ? (
            <div className="mt-4 grid gap-3 sm:grid-cols-2">
              {bids.map((b, i) => (
                <div key={b.id} className={`max-card flex flex-col rounded-2xl border bg-white/5 p-4 ${remindFor === b.id ? "border-amber-300" : "border-cyan-400/25 hover:border-cyan-300"}`} style={{ animationDelay: `${i * 110}ms` }}>
                  <a href={`/bid/${b.id}`} onClick={() => trackEvent("max_bid_click", String(b.id))} className="block flex-1">
                    <p className="line-clamp-2 font-bold text-white">{b.title}</p>
                    <p className="mt-1 text-xs text-slate-400">{[b.agency, b.location].filter(Boolean).join(" · ")}</p>
                    <p className="mt-2 text-xs font-semibold text-amber-300">
                      {dueLabel(b.due, lang)}
                      {b.setAside ? ` · ${b.setAside}` : ""}
                    </p>
                  </a>
                  {b.due ? (
                    <button
                      type="button"
                      onClick={() => {
                        setRemindFor(remindFor === b.id ? null : b.id);
                        trackEvent("max_remind_open", String(b.id));
                      }}
                      className="mt-3 self-start rounded-lg border border-amber-300/40 px-2.5 py-1 text-xs font-bold text-amber-200 hover:bg-amber-300/10"
                    >
                      {t.remind}
                    </button>
                  ) : null}
                </div>
              ))}
            </div>
          ) : null}

          {remindFor ? <MaxRemind key={remindFor} bidId={remindFor} title={remindBid?.title ?? null} lang={lang} email={email} onEmail={setEmail} /> : null}

          {capability ? <MaxCapabilityCard cap={capability} lang={lang} /> : null}
          {cta.kind === "email" && !remindFor ? <MaxEmail trade={cta.trade} state={cta.state} lang={lang} /> : null}
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
            <input id="max-input" value={typed} onChange={(e) => setTyped(e.target.value)} maxLength={300} placeholder={t.placeholder} className="min-w-0 flex-1 rounded-xl border border-cyan-400/30 bg-white/5 px-4 py-3 text-base text-white placeholder:text-slate-500 outline-none focus:border-cyan-300" />
            <button type="submit" disabled={state === "thinking"} className="rounded-xl bg-cyan-400 px-5 py-3 font-bold text-slate-950 disabled:opacity-60">
              {t.ask}
            </button>
          </form>
          {note ? <p className="mt-2 text-sm text-amber-300">{note}</p> : null}
          <p className="mt-3 text-xs text-slate-500">{t.disclaimer}</p>
        </div>
      </div>
    </section>
  );
}

function MaxEmail({ trade, state, lang }: { trade: string | null; state: string | null; lang: MaxLang }) {
  const es = lang === "es";
  const [email, setEmail] = useState("");
  const [status, setStatus] = useState<"idle" | "sending" | "done" | "error">("idle");
  if (status === "done")
    return <p className="mt-4 rounded-xl bg-emerald-500/15 p-3 text-sm font-semibold text-emerald-200">{es ? "¡Listo! Sigue preguntando. Las nuevas ofertas llegarán a tu correo; revísalo para confirmar." : "Done! Keep asking. New matching bids will come to your inbox; check it to confirm."}</p>;
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
            // unlock: also signs this browser's email-unlock cookie, which lifts Max to the email tier.
            body: JSON.stringify({ email: v, trade: trade || undefined, state: state || undefined, visitor_id: ids.visitor_id || undefined, visit_id: ids.visit_id || undefined, unlock: true }),
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
      <p className="text-sm font-bold text-amber-200">
        {es ? `📬 ¿Quieres que Max te envíe las nuevas ofertas${trade ? ` de ${trade}` : ""}${state ? ` en ${state}` : ""} cuando se publiquen? Gratis.` : `📬 Want Max to send you new ${trade ?? "matching"} bids${state ? ` in ${state}` : ""} as they post? Free.`}
      </p>
      <div className="mt-2 flex gap-2">
        <label htmlFor="max-email" className="sr-only">
          Email
        </label>
        <input id="max-email" type="email" autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="you@company.com" className="min-w-0 flex-1 rounded-xl border border-white/20 bg-white/10 px-4 py-2.5 text-white placeholder:text-slate-400" />
        <button type="submit" disabled={status === "sending"} className="rounded-xl bg-amber-500 px-4 py-2.5 font-bold text-slate-950">
          {status === "sending" ? "…" : es ? "Envíamelas" : "Send them"}
        </button>
      </div>
      {status === "error" ? <p className="mt-2 text-xs text-red-300">{es ? "Escribe un correo válido e inténtalo de nuevo." : "Please enter a valid email and try again."}</p> : null}
    </form>
  );
}

/** The capability statement coach's handoff: fill Launchpad's empty fields, then open it. */
function MaxCapabilityCard({ cap, lang }: { cap: MaxCapability; lang: MaxLang }) {
  const es = lang === "es";
  const [error, setError] = useState(false);
  const open = () => {
    try {
      let current = emptyLaunchpad();
      try {
        current = parseLaunchpad(localStorage.getItem(LAUNCHPAD_KEY));
      } catch {
        /* unreadable draft: start fresh rather than lose Max's */
      }
      const { data, filled } = mergeCapability(current, cap);
      localStorage.setItem(LAUNCHPAD_KEY, JSON.stringify(data));
      trackEvent("max_capability_open", String(filled.length));
      window.location.href = "/launchpad#capability-builder";
    } catch {
      setError(true);
    }
  };
  return (
    <div className="mt-4 rounded-2xl border border-emerald-400/40 bg-emerald-400/10 p-4">
      <p className="text-sm font-bold text-emerald-200">📄 {es ? "Tu borrador de declaración de capacidades está listo" : "Your capability statement draft is ready"}</p>
      <p className="mt-1 text-sm text-emerald-100/80">
        <b>{cap.company}</b>
        {cap.trade ? ` · ${cap.trade}` : ""}
        {cap.summary ? ` — ${cap.summary.slice(0, 160)}${cap.summary.length > 160 ? "…" : ""}` : ""}
      </p>
      <button type="button" onClick={open} className="mt-3 rounded-xl bg-emerald-400 px-4 py-2.5 font-bold text-slate-950">
        {es ? "Terminarla en Launchpad →" : "Finish it in Launchpad →"}
      </button>
      <p className="mt-2 text-xs text-emerald-100/60">{es ? "Gratis. Agregas tus datos de contacto y la imprimes. Nada de lo que ya escribiste se reemplaza." : "Free. Add your contact details and print it. Anything you already typed there is kept."}</p>
      {error ? <p className="mt-2 text-xs text-red-300">{es ? "Tu navegador bloqueó el guardado. Abre Launchpad y copia el borrador." : "Your browser blocked saving. Open Launchpad and copy the draft in."}</p> : null}
    </div>
  );
}

/** "Remind me before it closes" (src/lib/max-reminders.server.ts). */
function MaxRemind({ bidId, title, lang, email, onEmail }: { bidId: number; title: string | null; lang: MaxLang; email: string; onEmail: (v: string) => void }) {
  const es = lang === "es";
  const [status, setStatus] = useState<"idle" | "sending" | "pending" | "confirmed" | "error">("idle");
  const [msg, setMsg] = useState("");
  const [when, setWhen] = useState("");
  if (status === "pending" || status === "confirmed") {
    const confirm = status === "pending" ? (es ? " Primero confirma tu correo (te acabo de enviar el enlace)." : " First confirm your email (I just sent you the link).") : "";
    return (
      <p className="mt-4 rounded-xl bg-emerald-500/15 p-3 text-sm font-semibold text-emerald-200">
        {es ? `⏰ ¡Hecho! Te enviaré un recordatorio el ${when}.${confirm}` : `⏰ Got it! I'll email you a reminder on ${when}.${confirm}`}
      </p>
    );
  }
  return (
    <form
      className="mt-4 rounded-2xl border border-amber-400/40 bg-amber-400/10 p-4"
      onSubmit={async (e) => {
        e.preventDefault();
        const v = email.trim().toLowerCase();
        if (!EMAIL_PATTERN.test(v)) {
          setMsg(es ? "Escribe un correo válido." : "Please enter a valid email.");
          return setStatus("error");
        }
        setStatus("sending");
        try {
          const res = await fetch("/api/max/remind", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ email: v, bid_id: bidId, visitor_id: trackingIds().visitor_id || undefined }),
          });
          const j = (await res.json().catch(() => null)) as { success?: boolean; lead?: string; remindAt?: string; error?: string } | null;
          if (!res.ok || !j?.success || !j.remindAt) {
            setMsg(j?.error ?? (es ? "Algo salió mal. Inténtalo de nuevo." : "Something went wrong. Please try again."));
            return setStatus("error");
          }
          setWhen(new Date(j.remindAt).toLocaleDateString(es ? "es-US" : "en-US", { weekday: "long", month: "short", day: "numeric", timeZone: "America/New_York" }));
          markEmailGiven();
          trackEvent("max_remind", String(bidId));
          setStatus(j.lead === "confirmed" ? "confirmed" : "pending");
        } catch {
          setMsg(es ? "No pude conectarme. Inténtalo de nuevo." : "I couldn't connect. Please try again.");
          setStatus("error");
        }
      }}
    >
      <p className="text-sm font-bold text-amber-200">
        {es ? "⏰ Te aviso 3 días antes de que cierre" : "⏰ I'll email you 3 days before it closes"}
        {title ? <span className="block font-normal text-amber-100/80">{title}</span> : null}
      </p>
      <div className="mt-2 flex gap-2">
        <label htmlFor="max-remind-email" className="sr-only">
          Email
        </label>
        <input id="max-remind-email" type="email" autoComplete="email" value={email} onChange={(e) => onEmail(e.target.value)} placeholder="you@company.com" className="min-w-0 flex-1 rounded-xl border border-white/20 bg-white/10 px-4 py-2.5 text-white placeholder:text-slate-400" />
        <button type="submit" disabled={status === "sending"} className="rounded-xl bg-amber-500 px-4 py-2.5 font-bold text-slate-950">
          {status === "sending" ? "…" : es ? "Recordarme" : "Remind me"}
        </button>
      </div>
      {status === "error" ? <p className="mt-2 text-xs text-red-300">{msg}</p> : null}
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
.max-compact .max-core{width:150px;height:150px}
.max-compact .max-heart{width:64px;height:64px;font-size:13px}
.max-heart.max-mini{flex:none;width:56px;height:56px;font-size:12px}
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
