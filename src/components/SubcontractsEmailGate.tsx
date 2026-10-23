import { useEffect, useState } from "react";
import { resolveTrackingUser } from "~/lib/identity";
import { trackEvent } from "~/lib/track";
import { trackingIds } from "~/lib/visitor";
import { SUBS_UNLOCK_KEY } from "~/lib/subcontracts/email-gate";

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/**
 * Whether this viewer sees everything on the subcontracts pages: signed in, or
 * left an email here before. Starts locked (so the server HTML and the first
 * paint agree) and opens after mount when either is true.
 */
export function useSubcontractsUnlock(): { unlocked: boolean; unlock: () => void } {
  const [unlocked, setUnlocked] = useState(false);
  useEffect(() => {
    try {
      if (localStorage.getItem(SUBS_UNLOCK_KEY) === "1") setUnlocked(true);
    } catch {
      /* storage blocked */
    }
    resolveTrackingUser().then((u) => u && setUnlocked(true));
  }, []);
  const unlock = () => {
    try {
      localStorage.setItem(SUBS_UNLOCK_KEY, "1");
    } catch {
      /* storage blocked: unlocked for this page view only */
    }
    setUnlocked(true);
  };
  return { unlocked, unlock };
}

/** "🔓 N more … are ready": one email field that unlocks the rest on the spot. */
export function SubcontractsEmailGate({
  locked,
  what,
  stateCode,
  source,
  onUnlocked,
}: {
  locked: number;
  /** e.g. "subcontract notices" */
  what: string;
  stateCode: string | null;
  source: string;
  onUnlocked: () => void;
}) {
  const [email, setEmail] = useState("");
  const [status, setStatus] = useState<"idle" | "submitting" | "error">("idle");
  const [error, setError] = useState("");
  useEffect(() => {
    trackEvent("subcontracts_gate_shown", source);
  }, [source]);

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
    const ids = trackingIds();
    try {
      const res = await fetch("/api/radar/lead", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          email: normalized,
          state: stateCode || undefined,
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
      trackEvent("subcontracts_gate_unlocked", source);
      onUnlocked();
    } catch {
      setStatus("error");
      setError("Something went wrong. Please try again.");
    }
  };

  return (
    <section aria-label="Unlock the rest" className="rounded-2xl border-2 border-amber-400 bg-gradient-to-b from-amber-50 to-white p-5 shadow-sm">
      <p className="text-lg font-extrabold text-slate-900">
        🔓 {locked} more {what} {locked === 1 ? "is" : "are"} ready
      </p>
      <p className="mt-1 text-sm text-slate-600">Enter your email and we&apos;ll show them right now, then send you new ones as they post.</p>
      <form onSubmit={submit} className="mt-3 flex flex-col gap-2 sm:flex-row">
        <label htmlFor={`subs-gate-${source}`} className="sr-only">
          Email address
        </label>
        <input
          id={`subs-gate-${source}`}
          type="email"
          inputMode="email"
          autoComplete="email"
          required
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          placeholder="you@company.com"
          className="min-w-0 flex-1 rounded-xl border border-slate-300 bg-white px-4 py-3 text-base text-slate-900 outline-none focus:border-amber-500"
        />
        <button
          type="submit"
          disabled={status === "submitting"}
          className="rounded-xl bg-amber-500 px-6 py-3 text-base font-bold text-slate-950 hover:bg-amber-400 disabled:opacity-60"
        >
          {status === "submitting" ? "Unlocking…" : "Show me →"}
        </button>
      </form>
      {status === "error" && error ? (
        <p className="mt-2 text-sm font-medium text-red-600" role="alert">
          {error}
        </p>
      ) : null}
      <p className="mt-2 text-xs text-slate-500">
        No password. No credit card. Unsubscribe anytime. Have an account?{" "}
        <a href="/login" className="font-semibold underline">
          Sign in
        </a>
      </p>
    </section>
  );
}
