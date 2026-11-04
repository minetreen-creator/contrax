import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { SiteHeader } from "~/components/SiteHeader";
import { US_STATES } from "~/lib/states";
import { SHARE_LEVELS, STORY_OUTCOMES } from "~/lib/success-stories";

/**
 * /share-your-story (owner 2026-11-04: "Share Your Success"). A customer tells
 * Contrax what they found, bid on or won. Stories go to the owner for approval;
 * the person chooses how they are named, or keeps it private.
 */
export const Route = createFileRoute("/share-your-story")({
  component: ShareYourStoryPage,
  head: () => ({
    meta: [
      { title: "Share Your Story | Contrax" },
      { name: "description", content: "Found, bid on or won a government job through Contrax? Tell us about it." },
      { name: "robots", content: "noindex" },
    ],
  }),
});

const field = "mt-1 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-slate-900 focus:border-blue-500 focus:outline-none dark:border-slate-700 dark:bg-slate-900 dark:text-white";

function ShareYourStoryPage() {
  const [form, setForm] = useState({ name: "", business: "", email: "", trade: "", state: "", outcome: "", story: "", share: "full", consent: false, website: "" });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [done, setDone] = useState(false);
  const set = (k: keyof typeof form) => (e: { target: { value: string } }) => setForm((f) => ({ ...f, [k]: e.target.value }));

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError("");
    try {
      const r = await fetch("/api/success-stories", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(form) });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(j.error || "Something went wrong. Please try again.");
      setDone(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong. Please try again.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="min-h-screen bg-slate-50 text-slate-900 dark:bg-slate-950 dark:text-white">
      <SiteHeader />
      <main className="mx-auto max-w-xl px-4 py-10 sm:py-14">
        <h1 className="text-3xl font-bold">Share your story</h1>
        <p className="mt-3 text-slate-600 dark:text-slate-300">
          Found a bid you'd have missed, sent in a bid, or won a contract through Contrax? Tell us about it. Nathaniel reads every one, and nothing is published without your OK.
        </p>
        {done ? (
          <div className="mt-8 rounded-xl border border-emerald-200 bg-emerald-50 p-5 text-emerald-900 dark:border-emerald-800 dark:bg-emerald-950 dark:text-emerald-100">
            <p className="font-semibold">Thank you!</p>
            <p className="mt-1">Your story was sent. If you said we may share it, it will appear only after Nathaniel reviews it.</p>
          </div>
        ) : (
          <form onSubmit={submit} className="mt-8 space-y-5">
            <input type="text" name="website" value={form.website} onChange={set("website")} tabIndex={-1} autoComplete="off" aria-hidden="true" className="hidden" />
            <label className="block text-sm font-medium">
              Your name
              <input required className={field} value={form.name} onChange={set("name")} maxLength={120} />
            </label>
            <label className="block text-sm font-medium">
              Business name <span className="font-normal text-slate-500">(optional)</span>
              <input className={field} value={form.business} onChange={set("business")} maxLength={160} />
            </label>
            <label className="block text-sm font-medium">
              Email <span className="font-normal text-slate-500">(never shown)</span>
              <input required type="email" className={field} value={form.email} onChange={set("email")} maxLength={200} />
            </label>
            <div className="grid grid-cols-3 gap-3">
              <label className="col-span-2 block text-sm font-medium">
                Your trade
                <input required className={field} value={form.trade} onChange={set("trade")} placeholder="e.g. Flooring" maxLength={80} />
              </label>
              <label className="block text-sm font-medium">
                State
                <select className={field} value={form.state} onChange={set("state")}>
                  <option value="">—</option>
                  {US_STATES.map((s) => <option key={s} value={s}>{s}</option>)}
                </select>
              </label>
            </div>
            <fieldset>
              <legend className="text-sm font-medium">What happened?</legend>
              <div className="mt-2 space-y-2">
                {STORY_OUTCOMES.map((o) => (
                  <label key={o.key} className="flex items-center gap-2 text-sm">
                    <input type="radio" name="outcome" value={o.key} checked={form.outcome === o.key} onChange={set("outcome")} required />
                    {o.label}
                  </label>
                ))}
              </div>
            </fieldset>
            <label className="block text-sm font-medium">
              Your story
              <textarea required className={`${field} min-h-[140px]`} value={form.story} onChange={set("story")} maxLength={2000} placeholder="What did you find, and what happened next?" />
            </label>
            <fieldset>
              <legend className="text-sm font-medium">May we share it on contrax.company?</legend>
              <div className="mt-2 space-y-2">
                {SHARE_LEVELS.map((s) => (
                  <label key={s.key} className="flex items-center gap-2 text-sm">
                    <input type="radio" name="share" value={s.key} checked={form.share === s.key} onChange={set("share")} />
                    {s.label}
                  </label>
                ))}
              </div>
            </fieldset>
            {form.share !== "private" && (
              <label className="flex items-start gap-2 text-sm">
                <input type="checkbox" className="mt-1" checked={form.consent} onChange={(e) => setForm((f) => ({ ...f, consent: e.target.checked }))} />
                <span>I agree Contrax may publish my story on its website, named the way I chose above.</span>
              </label>
            )}
            {error && <p className="text-sm font-medium text-red-700 dark:text-red-400">{error}</p>}
            <button type="submit" disabled={busy} className="w-full rounded-lg bg-blue-600 px-4 py-3 font-semibold text-white hover:bg-blue-700 disabled:opacity-60">
              {busy ? "Sending…" : "Send my story"}
            </button>
          </form>
        )}
      </main>
    </div>
  );
}
