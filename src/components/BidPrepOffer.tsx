import { useState, type FormEvent } from "react";
import { BID_PREP_DELIVERY, BID_PREP_GUARANTEE, BID_PREP_INCLUDES, BID_PREP_NO_PROMISE, BID_PREP_PRICE, BID_PREP_YOU_PROVIDE, bidPrepOffered } from "~/lib/bid-prep";
import { trackEvent } from "~/lib/track";

const field = "mt-1 w-full rounded-lg border border-slate-600 bg-slate-950 px-3 py-2 text-sm text-white placeholder:text-slate-500";

/**
 * "We prepare this bid for you" (owner 2026-11-17): the $199 one-time service, offered on the bid
 * the visitor is reading. Closed by default so it does not push the bid's own facts down; shown
 * only when the bid has enough days left to do the work properly (bidPrepOffered).
 */
export function BidPrepOffer({ bidId, dueDate }: { bidId: number; dueDate: string | null }) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  if (!bidPrepOffered(dueDate)) return null;

  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (busy) return;
    setBusy(true);
    setError("");
    trackEvent("bid_prep_checkout", String(bidId));
    try {
      const res = await fetch("/api/bid-prep/checkout", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ ...Object.fromEntries(new FormData(e.currentTarget)), bidId }),
      });
      const data = (await res.json().catch(() => ({}))) as { url?: string; error?: string };
      if (res.ok && data.url) { window.location.href = data.url; return; }
      setError(data.error ?? "Something went wrong. Please try again.");
    } catch {
      setError("Something went wrong. Please try again.");
    }
    setBusy(false);
  }

  return (
    <section id="bid-prep" className="mt-5 rounded-2xl border-2 border-emerald-500/70 bg-slate-900 p-4 sm:p-5">
      <p className="text-xs font-bold uppercase tracking-wide text-emerald-400">Done for you · {BID_PREP_PRICE} one time</p>
      <h2 className="mt-1 text-lg font-bold text-white">Want to bid on this but hate the paperwork? We prepare it for you.</h2>
      <p className="mt-1.5 text-sm text-slate-300">
        We read the solicitation, build the checklist, fill in the forms and assemble the packet. You set your price, sign and submit.
        Delivered by email within {BID_PREP_DELIVERY} of your company details.
      </p>
      {!open ? (
        <button
          type="button"
          onClick={() => { setOpen(true); trackEvent("bid_prep_open", String(bidId)); }}
          className="mt-3 w-full rounded-xl bg-emerald-500 px-5 py-3 text-sm font-bold text-slate-950 hover:bg-emerald-400 sm:w-auto"
        >
          Prepare this bid for me · {BID_PREP_PRICE}
        </button>
      ) : (
        <>
          <p className="mt-4 text-sm font-semibold text-white">What we do:</p>
          <ul className="mt-2 space-y-1.5 text-sm text-slate-300">
            {BID_PREP_INCLUDES.map((f) => (
              <li key={f}>✓ {f}</li>
            ))}
          </ul>
          <p className="mt-4 text-sm font-semibold text-white">What you provide:</p>
          <ul className="mt-2 space-y-1.5 text-sm text-slate-300">
            {BID_PREP_YOU_PROVIDE.map((f) => (
              <li key={f}>• {f}</li>
            ))}
          </ul>
          <p className="mt-3 text-sm text-slate-400">{BID_PREP_NO_PROMISE}</p>
          <p className="mt-3 rounded-lg bg-emerald-950/60 px-3 py-2 text-sm font-semibold text-emerald-200">{BID_PREP_GUARANTEE}</p>
          <form onSubmit={submit} className="mt-4 grid gap-3 sm:grid-cols-2">
            <label className="text-sm font-semibold text-slate-200">
              Work email
              <input name="email" type="email" required autoComplete="email" maxLength={254} className={field} />
            </label>
            <label className="text-sm font-semibold text-slate-200">
              Company name
              <input name="company" required autoComplete="organization" maxLength={150} className={field} />
            </label>
            {/* Honeypot: people never see or fill this. */}
            <input name="website" tabIndex={-1} autoComplete="off" aria-hidden="true" className="hidden" />
            <div className="sm:col-span-2">
              <button
                type="submit"
                disabled={busy}
                className="w-full rounded-xl bg-emerald-500 px-5 py-3 text-sm font-bold text-slate-950 hover:bg-emerald-400 disabled:opacity-60 sm:w-auto"
              >
                {busy ? "Opening secure checkout…" : `Continue to payment · ${BID_PREP_PRICE}`}
              </button>
              <p className="mt-2 text-xs text-slate-400">One-time payment through Stripe. Nothing renews. Right after you pay, a short form asks for your company details.</p>
              {error ? <p role="alert" className="mt-2 text-sm font-semibold text-red-300">{error}</p> : null}
            </div>
          </form>
        </>
      )}
    </section>
  );
}
