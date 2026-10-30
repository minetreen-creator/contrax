import { useEffect, useState } from "react";
import { STATE_NAMES } from "~/lib/contract-map";
import { getEmailSample, type EmailSampleBid } from "~/lib/near-you";
import { trackEvent } from "~/lib/track";

const dueLabel = (iso: string) => new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" });

/**
 * /pricing (owner 2026-10-30, item 4): show the merchandise before the button —
 * what the 6 AM email looks like, built from real bids posted in the visitor's
 * state this week. Renders nothing until it has three real bids.
 */
export function EmailSample() {
  const [data, setData] = useState<{ state: string; bids: EmailSampleBid[] } | null>(null);
  useEffect(() => {
    let alive = true;
    getEmailSample()
      .then((d) => {
        if (!alive || !d.state || d.bids.length < 3) return;
        setData(d);
        trackEvent("pricing_email_sample_shown", d.state);
      })
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, []);
  if (!data) return null;
  const name = STATE_NAMES[data.state] ?? data.state;
  return (
    <section aria-labelledby="email-sample-title" className="mx-auto mt-10 max-w-xl text-left">
      <p id="email-sample-title" className="text-center text-sm font-bold uppercase tracking-widest text-slate-500">
        What your 6 AM email looks like
      </p>
      <div className="mt-3 overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-md">
        <div className="border-b border-slate-100 bg-slate-50 px-5 py-3 text-xs text-slate-500">
          <p>
            <span className="font-semibold text-slate-700">From:</span> Contrax
          </p>
          <p>
            <span className="font-semibold text-slate-700">Subject:</span> Your morning bid digest: new matching government bids — Contrax
          </p>
        </div>
        <ul className="divide-y divide-slate-100">
          {data.bids.map((b) => (
            <li key={b.id} className="px-5 py-4">
              <p className="text-sm font-bold leading-snug text-slate-900">{b.title}</p>
              <p className="mt-1 text-xs text-slate-500">
                {[b.agency, b.location].filter(Boolean).join(" · ")}
              </p>
              <p className="mt-1 text-xs font-semibold text-rose-700">Due {dueLabel(b.due)}</p>
            </li>
          ))}
        </ul>
      </div>
      <p className="mt-2 text-center text-xs text-slate-500">
        Real bids posted in {name} this week. Your email is matched to your own trade and states.
      </p>
    </section>
  );
}
