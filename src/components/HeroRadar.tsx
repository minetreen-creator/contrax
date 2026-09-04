/**
 * HeroRadar — the Contract Radar interactive match-finder, embedded in the
 * homepage hero region (owner-directed 2026-09-04: "the homepage hero BE the
 * radar match-finder").
 *
 * This is the SAME proven /radar walk, not a parallel implementation:
 *   - trade/NAICS → state → cert → size questions, scan disabled until all set
 *   - REAL scan via runRadarScan (~/routes/radar — the single ranking source of
 *     truth; no new ranking logic, no fabricated data, no fake urgency/counts)
 *   - first 3 matches free, revealed one at a time, with FULL incumbent intel
 *     (the only free place — SHOW_FREE_INCUMBENT path, reused verbatim)
 *   - SignupGate at match 4 (R2 brief-mode CTA: radarSignupHref → /dashboard?brief=1)
 *   - Save-your-matches lead capture (SaveMatchesCard, anonymous-only)
 *   - honest copy only; source line names the real SAM.gov + state/city sync
 *
 * Reuse, not duplication: RadarCard / SignupGate / SaveMatchesCard /
 * RADAR_CERTS / SIZE_OPTS / RadarCert / SizeId / RadarMatch / runRadarScan all
 * come from ~/routes/radar. Only the question form + scan orchestration live
 * here (a compact clone of RadarLanding's step-1/step-2/step-3 state machine,
 * tuned for the hero's horizontal space), and the funnel events carry a
 * "hero_" prefix so hero scans stay distinguishable from /radar scans.
 *
 * Props:
 *   initialCert — the homepage "I am a:" selection (shared cert state). When it
 *     is a real radar cert id it preselects the cert question (same mapping the
 *     hero search already uses); "all"/unknown leaves the question unanswered.
 */
import { useEffect, useRef, useState } from "react";
import {
  RADAR_CERTS,
  SIZE_OPTS,
  runRadarScan,
  RadarCard,
  SignupGate,
  SaveMatchesCard,
  type RadarCert,
  type SizeId,
  type RadarMatch,
} from "~/routes/radar";
import { US_STATES } from "~/lib/states";
import { NAICS_NAMES } from "~/lib/naics-names";
import { trackEvent } from "~/lib/track";
import { getTrackingUser } from "~/lib/identity";
import {
  getRadarAnswers,
  getRadarSeen,
  saveRadarSeen,
  saveRadarAnswers,
} from "~/lib/radar-session";

const CERT_LABEL: Record<string, string> = {
  sdvosb: "SDVOSB",
  "8a": "8(a)",
  wosb: "WOSB",
  hubzone: "HUBZone",
  sb: "Small Business",
};

type ScanState =
  | { status: "idle" }
  | { status: "loading" }
  | { status: "done"; matches: RadarMatch[]; certLabel: string }
  | { status: "error" };

const NAICS_SUGGESTIONS = Object.entries(NAICS_NAMES).slice(0, 120);

function toRadarCert(raw: unknown): RadarCert | null {
  const c = String(raw ?? "").trim();
  return (RADAR_CERTS as readonly string[]).includes(c) ? (c as RadarCert) : null;
}

export function HeroRadar({ initialCert }: { initialCert: string }) {
  const preselected = toRadarCert(initialCert);
  const [trade, setTrade] = useState("");
  const [state, setState] = useState("");
  const [cert, setCert] = useState<RadarCert | null>(preselected);
  const [sizePref, setSizePref] = useState<SizeId | null>(null);
  const [scan, setScan] = useState<ScanState>({ status: "idle" });
  const [revealed, setRevealed] = useState(0);
  const [nudgeDismissed, setNudgeDismissed] = useState(false);
  const [flashTimer, setFlashTimer] = useState<number | null>(null);
  // Restored-once guard: saved answers (localStorage) prefill the hero form on
  // first paint only — the visitor's own edits always win after that.
  const restoredRef = useRef(false);
  const didInteract = useRef(false);

  // Follow the homepage "I am a:" chips: when the visitor picks a real cert up
  // top, the hero finder reflects it — unless they already chose a cert here
  // themselves (their explicit choice wins).
  useEffect(() => {
    if (didInteract.current) return;
    const next = toRadarCert(initialCert);
    if (next) setCert(next);
  }, [initialCert]);

  // Prefill from a previous radar session (same store /radar reads), once.
  useEffect(() => {
    if (restoredRef.current) return;
    restoredRef.current = true;
    try {
      const ra = getRadarAnswers();
      if (!ra) return;
      if (ra.trade) setTrade(ra.trade);
      if (ra.state) setState(ra.state);
      if (!preselected && (RADAR_CERTS as readonly string[]).includes(ra.cert)) {
        setCert(ra.cert as RadarCert);
      }
      if ((SIZE_OPTS as readonly { id: string }[]).some((s) => s.id === ra.sizePref)) {
        setSizePref(ra.sizePref as SizeId);
      }
    } catch { /* storage unavailable — form stays blank, still fully usable */ }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    return () => {
      if (flashTimer) window.clearTimeout(flashTimer);
    };
  }, [flashTimer]);

  // Persist criteria as they answer (same shared store /radar + hero search use).
  useEffect(() => {
    if (!cert || !sizePref) return;
    if (!didInteract.current) return;
    saveRadarAnswers({ trade: trade.trim(), state, cert, sizePref });
  }, [trade, state, cert, sizePref]);

  const ready = trade.trim() !== "" && state !== "" && cert !== null && sizePref !== null;

  const handleRevealNext = () => {
    const next = revealed + 1;
    trackEvent("hero_radar_next_match", scan.status === "done" ? scan.certLabel : "");
    if (scan.status === "done") {
      const existing = getRadarSeen();
      if (existing) saveRadarSeen({ ...existing, seenCount: Math.min(next, existing.matches.length) });
    }
    setRevealed(next);
  };

  const startScan = () => {
    if (!ready) return;
    const input = { trade: trade.trim(), state, cert: cert!, sizePref: sizePref! };
    didInteract.current = true;
    trackEvent("hero_radar_scan_start", input.cert);
    // Persist the criteria now (the save effect above only fires on change).
    saveRadarAnswers({ trade: input.trade, state: input.state, cert: input.cert, sizePref: input.sizePref });
    setScan({ status: "loading" });
    setRevealed(0);
    setNudgeDismissed(false);
    const t = window.setTimeout(() => {
      runRadarScan({ data: { trade: input.trade, state: input.state, cert: input.cert, sizePref: input.sizePref } })
        .then((res) => {
          if (flashTimer) window.clearTimeout(flashTimer);
          trackEvent("hero_radar_scan_complete", input.cert);
          if (res.matches.length > 0) trackEvent("hero_radar_nudge_shown", res.certLabel);
          saveRadarSeen({
            answers: { trade: input.trade, state: input.state, cert: input.cert, sizePref: input.sizePref },
            certLabel: res.certLabel,
            total: res.matches.length,
            seenCount: 0,
            matches: res.matches.map((m) => ({
              id: m.id,
              title: m.title,
              agency: m.agency,
              score: m.score,
              score_label: m.score_label,
              due_date: m.due_date,
              source_url: m.source_url,
            })),
          });
          setScan({ status: "done", matches: res.matches, certLabel: res.certLabel });
        })
        .catch(() => {
          if (flashTimer) window.clearTimeout(flashTimer);
          setScan({ status: "error" });
        });
    }, 1100);
    setFlashTimer(t);
  };

  const track = trade.trim() || "any";
  const stateLabel = state ? ` / ${state}` : "";
  const tradeLabel = !track || track === "any" ? "broad market" : `"${track}"`;

  return (
    <section
      id="hero-radar"
      aria-label="Contract Radar — find your set-aside matches"
      className="border-b border-slate-800 bg-slate-950"
    >
      <div className="mx-auto w-full max-w-xl px-5 py-10 sm:py-12">
        <p className="text-xs font-semibold uppercase tracking-widest text-amber-400">Contract Radar</p>
        <h2 className="mt-2 text-2xl font-bold leading-tight text-white sm:text-3xl">
          Wondering which set-asides you actually qualify for? Your first 3 matches are free.
        </h2>
        <p className="mt-3 text-sm leading-relaxed text-slate-300">
          Answer four quick questions and we&apos;ll reveal your strongest live
          set-aside matches — one at a time, with a real match score and full
          Incumbent Intelligence (previous winner &amp; award price).
        </p>

        {scan.status !== "done" && scan.status !== "error" && (
          <div className="mt-8 flex flex-col gap-6">
            <div>
              <label htmlFor="hero-radar-trade" className="text-sm font-semibold text-slate-200">
                1. Your trade or NAICS code
              </label>
              <input
                id="hero-radar-trade"
                list="hero-radar-naics-list"
                value={trade}
                onChange={(e) => {
                  didInteract.current = true;
                  setTrade(e.target.value);
                }}
                placeholder='e.g. "HVAC" or a 6-digit NAICS like 238220'
                className="mt-2 w-full rounded-2xl border-2 border-slate-700 bg-slate-900 px-5 py-4 text-base text-white placeholder:text-slate-500 focus:border-amber-500 focus:outline-none focus-visible:ring-2 focus-visible:ring-amber-400"
              />
              <datalist id="hero-radar-naics-list">
                {NAICS_SUGGESTIONS.map(([code, name]) => (
                  <option key={code} value={code}>{`${code} — ${name}`}</option>
                ))}
              </datalist>
            </div>

            <div>
              <label htmlFor="hero-radar-state" className="text-sm font-semibold text-slate-200">
                2. Your state
              </label>
              <select
                id="hero-radar-state"
                value={state}
                onChange={(e) => {
                  didInteract.current = true;
                  setState(e.target.value);
                }}
                className="mt-2 w-full rounded-2xl border-2 border-slate-700 bg-slate-900 px-5 py-4 text-base text-white focus:border-amber-500 focus:outline-none focus-visible:ring-2 focus-visible:ring-amber-400"
              >
                <option value="">Any state (nationwide)</option>
                {US_STATES.map((s) => (
                  <option key={s} value={s}>{s}</option>
                ))}
              </select>
            </div>

            <div>
              <p className="text-sm font-semibold text-slate-200">3. Your set-aside certification</p>
              <div role="list" className="mt-2 grid grid-cols-2 gap-2 sm:grid-cols-3">
                {RADAR_CERTS.map((c) => (
                  <button
                    key={c}
                    type="button"
                    role="listitem"
                    onClick={() => {
                      didInteract.current = true;
                      setCert(c);
                      trackEvent("hero_radar_cert_selected", c);
                    }}
                    aria-pressed={cert === c}
                    className={`rounded-xl border-2 px-4 py-3 text-left text-sm font-semibold transition-all active:scale-[0.98] ${
                      cert === c
                        ? "border-amber-500 bg-amber-500/15 text-amber-300"
                        : "border-slate-700 bg-slate-900 text-slate-200 hover:border-slate-500"
                    }`}
                  >
                    {CERT_LABEL[c]}
                  </button>
                ))}
              </div>
            </div>

            <div>
              <p className="text-sm font-semibold text-slate-200">4. Preferred contract size</p>
              <div role="list" className="mt-2 grid grid-cols-2 gap-2">
                {SIZE_OPTS.map((s) => (
                  <button
                    key={s.id}
                    type="button"
                    role="listitem"
                    onClick={() => {
                      didInteract.current = true;
                      setSizePref(s.id);
                      trackEvent("hero_radar_size_selected", s.id);
                    }}
                    aria-pressed={sizePref === s.id}
                    className={`rounded-xl border-2 px-4 py-3 text-left transition-all active:scale-[0.98] ${
                      sizePref === s.id
                        ? "border-amber-500 bg-amber-500/15"
                        : "border-slate-700 bg-slate-900 hover:border-slate-500"
                    }`}
                  >
                    <span className="block text-sm font-semibold text-white">{s.label}</span>
                    <span className="block text-xs text-slate-400">{s.hint}</span>
                  </button>
                ))}
              </div>
            </div>

            <button
              type="button"
              disabled={!ready}
              onClick={startScan}
              className="mt-2 w-full rounded-2xl bg-amber-500 px-6 py-4 text-base font-bold text-slate-950 shadow-lg transition-all hover:bg-amber-400 active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-50"
            >
              Scan the market for my matches →
            </button>
            {scan.status === "loading" ? (
              <div className="rounded-2xl border-2 border-amber-500 bg-amber-500/10 px-6 py-8 text-center" aria-live="polite">
                <p className="text-xl font-extrabold tracking-tight text-amber-400">
                  Contract Radar is scanning the market…
                </p>
                <p className="mt-2 text-sm text-slate-300">
                  Matching live solicitation data against your{" "}
                  {cert ? CERT_LABEL[cert] : ""} certification
                  {state ? ` in ${state}` : " nationwide"}.
                </p>
              </div>
            ) : (
              <p className="text-center text-xs text-slate-500">
                Scans live set-aside solicitations from SAM.gov and state &amp; city
                sources — real results, updated every 4 hours.
              </p>
            )}
          </div>
        )}

        {scan.status === "error" && (
          <div className="mt-8" role="alert">
            <p className="text-center text-amber-400">
              We couldn&apos;t scan the market right now. Please try again in a moment.
            </p>
            <button
              type="button"
              onClick={startScan}
              className="mx-auto mt-6 w-full rounded-2xl bg-amber-500 px-6 py-4 font-bold text-slate-950 hover:bg-amber-400"
            >
              Try again
            </button>
          </div>
        )}

        {scan.status === "done" && (
          <div className="mt-8 flex flex-col">
            <button
              type="button"
              onClick={() => { setScan({ status: "idle" }); setRevealed(0); setNudgeDismissed(false); }}
              className="self-start text-sm text-slate-400 hover:text-slate-200"
            >
              ← Adjust my answers
            </button>
            <div className="mt-4 flex items-end justify-between">
              <div>
                <h3 className="text-xl font-bold text-white sm:text-2xl">Your top matches</h3>
                <p className="mt-1 text-sm text-slate-400">
                  {scan.certLabel}{stateLabel} · {tradeLabel} · real scores
                </p>
              </div>
              <span className="text-xs font-semibold text-amber-400">
                {scan.matches.length} found
              </span>
            </div>
            {scan.matches.length > 0 && (
              <p className="mt-3 text-xs font-medium text-slate-500">
                Free preview: you&apos;ve seen{" "}
                <span className="font-semibold text-amber-400">
                  {Math.min(revealed + 1, Math.min(3, scan.matches.length))}
                </span>{" "}
                of {Math.min(3, scan.matches.length)} free{" "}
                {Math.min(3, scan.matches.length) === 1 ? "match" : "matches"} — every one with full incumbent intel
              </p>
            )}

            {scan.matches.length === 0 && (
              <div className="mt-6 rounded-2xl border border-dashed border-slate-700 bg-slate-900/60 px-5 py-10 text-center text-sm text-slate-300">
                We couldn&apos;t find an open {scan.certLabel} solicitation matching
                your exact criteria right now. Try broadening your trade, state,
                or contract size.
              </div>
            )}

            {scan.matches.length > 0 && revealed < scan.matches.length && (
              <div className="mt-6">
                <RadarCard
                  match={scan.matches[revealed]}
                  certLabel={scan.certLabel}
                  index={revealed + 1}
                  trade={trade}
                  state={state}
                  cert={cert}
                  sizePref={sizePref}
                />
                {revealed < Math.min(2, scan.matches.length - 1) ? (
                  <button
                    type="button"
                    onClick={handleRevealNext}
                    className="mt-5 w-full rounded-2xl bg-amber-500 px-6 py-4 text-base font-bold text-slate-950 shadow-lg transition-all hover:bg-amber-400 active:scale-[0.98]"
                  >
                    Reveal my next match →
                  </button>
                ) : (
                  <SignupGate
                    certLabel={scan.certLabel}
                    totalFound={scan.matches.length}
                    trade={trade}
                    state={state}
                    cert={cert}
                    sizePref={sizePref}
                  />
                )}
              </div>
            )}

            {scan.matches.length > 0 && revealed >= scan.matches.length && revealed >= 3 && (
              <div className="mt-6">
                <SignupGate
                  certLabel={scan.certLabel}
                  totalFound={scan.matches.length}
                  trade={trade}
                  state={state}
                  cert={cert}
                  sizePref={sizePref}
                />
              </div>
            )}
            {!getTrackingUser() && scan.matches.length > 0 && revealed >= 1 && (
              <SaveMatchesCard
                certLabel={scan.certLabel}
                trade={trade}
                state={state}
                cert={cert ?? ""}
                sizePref={sizePref ?? ""}
                matchedCount={scan.matches.length}
              />
            )}
          </div>
        )}
      </div>
    </section>
  );
}
