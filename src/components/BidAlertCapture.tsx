import { useEffect, useRef, useState } from "react";
import { resolveTrackingUser } from "~/lib/identity";
import { trackEvent } from "~/lib/track";
import { trackingIds } from "~/lib/visitor";
import { bidAlertProfile, type BidAlertProfile } from "~/lib/bid-alert";

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/**
 * "Get bids like this by email" for visitors without an account (owner
 * 2026-10-15). Posts to the existing /api/radar/lead, so it is the same
 * match-alert channel as Radar: one confirmation email, then at most one alert
 * a week, one-click unsubscribe. Hidden for signed-in users and rendered only
 * after mount, so the server HTML (what Google sees) is unchanged.
 */
export function BidAlertCapture({
  naicsCode = null,
  stateCode = null,
  alertProfile,
  source = "bid_page",
  heading = "Get bids like this by email",
  note,
  tone = "dark",
}: {
  naicsCode?: string | null;
  stateCode?: string | null;
  /** A ready-made profile (e.g. a trade page's); otherwise built from naicsCode/stateCode. */
  alertProfile?: BidAlertProfile | null;
  /** Event label for where the offer appeared. */
  source?: string;
  heading?: string;
  /** Extra sentence under the heading. */
  note?: string;
  tone?: "dark" | "light";
}) {
  const profile = alertProfile !== undefined ? alertProfile : bidAlertProfile({ naics_code: naicsCode, state_code: stateCode });
  const light = tone === "light";
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
        trackEvent("radar_alert_offer_shown", source);
      }
    });
    return () => {
      active = false;
    };
  }, [profile?.trade, profile?.state]);

  if (!profile || !show) return null;

  if (status === "done") {
    return (
      <div className={`mt-5 rounded-2xl border p-5 text-center ${light ? "border-emerald-300 bg-emerald-50" : "border-emerald-500/40 bg-emerald-500/10"}`}>
        <p className={`text-base font-bold ${light ? "text-emerald-800" : "text-emerald-300"}`}>You&apos;re on the list ✓</p>
        <p className={`mt-1 text-sm leading-relaxed ${light ? "text-slate-700" : "text-slate-300"}`}>
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
      trackEvent("radar_lead_captured", source);
      setStatus("done");
    } catch {
      setStatus("error");
      setError("Something went wrong. Please try again.");
    }
  };

  return (
    <section aria-label={heading} className={`mt-5 rounded-2xl border p-5 ${light ? "border-slate-200 bg-white" : "border-slate-700 bg-slate-900"}`}>
      <h2 className={`text-base font-bold ${light ? "text-slate-900" : "text-white"}`}>{heading}</h2>
      <p className={`mt-1 text-sm leading-relaxed ${light ? "text-slate-700" : "text-slate-300"}`}>
        {profile.label}, sent at most once a week when new ones open. No account required.{note ? ` ${note}` : ""}
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
          className={`w-full rounded-lg border px-3 py-3 text-base ${light ? "border-slate-300 bg-white text-slate-900 placeholder:text-slate-400" : "border-slate-700 bg-slate-950 text-white placeholder:text-slate-500"}`}
        />
        <button
          type="submit"
          disabled={status === "submitting"}
          className="shrink-0 rounded-lg bg-amber-500 px-5 py-3 text-sm font-bold text-slate-950 hover:bg-amber-400 disabled:opacity-60"
        >
          {status === "submitting" ? "Sending…" : "Email me"}
        </button>
      </form>
      {error && <p role="alert" className={`mt-2 text-sm ${light ? "text-red-700" : "text-red-400"}`}>{error}</p>}
    </section>
  );
}
