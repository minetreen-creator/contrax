import { useEffect, useRef, useState, type FormEvent } from "react";
import { ArrowRight, Radar, CheckCircle2, LoaderCircle } from "lucide-react";
import type { SampleBid } from "~/lib/sample-bids";
import type { RadarMatch } from "~/routes/radar";
import { STATE_NAMES } from "~/lib/contract-map";
import { US_PLACES } from "~/lib/states";
import {
  saveRadarAnswers,
  saveRadarSeen,
  type RadarAnswers,
} from "~/lib/radar-session";
import { publishedDateOnlyFor } from "~/lib/deadline-label";
import { raceRadarScan } from "~/lib/radar-scan-runner";
import { getTrackingUser } from "~/lib/identity";
import { trackEvent } from "~/lib/track";

const STATES = [...US_PLACES].sort((a, b) =>
  (STATE_NAMES[a] ?? a).localeCompare(STATE_NAMES[b] ?? b),
);
const FIELD =
  "w-full rounded-xl border border-slate-300 bg-white px-4 py-3 text-base text-slate-950 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-500 disabled:opacity-60";
type Result = {
  matches: RadarMatch[];
  total: number;
  blocked: boolean;
  signupHref: string;
  radarHref: string;
  answers: RadarAnswers;
  signedIn: boolean;
};

function deadline(bid: Pick<RadarMatch, "due_date" | "source">): string {
  if (!bid.due_date) return "Deadline not specified — check notice";
  const raw = publishedDateOnlyFor(bid.due_date, bid.source);
  if (raw) return `Deadline as published: ${raw}`;
  const date = new Date(bid.due_date);
  return Number.isNaN(date.getTime())
    ? "Check deadline in official notice"
    : `Due ${date.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" })}`;
}

// Owner 2026-10-26: one-tap trades instead of a "describe your business" box,
// the same picks as the Radar first screen.
export const QUICK_TRADES = ["Janitorial", "Landscaping", "Construction", "HVAC", "Trucking", "Security guards", "IT services"];

/**
 * English/Español hero (owner 2026-10-29). Spanish-speaking contractors are a
 * big share of the Facebook groups we reach, Puerto Rico is covered, and Max
 * already answers in Spanish. The quick-trade buttons still search their
 * English term, which also matches Spanish titles (SPANISH_TRADE_TERMS).
 * Remembered per browser; first visit follows the browser's language.
 */
export type HeroLang = "en" | "es";
export const HERO_LANG_KEY = "contrax_lang";
export const HERO_COPY = {
  en: {
    badge: "Built for small business ambition",
    titleCount: (n: string) => `${n} government bids open right now.`,
    titleCountTail: "See the ones for your business.",
    titleFallback: "Your next government customer",
    titleFallbackTail: "starts here.",
    sub: "Federal, state, city, county and school bids in all 50 states, matched to your trade.",
    checks: ["Real solicitations", "Clear match reasons", "No card to preview"],
    veteran: "Built with veteran-owned businesses in mind. Open to every small business.",
    local: "Explore city & county bids →",
    cardKicker: "Find my first contract",
    cardTitle: "What does your business do?",
    tradePlaceholder: "Or type your trade or NAICS",
    everyState: "Every state",
    cta: "Find my matches",
    busy: "Searching live opportunities…",
    note: "Free to search. No card, no signup to see your top matches.",
    needTrade: "Enter the service or six-digit NAICS code you want to search.",
    trades: {} as Record<string, string>,
  },
  es: {
    badge: "Hecho para pequeños negocios con ambición",
    titleCount: (n: string) => `${n} licitaciones del gobierno abiertas ahora.`,
    titleCountTail: "Vea las que son para su negocio.",
    titleFallback: "Su próximo cliente del gobierno",
    titleFallbackTail: "empieza aquí.",
    sub: "Licitaciones federales, estatales, municipales, de condados y escuelas en los 50 estados y Puerto Rico, según su oficio.",
    checks: ["Licitaciones reales", "Razones claras", "Sin tarjeta para ver"],
    veteran: "Pensado para negocios de veteranos. Abierto a todo pequeño negocio.",
    local: "Ver licitaciones de ciudades y condados →",
    cardKicker: "Encuentre su primer contrato",
    cardTitle: "¿A qué se dedica su negocio?",
    tradePlaceholder: "O escriba su oficio o código NAICS",
    everyState: "Todos los estados",
    cta: "Ver mis oportunidades",
    busy: "Buscando licitaciones…",
    note: "Buscar es gratis. Sin tarjeta ni registro para ver sus mejores resultados.",
    needTrade: "Escriba el servicio o el código NAICS de seis dígitos que quiere buscar.",
    trades: {
      Janitorial: "Limpieza",
      Landscaping: "Jardinería",
      Construction: "Construcción",
      HVAC: "Aire acondicionado",
      Trucking: "Acarreo",
      "Security guards": "Guardias de seguridad",
      "IT services": "Servicios de IT",
    } as Record<string, string>,
  },
} as const;

export function HomeContractFinder({ sample, openTotal = 0 }: { sample: SampleBid[]; openTotal?: number }) {
  const [lang, setLang] = useState<HeroLang>("en");
  useEffect(() => {
    try {
      const saved = localStorage.getItem(HERO_LANG_KEY);
      if (saved === "es" || saved === "en") return setLang(saved);
    } catch {
      /* storage blocked */
    }
    if (typeof navigator !== "undefined" && /^es\b/i.test(navigator.language || "")) setLang("es");
  }, []);
  const chooseLang = (next: HeroLang) => {
    setLang(next);
    trackEvent("home_language", next);
    try {
      localStorage.setItem(HERO_LANG_KEY, next);
    } catch {
      /* storage blocked */
    }
  };
  const c = HERO_COPY[lang];
  const [trade, setTrade] = useState("");
  const [state, setState] = useState("");
  const [busy, setBusy] = useState(false);
  const running = useRef(false);
  const [error, setError] = useState("");
  const [result, setResult] = useState<Result | null>(null);
  const resultsRef = useRef<HTMLDivElement>(null);

  async function search(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (running.current) return;
    const answers: RadarAnswers = {
      trade: trade.trim(),
      state,
      cert: "sb",
      sizePref: "any",
    };
    if (!answers.trade) {
      setError(c.needTrade);
      return;
    }
    running.current = true;
    setBusy(true);
    setError("");
    setResult(null);
    trackEvent("homepage_radar_cta_clicked", "first_contract");
    trackEvent("radar_scan_start", answers.cert);
    try {
      // Keep the existing scoring, server gates and signed handoff. Load only on use.
      const scan = raceRadarScan(async () => {
        const radar = await import("~/routes/radar");
        return {
          response: await radar.runRadarScan({ data: answers }),
          signupHref: radar.radarSignupHref(answers, { free: true, cta: true }),
        };
      });
      const { response, signupHref } = await scan.promise.finally(
        scan.clearTimer,
      );
      const signedIn = !!getTrackingUser();
      const radarHref = `/radar?${new URLSearchParams({ trade: answers.trade, state: answers.state, cert: answers.cert, size: answers.sizePref })}`;
      const matches = response.matches.slice(0, 3);
      const total =
        "totalMatched" in response
          ? response.totalMatched
          : response.matches.length;
      if (!response.paidRequired) {
        saveRadarAnswers(answers);
        saveRadarSeen({
          savedAt: new Date().toISOString(),
          answers,
          certLabel: response.certLabel,
          total: total,
          seenCount: matches.length,
          matches,
          sections: {
            local: response.sections.local.filter((m) =>
              matches.some((v) => v.id === m.id),
            ),
            nationwide: response.sections.nationwide.filter((m) =>
              matches.some((v) => v.id === m.id),
            ),
            related: [],
          },
        });
        trackEvent("radar_scan_complete", answers.cert);
        trackEvent(
          signedIn
            ? matches.length
              ? "radar_scan_signed_in_matches"
              : "radar_scan_signed_in_zero"
            : matches.length
              ? "radar_scan_anonymous_matches"
              : "radar_scan_anonymous_zero",
          answers.cert,
        );
      }
      setResult({
        matches,
        total: total,
        blocked: response.paidRequired,
        signupHref,
        radarHref,
        answers,
        signedIn,
      });
      requestAnimationFrame(() => resultsRef.current?.focus());
    } catch {
      setError(
        "We couldn’t load live opportunities. Please try again or open Contract Radar.",
      );
    } finally {
      running.current = false;
      setBusy(false);
    }
  }

  return (
    <section
      aria-labelledby="first-contract-title"
      className="relative overflow-hidden bg-[#07162e] text-white"
    >
      <div
        aria-hidden="true"
        className="pointer-events-none absolute -right-40 -top-40 h-[650px] w-[650px] rounded-full bg-blue-600/20 blur-3xl"
      />
      <div className="relative mx-auto grid max-w-7xl items-center gap-8 px-5 pb-20 pt-8 sm:gap-12 sm:px-8 sm:pt-20 lg:grid-cols-[1.1fr_1fr] lg:gap-16 lg:pb-24">
        <div>
          <div className="mb-4 inline-flex rounded-full border border-white/20 bg-white/5 p-1 text-xs font-bold" role="group" aria-label="Language / Idioma">
            {(["en", "es"] as const).map((l) => (
              <button
                key={l}
                type="button"
                aria-pressed={lang === l}
                onClick={() => chooseLang(l)}
                className={`rounded-full px-3 py-1 transition ${lang === l ? "bg-white text-slate-900" : "text-blue-100 hover:text-white"}`}
              >
                {l === "en" ? "English" : "Español"}
              </button>
            ))}
          </div>
          <p className="inline-flex items-center gap-2 rounded-full border border-blue-400/30 bg-blue-400/10 px-3 py-2 text-xs font-bold uppercase tracking-widest text-blue-200">
            <Radar className="h-4 w-4" aria-hidden="true" /> {c.badge}
          </p>
          <h1
            id="first-contract-title"
            className="mt-6 max-w-2xl text-4xl font-extrabold leading-[1.08] tracking-tight sm:text-5xl lg:text-6xl"
          >
            {openTotal > 0 ? (
              <>
                {c.titleCount(openTotal.toLocaleString("en-US"))}{" "}
                <span className="text-blue-400">{c.titleCountTail}</span>
              </>
            ) : (
              <>
                {c.titleFallback}{" "}
                <span className="text-blue-400">{c.titleFallbackTail}</span>
              </>
            )}
          </h1>
          <p className="mt-5 max-w-xl text-base leading-relaxed text-slate-300 sm:mt-6 sm:text-lg">
            {c.sub}
          </p>
          <div className="mt-7 hidden flex-wrap gap-x-5 gap-y-3 text-sm text-blue-100 sm:flex">
            {c.checks.map((text) => (
              <span key={text} className="inline-flex items-center gap-2">
                <CheckCircle2
                  aria-hidden="true"
                  className="h-4 w-4 text-blue-400"
                />
                {text}
              </span>
            ))}
          </div>
          <p className="mt-6 hidden text-sm leading-relaxed text-slate-400 sm:block">
            {c.veteran}
          </p>
          <a
            href="/local-bids"
            className="mt-5 hidden text-sm font-semibold text-blue-200 underline underline-offset-4 hover:text-white sm:inline-block"
          >
            {c.local}
          </a>
        </div>
        <div className="rounded-3xl border border-white/20 bg-white p-6 text-slate-950 shadow-2xl shadow-blue-950/60 sm:p-8">
          <p className="text-xs font-bold uppercase tracking-widest text-blue-700">
            {c.cardKicker}
          </p>
          <h2 className="mt-2 text-2xl font-bold tracking-tight">
            {c.cardTitle}
          </h2>
          <form
            onSubmit={search}
            className="mt-5 space-y-4"
            aria-label="Find my first contract"
            aria-busy={busy}
          >
            <div className="flex flex-wrap gap-2" role="group" aria-label="Popular trades">
              {QUICK_TRADES.map((t) => (
                <button
                  key={t}
                  type="button"
                  disabled={busy}
                  aria-pressed={trade === t}
                  onClick={() => { setTrade(t); setError(""); }}
                  className={`rounded-full border px-3 py-1.5 text-sm font-medium transition ${
                    trade === t ? "border-blue-600 bg-blue-600 text-white" : "border-slate-300 bg-white text-slate-700 hover:border-blue-400"
                  }`}
                >
                  {c.trades[t] ?? t}
                </button>
              ))}
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
              <div>
                <label htmlFor="home-trade" className="sr-only">
                  Trade or NAICS code
                </label>
                <input
                  id="home-trade"
                  required
                  maxLength={120}
                  disabled={busy}
                  value={trade}
                  onChange={(e) => setTrade(e.target.value)}
                  placeholder={c.tradePlaceholder}
                  className={FIELD}
                />
              </div>
              <div>
                <label htmlFor="home-state" className="sr-only">
                  Your state
                </label>
                <select
                  id="home-state"
                  value={state}
                  disabled={busy}
                  onChange={(e) => setState(e.target.value)}
                  className={FIELD}
                >
                  <option value="">{c.everyState}</option>
                  {STATES.map((code) => (
                    <option key={code} value={code}>
                      {STATE_NAMES[code] ?? code}
                    </option>
                  ))}
                </select>
              </div>
            </div>
            <button
              disabled={busy}
              className="flex min-h-14 w-full items-center justify-center gap-3 rounded-xl bg-blue-600 px-5 py-4 text-base font-bold text-white transition hover:bg-blue-700 focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-blue-600 disabled:cursor-wait disabled:opacity-70"
            >
              {busy ? (
                <>
                  <LoaderCircle
                    aria-hidden="true"
                    className="h-5 w-5 motion-safe:animate-spin"
                  />
                  {c.busy}
                </>
              ) : (
                <>
                  {c.cta}
                  <ArrowRight aria-hidden="true" className="h-5 w-5" />
                </>
              )}
            </button>
            <p className="text-center text-xs leading-relaxed text-slate-500">
              {c.note}
            </p>
            {error && (
              <p role="alert" className="text-sm text-red-700">
                {error}{" "}
                <a href="/radar" className="font-semibold underline">
                  Open Radar →
                </a>
              </p>
            )}
          </form>
        </div>
      </div>
      <div
        ref={resultsRef}
        tabIndex={-1}
        className="relative mx-auto max-w-7xl px-5 pb-16 outline-none sm:px-8"
        aria-live="polite"
        aria-atomic="false"
      >
        {result ? (
          <>
            <p className="text-xs font-bold uppercase tracking-widest text-blue-300">
              Your opportunity shortlist
            </p>
            <h2 className="mt-2 text-2xl font-bold">
              {result.answers.trade} ·{" "}
              {result.answers.state
                ? STATE_NAMES[result.answers.state]
                : "Every state"}
            </h2>
            {result.blocked ? (
              <div className="mt-5 rounded-2xl border border-blue-400/30 bg-white/5 p-6">
                <h3 className="text-xl font-bold">
                  You’ve used your free search preview.
                </h3>
                <p className="mt-2 text-slate-300">
                  {result.signedIn
                    ? "Continue in Radar to review your search access and saved opportunities."
                    : "Create your free account to continue. Your search criteria will come with you."}
                </p>
                <a
                  href={result.signedIn ? result.radarHref : result.signupHref}
                  className="mt-4 inline-block rounded-xl bg-blue-600 px-5 py-3 font-bold"
                >
                  {result.signedIn
                    ? "Continue in Radar"
                    : "Create my free account"}{" "}
                  →
                </a>
              </div>
            ) : result.matches.length ? (
              <>
                <p className="mt-2 text-sm text-slate-300">
                  Showing {result.matches.length} of {result.total} matched
                  opportunities. Reasons reflect your search; qualifications
                  still need checking.
                </p>
                <div className="mt-6 grid items-start gap-5 lg:grid-cols-3">
                  {result.matches.map((match, index) => (
                    <article
                      key={match.id}
                      className="min-w-0 rounded-2xl border border-blue-300/20 bg-[#102342] p-6"
                    >
                      <p className="text-xs font-bold uppercase tracking-widest text-blue-300">
                        {index === 0
                          ? "Start your review here"
                          : `Opportunity ${index + 1}`}
                      </p>
                      <h3 className="mt-3 text-lg font-bold leading-snug">
                        <a
                          href={`/bid/${match.id}`}
                          className="hover:underline"
                        >
                          {match.title}
                        </a>
                      </h3>
                      <p className="mt-2 text-sm text-slate-300">
                        {[match.agency, match.location]
                          .filter(Boolean)
                          .join(" · ") ||
                          "Location not specified — check notice"}
                      </p>
                      <p className="mt-3 text-sm font-semibold text-blue-200">
                        {deadline(match)}
                      </p>
                      <h4 className="mt-5 text-sm font-bold">Why it matches</h4>
                      <ul className="mt-2 list-disc space-y-1 pl-4 text-sm text-slate-300">
                        {(match.reasons.length
                          ? match.reasons
                          : ["Review this opportunity against your services."]
                        ).map((reason, i) => (
                          <li key={i}>{reason}</li>
                        ))}
                      </ul>
                      <h4 className="mt-5 text-sm font-bold">What to verify</h4>
                      <p className="mt-2 text-sm text-slate-300">
                        {match.set_aside_label ||
                          "Set-aside not specified — verify solicitation"}
                      </p>
                      <ul className="mt-2 list-disc space-y-1 pl-4 text-sm text-slate-300">
                        {[...match.qualifications, ...match.requirements]
                          .slice(0, 3)
                          .map((requirement, i) => (
                            <li key={i}>{requirement}</li>
                          ))}
                      </ul>
                      <p className="mt-2 text-xs text-slate-400">
                        Your licensing, certification and capacity have not been
                        verified.
                      </p>
                      <h4 className="mt-5 text-sm font-bold">Your next step</h4>
                      <p className="mt-2 text-sm text-slate-300">
                        {match.next_action ||
                          "Read the official notice and confirm requirements before preparing a bid."}
                      </p>
                      <a
                        href={`/bid/${match.id}`}
                        className="mt-5 inline-flex font-semibold text-blue-200 underline underline-offset-4"
                      >
                        Review opportunity →
                      </a>
                    </article>
                  ))}
                </div>
                <div className="mt-7 flex flex-wrap items-center justify-between gap-5 rounded-2xl border border-blue-400/30 bg-blue-500/10 p-6">
                  <div>
                    <h3 className="text-xl font-bold">
                      Keep your next opportunity within reach.
                    </h3>
                    <p className="mt-2 text-sm text-slate-300">
                      {result.signedIn
                        ? "Continue in Radar to save and track opportunities."
                        : "Your search and preview matches carry through signup. No payment card required."}
                    </p>
                  </div>
                  <a
                    href={
                      result.signedIn ? result.radarHref : result.signupHref
                    }
                    onClick={() =>
                      trackEvent(
                        "radar_save_signup_clicked",
                        "homepage_shortlist",
                      )
                    }
                    className="rounded-xl bg-blue-600 px-5 py-4 text-center font-bold text-white hover:bg-blue-700"
                  >
                    {result.signedIn
                      ? "Continue to my matches"
                      : "Save my matches — create a free account"}{" "}
                    →
                  </a>
                </div>
              </>
            ) : (
              <div className="mt-5 rounded-2xl border border-white/20 bg-white/5 p-6">
                <h3 className="text-xl font-bold">
                  No direct matches found in this search.
                </h3>
                <p className="mt-2 text-slate-300">
                  Try a different service or a wider area. We won’t fill your
                  shortlist with unrelated jobs. Searches with no results don’t
                  use your free preview.
                </p>
                <a
                  href={result.radarHref}
                  className="mt-4 inline-block font-semibold text-blue-200 underline"
                >
                  Explore search options in Radar →
                </a>
              </div>
            )}
          </>
        ) : !busy && sample.length > 0 ? (
          <div className="border-t border-white/15 pt-7">
            <p className="text-xs font-bold uppercase tracking-widest text-slate-400">
              Live SDVOSB opportunities · Examples, not personalized matches
            </p>
            <div className="mt-4 grid gap-4 md:grid-cols-3">
              {sample.slice(0, 3).map((bid) => (
                <a
                  key={bid.id}
                  href={`/bid/${bid.id}`}
                  className="rounded-xl border border-white/15 bg-white/5 p-4 transition hover:bg-white/10"
                >
                  <span className="line-clamp-2 text-sm font-semibold">
                    {bid.title}
                  </span>
                  <span className="mt-2 block text-xs text-slate-400">
                    {[bid.agency, bid.location].filter(Boolean).join(" · ")}
                  </span>
                </a>
              ))}
            </div>
          </div>
        ) : null}
      </div>
    </section>
  );
}
