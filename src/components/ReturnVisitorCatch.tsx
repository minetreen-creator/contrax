import { useEffect, useState } from "react";
import { useLocation } from "@tanstack/react-router";
import { resolveTrackingUser } from "~/lib/identity";
import { getRadarAnswers } from "~/lib/radar-session";
import { isAutomatedBrowser, trackEvent } from "~/lib/track";
import { trackingIds } from "~/lib/visitor";
import {
  hasGivenEmail,
  localDay,
  markEmailGiven,
  returnStage,
  SLIDE_CLOSED_KEY,
  VISIT_DAYS_KEY,
  withToday,
  type ReturnStage,
} from "~/lib/return-visitor";

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function read(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}
function write(key: string, value: string): void {
  try {
    localStorage.setItem(key, value);
  } catch {
    /* storage blocked */
  }
}

/**
 * Returning-visitor catch (src/lib/return-visitor.ts): a slide-up on a
 * visitor's 2nd day, a full-page email gate from the 3rd. Client only, after
 * mount, so the server HTML (what search engines see) never changes.
 */
export function ReturnVisitorCatch() {
  const { pathname } = useLocation();
  const [days, setDays] = useState(0);
  const [signedIn, setSignedIn] = useState<boolean | null>(null);
  const [done, setDone] = useState(false);
  const [closedToday, setClosedToday] = useState(false);

  useEffect(() => {
    if (isAutomatedBrowser()) return;
    const today = localDay();
    let list: unknown = null;
    try {
      list = JSON.parse(read(VISIT_DAYS_KEY) ?? "null");
    } catch {
      list = null;
    }
    const next = withToday(list, today);
    write(VISIT_DAYS_KEY, JSON.stringify(next));
    setDays(next.length);
    setClosedToday(read(SLIDE_CLOSED_KEY) === today);
    setDone(hasGivenEmail());
    resolveTrackingUser().then((u) => setSignedIn(!!u));
  }, []);

  const stage: ReturnStage =
    signedIn === null || days === 0 ? "none" : returnStage({ visitDays: days, hasEmail: done, signedIn, path: pathname, slideClosedToday: closedToday });

  useEffect(() => {
    if (stage !== "none") trackEvent(stage === "gate" ? "return_gate_shown" : "return_slide_shown", String(days));
  }, [stage, days]);

  if (stage === "none") return null;
  const closeSlide = () => {
    write(SLIDE_CLOSED_KEY, localDay());
    setClosedToday(true);
    trackEvent("return_slide_closed", String(days));
  };
  const onCaptured = () => {
    markEmailGiven();
    trackEvent(stage === "gate" ? "return_gate_email" : "return_slide_email", String(days));
    setDone(true);
  };

  if (stage === "slide") {
    return (
      <div role="dialog" aria-label="Get new bids by email" className="fixed inset-x-3 bottom-3 z-50 mx-auto max-w-md rounded-2xl border border-amber-300 bg-white p-4 shadow-2xl sm:left-5 sm:right-auto sm:mx-0 sm:bottom-5">
        <button type="button" onClick={closeSlide} aria-label="Close" className="absolute right-3 top-2 text-lg text-slate-400 hover:text-slate-700">
          ✕
        </button>
        <p className="pr-6 text-base font-extrabold text-slate-900">Welcome back! 👋</p>
        <p className="mt-1 text-sm text-slate-600">Want the new government bids for your area sent to you, so you don&apos;t have to keep checking? 📬</p>
        <CatchForm source="return_slide" cta="Send them" onCaptured={onCaptured} />
      </div>
    );
  }

  return (
    <div role="dialog" aria-modal="true" aria-label="Keep browsing" className="fixed inset-0 z-[70] flex items-center justify-center bg-slate-950/80 p-4 backdrop-blur-sm">
      <div className="w-full max-w-md rounded-2xl bg-white p-6 text-center shadow-2xl">
        <p className="text-4xl">👋</p>
        <h2 className="mt-2 text-2xl font-extrabold text-slate-900">Welcome back</h2>
        <p className="mt-2 text-sm leading-relaxed text-slate-600">
          You keep coming back, so let&apos;s make it easy. Enter your email to keep browsing, and we&apos;ll send you new bids for your area as they post.
        </p>
        <CatchForm source="return_gate" cta="Keep browsing →" onCaptured={onCaptured} />
        <p className="mt-3 text-xs text-slate-500">
          Free. No password. No credit card. Unsubscribe anytime. Have an account?{" "}
          <a href={`/login?next=${encodeURIComponent(pathname)}`} className="font-semibold underline">
            Sign in
          </a>
        </p>
      </div>
    </div>
  );
}

function CatchForm({ source, cta, onCaptured }: { source: string; cta: string; onCaptured: () => void }) {
  const [email, setEmail] = useState("");
  const [status, setStatus] = useState<"idle" | "submitting" | "error">("idle");
  const [error, setError] = useState("");
  const submit = async (e: { preventDefault: () => void }) => {
    e.preventDefault();
    const normalized = email.trim().toLowerCase();
    if (!EMAIL_PATTERN.test(normalized) || normalized.length > 254) {
      setError("Please enter a valid email address.");
      setStatus("error");
      return;
    }
    setError("");
    setStatus("submitting");
    // Alerts follow what they last searched on Contract Radar, when they have.
    const last = getRadarAnswers();
    const ids = trackingIds();
    try {
      const res = await fetch("/api/radar/lead", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          email: normalized,
          trade: last?.trade || undefined,
          state: last?.state || undefined,
          cert: last?.cert || undefined,
          sizePref: last?.sizePref || undefined,
          visitor_id: ids.visitor_id || undefined,
          visit_id: ids.visit_id || undefined,
        }),
      });
      const data = (await res.json().catch(() => null)) as { success?: boolean } | null;
      if (!res.ok || !data?.success) {
        setStatus("error");
        setError(res.status === 429 ? "Too many tries. Please wait a few minutes." : "Something went wrong. Please try again.");
        return;
      }
      trackEvent("radar_lead_captured", source);
      onCaptured();
    } catch {
      setStatus("error");
      setError("Something went wrong. Please try again.");
    }
  };
  return (
    <form onSubmit={submit} className="mt-3 flex flex-col gap-2 sm:flex-row">
      <label htmlFor={`catch-${source}`} className="sr-only">
        Email address
      </label>
      <input
        id={`catch-${source}`}
        type="email"
        inputMode="email"
        autoComplete="email"
        required
        value={email}
        onChange={(e) => setEmail(e.target.value)}
        placeholder="you@company.com"
        className="min-w-0 flex-1 rounded-xl border border-slate-300 px-4 py-3 text-base text-slate-900 outline-none focus:border-amber-500"
      />
      <button type="submit" disabled={status === "submitting"} className="rounded-xl bg-amber-500 px-5 py-3 text-base font-bold text-slate-950 hover:bg-amber-400 disabled:opacity-60">
        {status === "submitting" ? "…" : cta}
      </button>
      {status === "error" && error ? (
        <p className="text-sm font-medium text-red-600 sm:basis-full" role="alert">
          {error}
        </p>
      ) : null}
    </form>
  );
}
