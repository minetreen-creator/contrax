import { useState } from "react";
import { trackEvent } from "~/lib/track";
import { STATE_NAMES } from "~/lib/contract-map";
import { POST_PROJECT_FINE_PRINT } from "~/lib/private-bid-post";

/** The "Post your project" form on /private-bids/post (see ~/lib/private-bid-post). */
const STATES = Object.entries(STATE_NAMES).sort((a, b) => a[1].localeCompare(b[1]));

export function PostProjectForm() {
  const [v, setV] = useState({ business: "", name: "", email: "", work: "", city: "", state: "", deadline: "", details: "", website: "" });
  const [status, setStatus] = useState<"idle" | "sending" | "done">("idle");
  const [error, setError] = useState("");
  const set = (k: keyof typeof v) => (e: { target: { value: string } }) => setV((old) => ({ ...old, [k]: e.target.value }));
  if (status === "done") {
    return (
      <div className="rounded-2xl border border-emerald-200 bg-emerald-50 p-6 text-slate-900">
        <p className="text-lg font-bold">Got it. Your request is with us for review.</p>
        <p className="mt-2 text-sm text-slate-700">We will email {v.email} when it is listed, usually within one business day, or sooner if we have a question.</p>
      </div>
    );
  }
  const field = "mt-1 w-full rounded-lg border border-slate-300 bg-white px-3 py-2.5 text-base text-slate-900";
  return (
    <form
      className="rounded-2xl border border-slate-200 bg-white p-6 text-slate-900 shadow-sm"
      onSubmit={async (e) => {
        e.preventDefault();
        setError("");
        setStatus("sending");
        trackEvent("project_post", "private-bids-post");
        try {
          const res = await fetch("/api/private-bid-post", {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify(v),
          });
          const body = (await res.json().catch(() => ({}))) as { error?: string };
          if (!res.ok) throw new Error(body.error || "Something went wrong. Please try again.");
          setStatus("done");
        } catch (err) {
          setError(err instanceof Error ? err.message : "Something went wrong. Please try again.");
          setStatus("idle");
        }
      }}
    >
      <label className="block text-sm font-semibold">
        Business name
        <input type="text" required autoComplete="organization" value={v.business} onChange={set("business")} className={field} />
      </label>
      <div className="mt-3 grid gap-3 sm:grid-cols-2">
        <label className="block text-sm font-semibold">
          Your name <span className="font-normal text-slate-500">(optional)</span>
          <input type="text" autoComplete="name" value={v.name} onChange={set("name")} className={field} />
        </label>
        <label className="block text-sm font-semibold">
          Email for bids
          <input type="email" required autoComplete="email" value={v.email} onChange={set("email")} className={field} />
        </label>
      </div>
      <label className="mt-3 block text-sm font-semibold">
        What work do you need done?
        <input type="text" required maxLength={140} placeholder="Example: parking lot restriping" value={v.work} onChange={set("work")} className={field} />
      </label>
      <div className="mt-3 grid gap-3 sm:grid-cols-3">
        <label className="block text-sm font-semibold">
          City
          <input type="text" autoComplete="address-level2" value={v.city} onChange={set("city")} className={field} />
        </label>
        <label className="block text-sm font-semibold">
          State
          <select required value={v.state} onChange={set("state")} className={field}>
            <option value="">Choose</option>
            {STATES.map(([code, name]) => (
              <option key={code} value={code}>{name}</option>
            ))}
          </select>
        </label>
        <label className="block text-sm font-semibold">
          Bids due <span className="font-normal text-slate-500">(optional)</span>
          <input type="date" value={v.deadline} onChange={set("deadline")} className={field} />
        </label>
      </div>
      <label className="mt-3 block text-sm font-semibold">
        Details
        <textarea required rows={5} maxLength={2000} placeholder="Size of the job, how often, hours contractors can work, insurance you require, anything else they need to price it." value={v.details} onChange={set("details")} className={field} />
      </label>
      {/* Left empty by people; automated form fillers complete it. */}
      <div aria-hidden="true" className="hidden">
        <label>
          Website
          <input type="text" tabIndex={-1} autoComplete="off" value={v.website} onChange={set("website")} />
        </label>
      </div>
      {error && <p role="alert" className="mt-3 text-sm font-semibold text-red-700">{error}</p>}
      <button type="submit" disabled={status === "sending"} className="mt-5 w-full rounded-xl bg-amber-500 px-6 py-3 font-bold text-slate-950 hover:bg-amber-400 disabled:opacity-60">
        {status === "sending" ? "Sending…" : "Send for review →"}
      </button>
      <p className="mt-2 text-xs text-slate-500">{POST_PROJECT_FINE_PRINT}</p>
    </form>
  );
}
