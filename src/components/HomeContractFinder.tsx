import { useEffect, useRef, useState, type FormEvent } from "react";
import { displayTitle } from "~/lib/bid-title";
import { agencyDisplay } from "~/lib/bid-job-summary";
import { ArrowRight, CheckCircle2, LoaderCircle } from "lucide-react";
import type { EverydaySampleBid } from "~/lib/sample-bids";
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
import { CheckoutTrust } from "~/components/CheckoutTrust";
import { redirectToCheckout } from "~/lib/checkout";
import { ADDRESS_TIP, ADDRESS_TIP_ES, isKnownTrade, looksLikeAddress, notATradeLine } from "~/lib/trade-input";
import { STARTER_FIRST_MONTH_PRICE } from "~/lib/starter-offer";

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
// Welding added 2026-11-02 (owner: a Waco welder searched it from Facebook).
// Owner 2026-11-02 (design critique, "do all but 4"): the trades the people
// who visit actually run. IT, security and trucking still work by typing.
export const QUICK_TRADES = ["Landscaping", "Janitorial", "HVAC", "Plumbing", "Roofing", "Electrical", "Welding", "Construction"];

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
    titleCount: (n: string) => `${n} government bids open right now.`,
    titleCountTail: "See the ones for your business.",
    titleFallback: "Your next government customer",
    titleFallbackTail: "starts here.",
    sub: "Federal, state, city, county and school bids in all 50 states, matched to your trade.",
    checks: ["Real government bids", "No card to search", "No automatic renewal"],
    veteran: "Built with veteran-owned businesses in mind. Open to every small business.",
    local: "Explore city & county bids →",
    xray: "Who's winning near you? Look up a competitor →",
    cardTitle: "What does your business do?",
    tradePlaceholder: "Other trade",
    everyState: "Every state",
    cta: "Find my matches",
    busy: "Searching live opportunities…",
    needTrade: "Enter the service or six-digit NAICS code you want to search.",
    trades: {} as Record<string, string>,
  },
  es: {
    titleCount: (n: string) => `${n} licitaciones del gobierno abiertas ahora.`,
    titleCountTail: "Vea las que son para su negocio.",
    titleFallback: "Su próximo cliente del gobierno",
    titleFallbackTail: "empieza aquí.",
    sub: "Licitaciones federales, estatales, municipales, de condados y escuelas en los 50 estados y Puerto Rico, según su oficio.",
    checks: ["Licitaciones reales del gobierno", "Sin tarjeta para buscar", "Sin renovación automática"],
    veteran: "Pensado para negocios de veteranos. Abierto a todo pequeño negocio.",
    local: "Ver licitaciones de ciudades y condados →",
    xray: "¿Quién gana contratos cerca de usted? Busque un competidor →",
    cardTitle: "¿A qué se dedica su negocio?",
    tradePlaceholder: "Otro oficio",
    everyState: "Todos los estados",
    cta: "Ver mis oportunidades",
    busy: "Buscando licitaciones…",
    needTrade: "Escriba el servicio o el código NAICS de seis dígitos que quiere buscar.",
    trades: {
      Janitorial: "Limpieza",
      Landscaping: "Jardinería",
      Construction: "Construcción",
      HVAC: "Aire acondicionado",
      Plumbing: "Plomería",
      Roofing: "Techos",
      Electrical: "Electricidad",
      Welding: "Soldadura",
    } as Record<string, string>,
  },
} as const;

/** "Due Nov 12" from a stored due date, or null. */
function dueLabel(due: string | null): string | null {
  if (!due) return null;
  const d = new Date(due);
  if (Number.isNaN(d.getTime())) return null;
  return `Due ${d.toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "America/New_York" })}`;
}

export function HomeContractFinder({ sample, openTotal = 0 }: { sample: EverydaySampleBid[]; openTotal?: number }) {
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
    // Owner 2026-11-03: an address typed into the trade box got "0 matches".
    if (looksLikeAddress(answers.trade)) {
      trackEvent("home_address_in_trade", answers.trade.slice(0, 40));
      setError(lang === "es" ? ADDRESS_TIP_ES : ADDRESS_TIP);
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
      <div className="relative mx-auto grid max-w-7xl items-center gap-5 px-4 pb-14 pt-4 sm:gap-12 sm:px-8 sm:pb-20 sm:pt-16 lg:grid-cols-[1.1fr_1fr] lg:gap-16 lg:pb-24">
        <div>
          <div className="mb-3 inline-flex rounded-full border border-white/20 bg-white/5 p-1 text-xs font-bold sm:mb-4" role="group" aria-label="Language / Idioma">
            {(["en", "es"] as const).map((l) => (
              <button
                key={l}
                type="button"
                aria-pressed={lang === l}
                onClick={() => chooseLang(l)}
                className={`min-h-9 rounded-full px-3 py-1.5 transition ${lang === l ? "bg-white text-slate-900" : "text-blue-100 hover:text-white"}`}
              >
                {l === "en" ? "English" : "Español"}
              </button>
            ))}
          </div>
          <h1
            id="first-contract-title"
            className="max-w-2xl text-[1.75rem] font-extrabold leading-[1.12] tracking-tight [text-wrap:balance] sm:text-5xl lg:text-6xl"
          >
            {openTotal > 0
              ? `${c.titleCount(openTotal.toLocaleString("en-US"))} ${c.titleCountTail}`
              : `${c.titleFallback} ${c.titleFallbackTail}`}
          </h1>
          <p className="mt-5 hidden max-w-xl text-lg leading-relaxed text-slate-300 sm:mt-6 sm:block">
            {c.sub}
          </p>
          <p className="mt-6 hidden text-sm leading-relaxed text-slate-400 sm:block">
            {c.veteran}
          </p>
          <a
            href="/local-bids"
            className="mt-5 hidden text-sm font-semibold text-blue-200 underline underline-offset-4 hover:text-white sm:inline-block"
          >
            {c.local}
          </a>
          {/* Competitor X-Ray (owner 2026-11-08: "a secondary tab or homepage bar"). */}
          <a
            href="/competitor-xray"
            className="mt-2 hidden text-sm font-semibold text-amber-300 underline underline-offset-4 hover:text-white sm:block"
          >
            {c.xray}
          </a>
        </div>
        <div className="rounded-2xl bg-white p-4 text-slate-950 shadow-xl shadow-black/30 sm:rounded-3xl sm:p-8">
          <h2 className="text-xl font-bold tracking-tight sm:text-2xl">
            {c.cardTitle}
          </h2>
          <form
            onSubmit={search}
            className="mt-3 space-y-3 sm:mt-5 sm:space-y-4"
            aria-label="Find my first contract"
            aria-busy={busy}
          >
            <div className="grid grid-cols-2 gap-2 sm:flex sm:flex-wrap" role="group" aria-label="Popular trades">
              {QUICK_TRADES.map((t) => (
                <button
                  key={t}
                  type="button"
                  disabled={busy}
                  aria-pressed={trade === t}
                  onClick={() => { setTrade(t); setError(""); }}
                  className={`min-h-11 rounded-xl border px-3 py-2 text-sm font-semibold transition sm:rounded-full ${
                    trade === t ? "border-amber-500 bg-amber-500 text-slate-950" : "border-slate-300 bg-white text-slate-700 hover:border-amber-400"
                  }`}
                >
                  {c.trades[t] ?? t}
                </button>
              ))}
            </div>
            <div className="grid grid-cols-2 gap-2 sm:gap-4">
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
              className="flex min-h-14 w-full items-center justify-center gap-3 rounded-xl bg-amber-500 px-5 py-4 text-base font-bold text-slate-950 transition hover:bg-amber-400 focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-amber-500 disabled:cursor-wait disabled:opacity-70"
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
            <ul className="flex flex-wrap justify-center gap-x-4 gap-y-1 text-xs font-medium text-slate-600" aria-label="Good to know">
              {c.checks.map((text) => (
                <li key={text} className="inline-flex items-center gap-1.5">
                  <CheckCircle2 aria-hidden="true" className="h-3.5 w-3.5 text-emerald-600" />
                  {text}
                </li>
              ))}
            </ul>
            {error && (error === ADDRESS_TIP || error === ADDRESS_TIP_ES) ? (
              <p role="alert" className="rounded-lg bg-amber-50 px-3 py-2 text-sm font-medium text-amber-900">
                {error}
              </p>
            ) : error ? (
              <p role="alert" className="text-sm text-red-700">
                {error}{" "}
                <a href="/radar" className="font-semibold underline">
                  Open Radar →
                </a>
              </p>
            ) : null}
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
                  className="mt-4 inline-block rounded-xl bg-amber-500 px-5 py-3 font-bold text-slate-950 hover:bg-amber-400"
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
                  {result.total > result.matches.length
                    ? `${result.total} open bids found. Here ${result.matches.length === 1 ? "is your best one" : `are your best ${result.matches.length}`}.`
                    : `${result.total} open ${result.total === 1 ? "bid" : "bids"} found.`}
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
                      {/* Owner 2026-11-02 (design critique): no "not specified"
                          line repeated as something to verify. */}
                      {[...match.qualifications, ...match.requirements].length > 0 && (
                        <>
                          <h4 className="mt-5 text-sm font-bold">What to check</h4>
                          <ul className="mt-2 list-disc space-y-1 pl-4 text-sm text-slate-300">
                            {[...new Set([...match.qualifications, ...match.requirements])]
                              .slice(0, 3)
                              .map((requirement, i) => (
                                <li key={i}>{requirement}</li>
                              ))}
                          </ul>
                        </>
                      )}
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
                {/* Owner 2026-11-02 (design critique): right after "1 of 25" is
                    the moment of most interest; it names the $5 pass first and
                    keeps the free account as a quiet second choice. */}
                {!result.signedIn && result.total > result.matches.length ? (
                  <div className="mt-7 rounded-2xl border border-amber-300/50 bg-amber-400/10 p-6">
                    <h3 className="text-xl font-bold">
                      {result.total - result.matches.length} more {result.answers.trade ? `${result.answers.trade.slice(0, 40)} ` : ""}bids
                      {result.answers.state ? ` in ${STATE_NAMES[result.answers.state] ?? result.answers.state}` : ""} are waiting.
                    </h3>
                    <p className="mt-2 text-sm text-slate-200">
                      Open every official notice, and get each new bid in your trade at 6 AM, for 30 days. One time, no automatic renewal.
                    </p>
                    <a
                      href="/upgrade?plan=starter"
                      onClick={(e) => {
                        // Pay first, account after (CEO 2026-10-22): straight to Stripe.
                        e.preventDefault();
                        trackEvent("home_results_pass_click", String(result.total));
                        void redirectToCheckout("starter");
                      }}
                      className="mt-4 inline-block rounded-xl bg-amber-400 px-6 py-4 text-center text-base font-bold text-slate-950 hover:bg-amber-300"
                    >
                      See all {result.total} for ${STARTER_FIRST_MONTH_PRICE} →
                    </a>
                    <CheckoutTrust tone="dark" className="mt-2" />
                    <p className="mt-3 text-sm text-slate-300">
                      Not ready?{" "}
                      <a
                        href={result.signupHref}
                        onClick={() => trackEvent("radar_save_signup_clicked", "homepage_shortlist")}
                        className="font-semibold text-blue-200 underline underline-offset-4"
                      >
                        Save these matches with a free account
                      </a>
                    </p>
                  </div>
                ) : (
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
                    className="rounded-xl bg-amber-500 px-5 py-4 text-center font-bold text-slate-950 hover:bg-amber-400"
                  >
                    {result.signedIn
                      ? "Continue to my matches"
                      : "Save my matches — create a free account"}{" "}
                    →
                  </a>
                </div>
                )}
              </>
            ) : (
              <div className="mt-5 rounded-2xl border border-white/20 bg-white/5 p-6">
                <h3 className="text-xl font-bold">
                  No direct matches found in this search.
                </h3>
                <p className="mt-2 text-slate-300">
                  {isKnownTrade(result.answers.trade)
                    ? "Try a different service or a wider area. We won’t fill your shortlist with unrelated jobs."
                    : notATradeLine(result.answers.trade)}{" "}
                  Searches with no results don’t use your free preview.
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
              Open right now · a few real examples
            </p>
            <div className="mt-4 grid gap-4 md:grid-cols-3">
              {sample.slice(0, 3).map((bid) => (
                <a
                  key={bid.id}
                  href={`/bid/${bid.id}`}
                  className="rounded-xl border border-white/15 bg-white/5 p-4 transition hover:bg-white/10"
                >
                  {bid.trade ? (
                    <span className="mb-1.5 block text-[11px] font-bold uppercase tracking-wide text-blue-300">{bid.trade}</span>
                  ) : null}
                  <span className="line-clamp-2 text-sm font-semibold">
                    {displayTitle(bid.title)}
                  </span>
                  <span className="mt-2 block text-xs text-slate-400">
                    {[agencyDisplay(bid.agency), bid.location, dueLabel(bid.due_date)].filter(Boolean).join(" · ")}
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
