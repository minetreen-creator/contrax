import { useEffect, useRef, useState } from "react";
import { resolveTrackingUser } from "~/lib/identity";
import { trackEvent } from "~/lib/track";
import { trackingIds } from "~/lib/visitor";
import { bidAlertProfile } from "~/lib/bid-alert";

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/**
 * "Get bids like this by email" for visitors without an account (owner
 * 2026-10-15). Posts to the existing /api/radar/lead, so it is the same
 * match-alert channel as Radar: one confirmation email, then at most one alert
 * a week, one-click unsubscribe. Hidden for signed-in users and rendered only
 * after mount, so the server HTML (what Google sees) is unchanged.
 */
export function BidAlertCapture({ naicsCode, stateCode }: { naicsCode: string | null; stateCode: string | null }) {
  const profile = bidAlertProfile({ naics_code: naicsCode, state_code: stateCode });
  const [show, setShow] = useState(false);
  const [email, setEmail] = useState("");
  const [status, setStatus] = useState<"idle" | "submitting" | "done" | "error">("idle");
  const [error, setError] = useState("");
  const shownRef = useRef(false);

  useEffect(() => {
    if (!profile) return;
    let active = true;
    resolveTrackingUser().then((user) => {
      if (!active || user) return;
      setShow(true);
      if (!shownRef.current) {
        shownRef.current = true;
        trackEvent("radar_alert_offer_shown", "bid_page");
      }
    });
    return () => {
      active = false;
    };
  }, [profile?.trade, profile?.state]);

  if (!profile || !show) return null;

  if (status === "done") {
    return (
      <div className="mt-5 rounded-2xl border border-emerald-500/40 bg-emerald-500/10 p-5 text-center">
        <p className="text-base font-bold text-emerald-300">You&apos;re on the list ✓</p>
        <p className="mt-1 text-sm leading-relaxed text-slate-300">
          Check your inbox to confirm. No account required, and you can unsubscribe anytime with one click.
        </p>
      </div>
    );
  }

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
          trade: profile.trade || undefined,
          state: profile.state || undefined,
          visitor_id: ids.visitor_id || undefined,
          visit_id: ids.visit_id || undefined,
        }),
      });
      const data = (await res.json().catch(() => null)) as { success?: boolean } | null;
      if (!res.ok || !data?.success) {
        setStatus("error");
        setError("Something went wrong. Please try again.");
        return;
      }
      trackEvent("radar_lead_captured", "bid_page");
      setStatus("done");
    } catch {
      setStatus("error");
      setError("Something went wrong. Please try again.");
    }
  };

  return (
    <section aria-label="Get bids like this by email" className="mt-5 rounded-2xl border border-slate-700 bg-slate-900 p-5">
      <h2 className="text-base font-bold text-white">Get bids like this by email</h2>
      <p className="mt-1 text-sm leading-relaxed text-slate-300">
        {profile.label}, sent at most once a week when new ones open. No account required.
      </p>
      <form onSubmit={submit} className="mt-3 flex flex-col gap-2 sm:flex-row">
        <label htmlFor="bid-alert-email" className="sr-only">Email address</label>
        <input
          id="bid-alert-email"
          type="email"
          inputMode="email"
          autoComplete="email"
          required
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          placeholder="you@company.com"
          className="w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-3 text-base text-white placeholder:text-slate-500"
        />
        <button
          type="submit"
          disabled={status === "submitting"}
          className="shrink-0 rounded-lg bg-amber-500 px-5 py-3 text-sm font-bold text-slate-950 hover:bg-amber-400 disabled:opacity-60"
        >
          {status === "submitting" ? "Sending…" : "Email me"}
        </button>
      </form>
      {error && <p role="alert" className="mt-2 text-sm text-red-400">{error}</p>}
    </section>
  );
}
