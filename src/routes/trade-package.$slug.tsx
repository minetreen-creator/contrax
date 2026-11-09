import { createFileRoute } from "@tanstack/react-router";
import { createServerFn } from "@tanstack/react-start";
import { useState } from "react";
import { SiteHeader } from "~/components/SiteHeader";
import { SUB_FINDER_CERTS, certNames } from "~/lib/sub-finder";
import { trackEvent } from "~/lib/track";

/**
 * /trade-package/$slug — a Trade Package (Sub Finder, owner 2026-11-09): the job, the prime's scope
 * and deadline, and a quote form. Open to anyone with the link (the prime shares it themselves);
 * responses go to the prime by email. The prime sees every response here when signed in.
 */
const getPackageView = createServerFn({ method: "GET" })
  .validator((d: unknown) => ({ slug: String((d as { slug?: unknown })?.slug ?? "") }))
  .handler(async ({ data }) => {
    const srv = await import("~/lib/sub-finder.server");
    const pkg = await srv.getPackage(data.slug);
    if (!pkg) return { pkg: null, responses: null, bidHref: null };
    let viewer: number | null = null;
    try {
      const { getCurrentUser } = await import("~/lib/auth");
      viewer = (await getCurrentUser())?.id ?? null;
    } catch {
      /* visitors see the public package */
    }
    const responses = await srv.packageResponses(pkg, viewer);
    const { primeUserId: _p, id: _i, ...pub } = pkg;
    return { pkg: pub, responses, bidHref: pkg.bidId ? `/bid/${pkg.bidId}` : pkg.megaSlug ? `/megaprojects/${pkg.megaSlug}` : null };
  });

const submitQuote = createServerFn({ method: "POST" })
  .validator((d: unknown) => (d ?? {}) as Record<string, unknown>)
  .handler(async ({ data }) => {
    const { cleanResponseInput } = await import("~/lib/sub-finder");
    const clean = cleanResponseInput(data);
    if (!clean.ok) return clean.spam ? { ok: true } : { ok: false, error: clean.error };
    const srv = await import("~/lib/sub-finder.server");
    const pkg = await srv.getPackage(String(data.slug ?? ""));
    if (!pkg) return { ok: false, error: "This Trade Package no longer exists." };
    return srv.addResponse(pkg, clean.input);
  });

export const Route = createFileRoute("/trade-package/$slug")({
  loader: ({ params }) => getPackageView({ data: { slug: params.slug } }),
  component: () => (
    <>
      <SiteHeader />
      <TradePackagePage />
    </>
  ),
  head: () => ({
    meta: [
      { title: "Trade Package: quote request | Contrax" },
      { name: "robots", content: "noindex, nofollow" },
    ],
  }),
});

function TradePackagePage() {
  const { pkg, responses, bidHref } = Route.useLoaderData();
  const { slug } = Route.useParams();
  const [state, setState] = useState<"idle" | "sending" | "sent">("idle");
  const [error, setError] = useState<string | null>(null);
  if (!pkg) {
    return (
      <main className="mx-auto max-w-2xl px-4 py-10">
        <h1 className="text-2xl font-bold text-slate-900">This Trade Package isn't available</h1>
        <p className="mt-2 text-slate-700">The link may be mistyped, or the prime removed it. <a href="/radar" className="font-semibold text-blue-700">Search open government bids →</a></p>
      </main>
    );
  }
  const due = pkg.quotesDue ? new Date(`${pkg.quotesDue}T12:00:00Z`).toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric", timeZone: "UTC" }) : null;

  const send = async (form: HTMLFormElement) => {
    setState("sending");
    setError(null);
    const f = new FormData(form);
    const r = await submitQuote({
      data: {
        slug, company: f.get("company"), contactName: f.get("contactName"), email: f.get("email"), phone: f.get("phone"),
        certifications: f.getAll("certifications"), message: f.get("message"), website: f.get("website"),
      },
    }).catch(() => ({ ok: false, error: "Could not send just now. Please try again." }));
    if (!r.ok) {
      setState("idle");
      return setError((r as { error?: string }).error ?? "Could not send.");
    }
    setState("sent");
    trackEvent("trade_package_quote_sent", pkg.trade);
  };

  return (
    <main className="mx-auto max-w-3xl px-4 py-8">
      <p className="text-xs font-semibold uppercase tracking-wide text-blue-700">Trade Package · quote request</p>
      <h1 className="mt-1 text-2xl font-bold text-slate-900">{pkg.company} needs {pkg.trade.toLowerCase()} quotes</h1>
      <p className="mt-1 text-slate-700">
        {pkg.title}
        {pkg.location ? ` · ${pkg.location}` : ""}
      </p>
      {due ? <p className="mt-1 text-sm font-semibold text-amber-700">Quotes due {due}</p> : null}

      <section className="mt-5 rounded-2xl border border-slate-200 bg-white p-5">
        <h2 className="text-sm font-bold uppercase tracking-wide text-slate-500">Scope</h2>
        <p className="mt-2 whitespace-pre-line text-slate-800">{pkg.scope}</p>
        {bidHref ? (
          <a href={bidHref} className="mt-3 inline-block text-sm font-semibold text-blue-700">See the {bidHref.startsWith("/bid/") ? "government bid" : "project"} this is for →</a>
        ) : null}
      </section>

      {responses ? (
        <section className="mt-5 rounded-2xl border border-emerald-200 bg-emerald-50 p-5">
          <h2 className="font-bold text-slate-900">Responses ({responses.length})</h2>
          <p className="text-xs text-slate-600">Only you see this. Each response was also emailed to you.</p>
          {responses.length ? (
            <ul className="mt-2 space-y-2 text-sm">
              {responses.map((r, i) => (
                <li key={i} className="rounded-lg bg-white p-3">
                  <p className="font-semibold text-slate-900">{r.company}</p>
                  <p className="text-slate-700">{[r.contact_name, r.email, r.phone].filter(Boolean).join(" · ")}</p>
                  {r.certifications?.length ? <p className="text-xs text-emerald-700">{certNames(r.certifications).join(", ")} (self-reported)</p> : null}
                  {r.message ? <p className="mt-1 text-slate-700">{r.message}</p> : null}
                </li>
              ))}
            </ul>
          ) : (
            <p className="mt-2 text-sm text-slate-700">No responses yet. Share the link from your phone or email with the subs you work with.</p>
          )}
        </section>
      ) : state === "sent" ? (
        <section className="mt-5 rounded-2xl border border-emerald-200 bg-emerald-50 p-5">
          <h2 className="font-bold text-slate-900">Sent. {pkg.company} has your quote request.</h2>
          <p className="mt-1 text-sm text-slate-700">They'll reply to the email you gave.</p>
          <p className="mt-3 text-sm font-semibold text-slate-900">Want more quote requests like this one?</p>
          <p className="text-sm text-slate-700">
            List your business for primes on Contrax. Primes bidding {pkg.trade.toLowerCase()} work can then send you requests by email, and you can stop any time.
          </p>
          <a
            href={`/signup?source=trade_package&next=${encodeURIComponent("/sub-finder#listing")}`}
            onClick={() => trackEvent("trade_package_get_listed", pkg.trade)}
            className="mt-3 inline-block rounded-lg bg-slate-900 px-4 py-2 text-sm font-semibold text-white"
          >
            Create an account and get listed →
          </a>
          <p className="mt-2 text-xs text-slate-600">
            Already have an account? <a href="/sub-finder#listing" className="font-semibold text-blue-700">Turn on your listing →</a>
          </p>
        </section>
      ) : (
        <form
          className="mt-5 space-y-3 rounded-2xl border-2 border-slate-900 bg-white p-5 text-sm"
          onSubmit={(e) => {
            e.preventDefault();
            void send(e.currentTarget);
          }}
        >
          <h2 className="text-lg font-bold text-slate-900">Send your quote request</h2>
          <div className="grid gap-3 sm:grid-cols-2">
            <label className="block"><span className="text-xs text-slate-500">Company</span><input name="company" required className="mt-1 w-full rounded-lg border border-slate-300 px-2 py-1.5" /></label>
            <label className="block"><span className="text-xs text-slate-500">Your name</span><input name="contactName" className="mt-1 w-full rounded-lg border border-slate-300 px-2 py-1.5" /></label>
            <label className="block"><span className="text-xs text-slate-500">Email</span><input name="email" type="email" required className="mt-1 w-full rounded-lg border border-slate-300 px-2 py-1.5" /></label>
            <label className="block"><span className="text-xs text-slate-500">Phone (optional)</span><input name="phone" className="mt-1 w-full rounded-lg border border-slate-300 px-2 py-1.5" /></label>
          </div>
          <fieldset>
            <legend className="text-xs text-slate-500">Certifications (optional)</legend>
            <div className="mt-1 flex flex-wrap gap-3">
              {SUB_FINDER_CERTS.map((c) => (
                <label key={c.value} className="flex items-center gap-1"><input type="checkbox" name="certifications" value={c.value} /> {c.label}</label>
              ))}
            </div>
          </fieldset>
          <label className="block"><span className="text-xs text-slate-500">Message: your price range, availability, questions (optional)</span><textarea name="message" rows={4} className="mt-1 w-full rounded-lg border border-slate-300 px-2 py-1.5" /></label>
          {/* Spam trap: people never see or fill this. */}
          <input name="website" tabIndex={-1} autoComplete="off" className="hidden" aria-hidden="true" />
          {error ? <p className="text-red-700">{error}</p> : null}
          <button type="submit" disabled={state === "sending"} className="w-full rounded-lg bg-slate-900 px-4 py-2.5 font-semibold text-white disabled:opacity-50">
            {state === "sending" ? "Sending…" : `Send to ${pkg.company}`}
          </button>
          <p className="text-xs text-slate-500">Your details go only to {pkg.company}. Contrax won't email you unless you create an account.</p>
        </form>
      )}
    </main>
  );
}
