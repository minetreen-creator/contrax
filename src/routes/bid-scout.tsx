/**
 * Contrax Bid Scout — public sales + intake page (owner spec 2026-09-10,
 * Phase A: purchase path + intake/sales pages).
 *
 * First viewport: name, "Five government opportunities matched to your
 * business every Friday.", $99/month, the value bullets, the intake form and
 * the checkout CTA. `?checkout=cancelled` renders a small notice;
 * `?source=<placement>` is preserved in a hidden field and stored on the
 * subscription row as the Bid Scout CTA source (acquisition attribution is
 * never touched).
 *
 * NO analytics events in Phase A (bid_scout_* instrumentation is Phase B).
 * This page lives OUTSIDE every existing funnel by design.
 */
import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useRef, useState, type FormEvent } from "react";
import { trackEvent } from "~/lib/track";

export const Route = createFileRoute("/bid-scout")({
  head: () => ({
    meta: [
      {
        title:
          "Contrax Bid Scout — Five Government Opportunities Matched to Your Business Every Friday",
      },
      {
        name: "description",
        content:
          "$99/month. Five matched government opportunities every Friday — the strongest match, plain-English requirements, deadlines, major risks and recommended next steps.",
      },
    ],
  }),
  component: BidScoutPage,
});

const BULLETS = [
  "Five matched opportunities, every Friday",
  "One recommended best-fit highlighted each week",
  "Plain-English requirements — no legalese",
  "Deadlines that won't sneak up on you",
  "Major risks called out before you invest time",
  "Recommended next steps for every match",
  "Cancel anytime",
];

const INPUT_CLASS =
  "w-full rounded-xl border border-slate-300 bg-white px-4 py-2.5 text-sm text-slate-900 shadow-sm outline-none transition placeholder:text-slate-400 focus:border-slate-900 focus:ring-2 focus:ring-slate-900/10";
const LABEL_CLASS = "mb-1.5 block text-sm font-semibold text-slate-800";
const NOTE_CLASS = "mt-1 text-xs text-slate-500";

interface SubmitState {
  kind: "idle" | "submitting" | "error";
  message?: string;
}

function BidScoutPage() {
  // Query params are client-only (SSR renders the page without them).
  const [params] = useState(() => {
    const sp = new URLSearchParams(
      typeof window !== "undefined" ? window.location.search : "",
    );
    return {
      source: sp.get("source") || "",
      cancelled: sp.get("checkout") === "cancelled",
    };
  });

  const [submit, setSubmit] = useState<SubmitState>({ kind: "idle" });
  // Phase B analytics: one bid_scout_viewed per qualifying visitor view.
  // Same client effect + firewall-and-forget beacon as every other funnel
  // event: the intake handler applies the standard bot / QA / admin / test
  // exclusions, the 1s write-time dedupe collapses double-fires, and the
  // event name is standalone (no funnel stage membership). The useRef guard
  // mirrors radar_results_viewed so a re-render cannot double-fire.
  const viewedFired = useRef(false);
  useEffect(() => {
    if (viewedFired.current) return;
    viewedFired.current = true;
    trackEvent("bid_scout_viewed", params.source || "bid_scout_page", "/bid-scout");
  }, [params.source]);

  async function handleSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (submit.kind === "submitting") return;
    const form = e.currentTarget;
    const data = Object.fromEntries(new FormData(form).entries());
    setSubmit({ kind: "submitting" });
    try {
      const res = await fetch("/api/bid-scout/checkout", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(data),
      });
      const body = (await res.json().catch(() => ({}))) as {
        url?: string;
        error?: string;
      };
      if (res.ok && body.url) {
        window.location.href = body.url;
        return;
      }
      setSubmit({
        kind: "error",
        message:
          body.error || "We couldn't start checkout. Please try again in a moment.",
      });
    } catch {
      setSubmit({
        kind: "error",
        message: "Checkout is temporarily unavailable. Please try again.",
      });
    }
  }

  return (
    <div className="min-h-screen bg-slate-50">
      {/* ── Hero + intake (first viewport) ── */}
      <section className="border-b border-slate-200 bg-white">
        <div className="mx-auto grid max-w-6xl gap-10 px-4 py-12 sm:px-6 lg:grid-cols-2 lg:py-16">
          <div>
            <p className="text-sm font-semibold uppercase tracking-wider text-blue-600">
              Contrax Bid Scout
            </p>
            <h1 className="mt-3 text-3xl font-extrabold leading-tight tracking-tight text-slate-900 sm:text-4xl">
              Five government opportunities matched to your business every
              Friday.
            </h1>
            <p className="mt-4 text-lg text-slate-600">
              Stop scrolling procurement sites. Bid Scout curates the five
              best-fit federal opportunities for your company each week — and
              tells you what each one really takes.
            </p>
            <p className="mt-4 flex items-baseline gap-2">
              <span className="text-4xl font-extrabold text-slate-900">
                $99
              </span>
              <span className="text-sm font-medium text-slate-500">/month</span>
            </p>
            <ul className="mt-6 space-y-2.5">
              {BULLETS.map((b) => (
                <li key={b} className="flex items-start gap-2.5 text-sm text-slate-700">
                  <svg
                    className="mt-0.5 h-4 w-4 shrink-0 text-blue-600"
                    fill="none"
                    viewBox="0 0 24 24"
                    strokeWidth={2.5}
                    stroke="currentColor"
                    aria-hidden="true"
                  >
                    <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                  </svg>
                  {b}
                </li>
              ))}
            </ul>
          </div>

          {/* ── Intake form ── */}
          <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm sm:p-8">
            <h2 className="text-lg font-bold text-slate-900">
              Start Bid Scout
            </h2>
            <p className="mt-1 text-sm text-slate-500">
              Tell us about your business — we use this to match opportunities.
            </p>

            {params.cancelled && (
              <div className="mt-4 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
                Your checkout was cancelled — no charge was made. Your details
                are still here whenever you're ready.
              </div>
            )}

            <form onSubmit={handleSubmit} className="mt-5 space-y-4">
              <input type="hidden" name="source" value={params.source} />
              <div>
                <label htmlFor="bs-company" className={LABEL_CLASS}>
                  Company name <span className="text-rose-500">*</span>
                </label>
                <input
                  id="bs-company"
                  name="companyName"
                  type="text"
                  required
                  maxLength={200}
                  placeholder="Acme Construction LLC"
                  className={INPUT_CLASS}
                />
              </div>
              <div>
                <label htmlFor="bs-email" className={LABEL_CLASS}>
                  Work email <span className="text-rose-500">*</span>
                </label>
                <input
                  id="bs-email"
                  name="email"
                  type="email"
                  required
                  maxLength={254}
                  placeholder="you@acmeconstruction.com"
                  className={INPUT_CLASS}
                />
              </div>
              <div>
                <label htmlFor="bs-capabilities" className={LABEL_CLASS}>
                  Core capabilities <span className="text-rose-500">*</span>
                </label>
                <textarea
                  id="bs-capabilities"
                  name="capabilities"
                  required
                  maxLength={2000}
                  rows={3}
                  placeholder="e.g. General commercial construction, site work, design-build up to $5M"
                  className={INPUT_CLASS}
                />
                <p className={NOTE_CLASS}>
                  What you do, typical project size, past performance.
                </p>
              </div>
              <div>
                <label htmlFor="bs-website" className={LABEL_CLASS}>
                  Website
                </label>
                <input
                  id="bs-website"
                  name="website"
                  type="text"
                  maxLength={200}
                  placeholder="acmeconstruction.com"
                  className={INPUT_CLASS}
                />
              </div>
              <div>
                <label htmlFor="bs-naics" className={LABEL_CLASS}>
                  NAICS codes
                </label>
                <input
                  id="bs-naics"
                  name="naicsCodes"
                  type="text"
                  maxLength={500}
                  placeholder="236220, 236210"
                  className={INPUT_CLASS}
                />
              </div>
              <div>
                <label htmlFor="bs-certs" className={LABEL_CLASS}>
                  Certifications
                </label>
                <input
                  id="bs-certs"
                  name="certifications"
                  type="text"
                  maxLength={500}
                  placeholder="8(a), WOSB, SDVOSB, HUBZone"
                  className={INPUT_CLASS}
                />
              </div>
              <div>
                <label htmlFor="bs-states" className={LABEL_CLASS}>
                  Target states
                </label>
                <input
                  id="bs-states"
                  name="targetStates"
                  type="text"
                  maxLength={200}
                  placeholder="VA, MD, DC"
                  className={INPUT_CLASS}
                />
              </div>
              <div>
                <label htmlFor="bs-notes" className={LABEL_CLASS}>
                  Priorities or exclusions
                </label>
                <textarea
                  id="bs-notes"
                  name="notes"
                  maxLength={2000}
                  rows={2}
                  placeholder="e.g. No work outside the Mid-Atlantic; prefer design-build"
                  className={INPUT_CLASS}
                />
              </div>

              {submit.kind === "error" && (
                <div
                  role="alert"
                  className="rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700"
                >
                  {submit.message}
                </div>
              )}

              <button
                type="submit"
                disabled={submit.kind === "submitting"}
                className="w-full rounded-xl bg-slate-900 px-6 py-3.5 text-sm font-semibold text-white shadow-sm transition-all hover:bg-slate-800 active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-60"
              >
                {submit.kind === "submitting"
                  ? "Starting checkout…"
                  : "Start Bid Scout — $99/month"}
              </button>
              <p className="text-center text-xs text-slate-400">
                Secure checkout · Cancel anytime · First report by the Friday
                after we review your capabilities
              </p>
            </form>
          </div>
        </div>
      </section>

      {/* ── How it works (below the fold) ── */}
      <section className="mx-auto max-w-6xl px-4 py-14 sm:px-6">
        <h2 className="text-2xl font-extrabold tracking-tight text-slate-900">
          How it works
        </h2>
        <div className="mt-8 grid gap-6 sm:grid-cols-3">
          {[
            {
              n: "1",
              t: "Tell us about your business",
              d: "Capabilities, NAICS codes, certifications, and where you want to work.",
            },
            {
              n: "2",
              t: "We match every week",
              d: "Our matching engine scans federal opportunities against your profile.",
            },
            {
              n: "3",
              t: "You get five every Friday",
              d: "A plain-English report: strongest match, requirements, deadlines, risks, next steps.",
            },
          ].map((s) => (
            <div
              key={s.n}
              className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm"
            >
              <span className="flex h-9 w-9 items-center justify-center rounded-lg bg-blue-600 text-sm font-bold text-white">
                {s.n}
              </span>
              <h3 className="mt-4 font-bold text-slate-900">{s.t}</h3>
              <p className="mt-1.5 text-sm text-slate-600">{s.d}</p>
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}