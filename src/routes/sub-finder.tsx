import { createFileRoute } from "@tanstack/react-router";
import { createServerFn } from "@tanstack/react-start";
import { useState } from "react";
import { SiteHeader } from "~/components/SiteHeader";
import { STATE_NAMES } from "~/lib/contract-map";
import { SEO_TRADES, SEO_TRADE_BY_SLUG } from "~/lib/seo-trades";
import { MAX_QUOTE_REQUESTS_PER_PACKAGE, SUB_FINDER_CERTS, certNames, shareText, type ListedSub } from "~/lib/sub-finder";
import { SAM_SOURCE_NOTE } from "~/lib/sam-registrants";
import { trackEvent } from "~/lib/track";

/**
 * /sub-finder — Sub Finder (owner 2026-11-09, name chosen by the owner). A prime working a bid or a
 * megaproject finds subs who listed their business for primes, makes a Trade Package and shares it.
 * No cold outreach: Contrax emails quote requests only to listed members (each email can stop them);
 * the prime shares the package link with anyone else from their own phone or email.
 */
const PROD_URL = "https://www.contrax.company";
const TITLE = "Sub Finder: Find Certified Subcontractors for Your Government Bid | Contrax";
const DESC =
  "Find local subcontractors by trade, state and certification for your government bid or megaproject, and send them a Trade Package to collect quotes.";

const STATE_OPTIONS = Object.entries(STATE_NAMES)
  .filter(([c]) => c.length === 2 && !["PR", "GU", "VI", "AS", "MP"].includes(c))
  .sort((a, b) => a[1].localeCompare(b[1]));

interface Search {
  bid: number | null;
  mega: string | null;
  trade: string;
  state: string;
  cert: string;
}

function parseSearch(s: Record<string, unknown>): Search {
  const bid = Number(s.bid);
  const st = typeof s.state === "string" ? s.state.toUpperCase() : "";
  return {
    bid: Number.isInteger(bid) && bid > 0 ? bid : null,
    mega: typeof s.mega === "string" && /^[a-z0-9-]{3,80}$/.test(s.mega) ? s.mega : null,
    trade: typeof s.trade === "string" && SEO_TRADE_BY_SLUG[s.trade] ? s.trade : "",
    state: STATE_NAMES[st] ? st : "",
    cert: typeof s.cert === "string" && SUB_FINDER_CERTS.some((c) => c.value === s.cert) ? s.cert : "",
  };
}

const getSubFinder = createServerFn({ method: "GET" })
  .validator((d: unknown) => parseSearch((d ?? {}) as Record<string, unknown>))
  .handler(async ({ data }) => {
    const srv = await import("~/lib/sub-finder.server");
    let user: { id: number } | null = null;
    try {
      const { getCurrentUser } = await import("~/lib/auth");
      user = await getCurrentUser();
    } catch {
      /* visitors still see the page */
    }
    try {
      const context = await srv.packageContext({ bid: data.bid, mega: data.mega });
      const state = data.state || context?.state || "";
      const subs = await srv.findSubs({ trade: data.trade || null, state: state || null, cert: data.cert || null });
      // SAM.gov registered small businesses (item 5): shown for one trade and state; more when signed in.
      const { findRegisteredSubs } = await import("~/lib/sam-registrants.server");
      const registered = data.trade && state ? await findRegisteredSubs({ trade: data.trade, state, cert: data.cert || null, limit: user ? 50 : 10 }) : null;
      return {
        ...data,
        state,
        context,
        subs,
        registered,
        signedIn: Boolean(user),
        listing: user ? await srv.myListing(user.id) : null,
        packages: user ? await srv.myPackages(user.id) : [],
        failed: false,
      };
    } catch (e) {
      console.error("[sub-finder] load failed:", e);
      return { ...data, context: null, subs: [] as ListedSub[], registered: null, signedIn: Boolean(user), listing: null, packages: [], failed: true };
    }
  });

const createTradePackage = createServerFn({ method: "POST" })
  .validator((d: unknown) => (d ?? {}) as Record<string, unknown>)
  .handler(async ({ data }) => {
    const { getCurrentUser } = await import("~/lib/auth");
    const user = await getCurrentUser();
    if (!user) return { ok: false as const, error: "Sign in to make a Trade Package." };
    const { cleanPackageInput } = await import("~/lib/sub-finder");
    const today = new Date().toISOString().slice(0, 10);
    const clean = cleanPackageInput(data, today);
    if (!clean.ok) return { ok: false as const, error: clean.error };
    const srv = await import("~/lib/sub-finder.server");
    const bid = Number(data.bid);
    const context = await srv.packageContext({ bid: Number.isInteger(bid) && bid > 0 ? bid : null, mega: typeof data.mega === "string" ? data.mega : null });
    const pkg = await srv.createPackage(user.id, context, clean.input);
    return { ok: true as const, ...pkg };
  });

const requestQuotes = createServerFn({ method: "POST" })
  .validator((d: unknown) => {
    const o = (d ?? {}) as { slug?: unknown; profileIds?: unknown };
    return { slug: String(o.slug ?? ""), profileIds: (Array.isArray(o.profileIds) ? o.profileIds : []).map(Number).slice(0, 20) };
  })
  .handler(async ({ data }) => {
    const { getCurrentUser } = await import("~/lib/auth");
    const user = await getCurrentUser();
    if (!user) return { sent: 0 };
    const srv = await import("~/lib/sub-finder.server");
    const pkg = await srv.getPackage(data.slug);
    if (!pkg) return { sent: 0 };
    return srv.sendQuoteRequests(pkg, user.id, data.profileIds);
  });

const setMyListing = createServerFn({ method: "POST" })
  .validator((d: unknown) => ({ listed: (d as { listed?: unknown })?.listed === true }))
  .handler(async ({ data }) => {
    const { getCurrentUser } = await import("~/lib/auth");
    const user = await getCurrentUser();
    if (!user) return { ok: false };
    const { setListed } = await import("~/lib/sub-finder.server");
    return { ok: await setListed(user.id, data.listed) };
  });

export const Route = createFileRoute("/sub-finder")({
  // Empty filters stay out of the URL, so /sub-finder doesn't redirect to /sub-finder?trade=&state=&cert=.
  validateSearch: (s: Record<string, unknown>) =>
    Object.fromEntries(Object.entries(parseSearch(s)).filter(([, v]) => v !== "" && v !== null)) as Partial<Search>,
  loaderDeps: ({ search }) => search,
  loader: ({ deps }) => getSubFinder({ data: deps }),
  component: () => (
    <div className="min-h-screen bg-slate-50 text-slate-900 [color-scheme:light]">
      <SiteHeader />
      <SubFinderPage />
    </div>
  ),
  head: () => ({
    meta: [
      { title: TITLE },
      { name: "description", content: DESC },
      { name: "robots", content: "index, follow" },
      { property: "og:title", content: TITLE },
      { property: "og:description", content: DESC },
      { property: "og:url", content: `${PROD_URL}/sub-finder` },
      { property: "og:image", content: `${PROD_URL}/logo-square.png` },
    ],
    links: [{ rel: "canonical", href: `${PROD_URL}/sub-finder` }],
  }),
});

function SubFinderPage() {
  const d = Route.useLoaderData();
  const [selected, setSelected] = useState<number[]>([]);
  const [pkg, setPkg] = useState<{ slug: string; url: string; company: string; trade: string } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [sentNote, setSentNote] = useState<string | null>(null);
  const [listed, setListedState] = useState<boolean>(d.listing?.listed ?? false);
  const tradeLabel = d.trade ? SEO_TRADE_BY_SLUG[d.trade]?.label ?? d.trade : "";
  const here = typeof window === "undefined" ? "/sub-finder" : window.location.pathname + window.location.search;

  const create = async (form: HTMLFormElement) => {
    setSaving(true);
    setError(null);
    const f = new FormData(form);
    const res = await createTradePackage({
      data: {
        bid: d.bid, mega: d.mega, trade: f.get("trade"), state: f.get("state"), location: f.get("location"),
        scope: f.get("scope"), quotesDue: f.get("quotesDue"), company: f.get("company"), contactName: f.get("contactName"),
      },
    }).catch(() => ({ ok: false as const, error: "Could not save just now. Please try again." }));
    setSaving(false);
    if (!res.ok) return setError(res.error);
    setPkg({ slug: res.slug, url: res.url, company: String(f.get("company") ?? ""), trade: String(f.get("trade") ?? "") });
    trackEvent("sub_finder_package_created", d.context?.kind ?? "none");
  };

  const sendRequests = async () => {
    if (!pkg || !selected.length) return;
    const r = await requestQuotes({ data: { slug: pkg.slug, profileIds: selected } }).catch(() => ({ sent: 0 }));
    setSentNote(r.sent ? `Quote request sent to ${r.sent} listed sub${r.sent === 1 ? "" : "s"}.` : "No requests were sent (already sent, or the limit was reached).");
    trackEvent("sub_finder_requests_sent", String(r.sent));
  };

  const toggleListing = async () => {
    const next = !listed;
    setListedState(next);
    const r = await setMyListing({ data: { listed: next } }).catch(() => ({ ok: false }));
    if (!r.ok) setListedState(!next);
    else trackEvent("sub_finder_listing", next ? "on" : "off");
  };

  return (
    <main className="mx-auto max-w-5xl px-4 py-8">
      <p className="text-xs font-semibold uppercase tracking-wide text-blue-700">Sub Finder</p>
      <h1 className="mt-1 text-2xl font-bold text-slate-900 sm:text-3xl">Find subs for your bid and collect their quotes</h1>
      <p className="mt-2 max-w-3xl text-sm text-slate-600">
        See local subcontractors who listed their business for primes, filtered by trade, state and certification. Make a Trade Package (the job, your
        scope and your deadline) and share the link with any sub you work with; their quotes come to your inbox.
      </p>

      {d.context ? (
        <div className="mt-4 rounded-xl border border-slate-200 bg-white p-4 text-sm">
          <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">{d.context.kind === "bid" ? "For this bid" : "For this megaproject"}</p>
          <a href={d.context.href} className="font-semibold text-blue-700 hover:underline">{d.context.title}</a>
          <p className="text-slate-600">
            {[d.context.agency, d.context.location, d.context.due ? `Due ${new Date(`${d.context.due}T12:00:00Z`).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" })}` : null].filter(Boolean).join(" · ")}
          </p>
        </div>
      ) : null}

      <form method="get" action="/sub-finder" className="mt-4 flex flex-wrap items-end gap-3 rounded-xl border border-slate-200 bg-white p-3">
        {d.bid ? <input type="hidden" name="bid" value={d.bid} /> : null}
        {d.mega ? <input type="hidden" name="mega" value={d.mega} /> : null}
        <label className="text-sm">
          <span className="block text-xs text-slate-500">Trade</span>
          <select name="trade" defaultValue={d.trade} className="mt-1 rounded-lg border border-slate-300 px-2 py-1.5">
            <option value="">Any trade</option>
            {SEO_TRADES.map((t) => <option key={t.slug} value={t.slug}>{t.label}</option>)}
          </select>
        </label>
        <label className="text-sm">
          <span className="block text-xs text-slate-500">State</span>
          <select name="state" defaultValue={d.state} className="mt-1 rounded-lg border border-slate-300 px-2 py-1.5">
            <option value="">Any state</option>
            {STATE_OPTIONS.map(([c, n]) => <option key={c} value={c}>{n}</option>)}
          </select>
        </label>
        <label className="text-sm">
          <span className="block text-xs text-slate-500">Certification</span>
          <select name="cert" defaultValue={d.cert} className="mt-1 rounded-lg border border-slate-300 px-2 py-1.5">
            <option value="">Any</option>
            {SUB_FINDER_CERTS.map((c) => <option key={c.value} value={c.value}>{c.label}</option>)}
          </select>
        </label>
        <button type="submit" className="rounded-lg bg-slate-900 px-4 py-2 text-sm font-semibold text-white hover:bg-slate-800">Find subs</button>
      </form>

      <div className="mt-6 grid gap-6 lg:grid-cols-[1fr_380px]">
        <section>
          <h2 className="text-lg font-bold text-slate-900">
            Listed on Contrax{tradeLabel ? ` · ${tradeLabel}` : ""}{d.state ? ` · ${STATE_NAMES[d.state]}` : ""}
          </h2>
          {d.failed ? (
            <p className="mt-2 text-sm text-amber-800">The list could not load just now. Please try again in a minute.</p>
          ) : d.subs.length ? (
            <ul className="mt-2 space-y-2">
              {d.subs.map((s) => (
                <li key={s.profileId} className="flex items-start gap-3 rounded-xl border border-slate-200 bg-white p-3 text-sm">
                  <input
                    type="checkbox"
                    aria-label={`Select ${s.businessName}`}
                    className="mt-1 h-4 w-4"
                    disabled={!pkg}
                    checked={selected.includes(s.profileId)}
                    onChange={(e) => setSelected((prev) => (e.target.checked ? [...prev, s.profileId].slice(0, MAX_QUOTE_REQUESTS_PER_PACKAGE) : prev.filter((x) => x !== s.profileId)))}
                  />
                  <div>
                    <p className="font-semibold text-slate-900">{s.businessName}</p>
                    <p className="text-xs text-slate-600">
                      {[s.trade ? SEO_TRADE_BY_SLUG[s.trade]?.label : null, s.states.length ? s.states.join(", ") : null, s.yearsInBusiness ? `${s.yearsInBusiness} yrs in business` : null].filter(Boolean).join(" · ")}
                    </p>
                    {s.certifications.length ? <p className="text-xs text-emerald-700">{certNames(s.certifications).join(", ")} (self-reported)</p> : null}
                  </div>
                </li>
              ))}
            </ul>
          ) : (
            <p className="mt-2 rounded-xl border border-slate-200 bg-white p-4 text-sm text-slate-700">
              {d.registered?.total
                ? `None have listed on Contrax yet for this search, but ${d.registered.total.toLocaleString("en-US")} registered with the government are below. Make a Trade Package and share the link with them.`
                : "No listed subs match yet. Make a Trade Package and share the link with the subs you know: every sub who opens it can list their business here."}
            </p>
          )}
          {pkg && d.subs.length ? (
            <div className="mt-3 flex flex-wrap items-center gap-3">
              <button type="button" onClick={sendRequests} disabled={!selected.length} className="rounded-lg bg-blue-700 px-4 py-2 text-sm font-semibold text-white disabled:opacity-40">
                Send quote request to {selected.length || "selected"} listed sub{selected.length === 1 ? "" : "s"}
              </button>
              {sentNote ? <span className="text-sm text-slate-700">{sentNote}</span> : null}
            </div>
          ) : null}
          <p className="mt-3 text-xs text-slate-500">
            Only businesses that chose to be listed appear here, and only they can receive quote requests from Contrax. Certifications are self-reported;
            verify them in the SBA's certification search before you rely on them.
          </p>

          {d.registered ? <RegisteredSubs data={d.registered} trade={tradeLabel} state={d.state ? STATE_NAMES[d.state] : ""} signedIn={d.signedIn} pkgUrl={pkg ? pkg.url : null} /> : d.trade && !d.state ? (
            <p className="mt-6 text-sm text-slate-600">Pick a state to also see small businesses registered with the government for this trade.</p>
          ) : null}
        </section>

        <aside className="space-y-4">
          <div className="rounded-2xl border-2 border-slate-900 bg-white p-4">
            <h2 className="text-lg font-bold text-slate-900">Make a Trade Package</h2>
            {!d.signedIn ? (
              <p className="mt-2 text-sm text-slate-700">
                <a href={`/login?next=${encodeURIComponent(here)}`} className="font-semibold text-blue-700">Sign in</a> or{" "}
                <a href={`/signup?source=sub_finder&next=${encodeURIComponent(here)}`} className="font-semibold text-blue-700">create an account</a> to make a Trade Package.
              </p>
            ) : pkg ? (
              <SharePanel url={pkg.url} text={shareText({ company: pkg.company, trade: pkg.trade.toLowerCase() || "subcontractor", title: d.context?.title ?? "an upcoming job", url: pkg.url })} />
            ) : (
              <form
                className="mt-2 space-y-2 text-sm"
                onSubmit={(e) => {
                  e.preventDefault();
                  void create(e.currentTarget);
                }}
              >
                <label className="block">
                  <span className="text-xs text-slate-500">Trade you need</span>
                  <select name="trade" defaultValue={d.trade} required className="mt-1 w-full rounded-lg border border-slate-300 px-2 py-1.5">
                    <option value="">Pick a trade</option>
                    {SEO_TRADES.map((t) => <option key={t.slug} value={t.label}>{t.label}</option>)}
                  </select>
                </label>
                <input type="hidden" name="state" value={d.state} />
                <label className="block">
                  <span className="text-xs text-slate-500">Job location</span>
                  <input name="location" defaultValue={d.context?.location ?? ""} className="mt-1 w-full rounded-lg border border-slate-300 px-2 py-1.5" />
                </label>
                <label className="block">
                  <span className="text-xs text-slate-500">Scope for the sub (what, where, how big)</span>
                  <textarea name="scope" rows={4} required minLength={20} className="mt-1 w-full rounded-lg border border-slate-300 px-2 py-1.5" />
                </label>
                <label className="block">
                  <span className="text-xs text-slate-500">Quotes due (optional)</span>
                  <input type="date" name="quotesDue" className="mt-1 w-full rounded-lg border border-slate-300 px-2 py-1.5" />
                </label>
                <label className="block">
                  <span className="text-xs text-slate-500">Your company</span>
                  <input name="company" required className="mt-1 w-full rounded-lg border border-slate-300 px-2 py-1.5" />
                </label>
                <label className="block">
                  <span className="text-xs text-slate-500">Your name (optional)</span>
                  <input name="contactName" className="mt-1 w-full rounded-lg border border-slate-300 px-2 py-1.5" />
                </label>
                {error ? <p className="text-sm text-red-700">{error}</p> : null}
                <button type="submit" disabled={saving} className="w-full rounded-lg bg-slate-900 px-4 py-2 font-semibold text-white disabled:opacity-50">
                  {saving ? "Saving…" : "Make my Trade Package"}
                </button>
              </form>
            )}
          </div>

          <div id="listing" className="scroll-mt-20 rounded-2xl border border-slate-200 bg-white p-4 text-sm">
            <h2 className="font-bold text-slate-900">Are you a subcontractor?</h2>
            <p className="mt-1 text-slate-600">List your business so primes with government work can find you and ask for your quote. You can stop any time.</p>
            {!d.signedIn ? (
              <a href={`/signup?source=sub_finder_listing&next=${encodeURIComponent("/sub-finder")}`} className="mt-2 inline-block font-semibold text-blue-700">Create an account to get listed →</a>
            ) : !d.listing?.hasProfile ? (
              <a href="/onboarding" className="mt-2 inline-block font-semibold text-blue-700">Set up your business profile to get listed →</a>
            ) : (
              <label className="mt-2 flex items-center gap-2">
                <input type="checkbox" checked={listed} onChange={toggleListing} className="h-4 w-4" />
                <span className="font-semibold text-slate-900">List my business for primes</span>
              </label>
            )}
          </div>

          <div className="rounded-2xl border border-slate-200 bg-white p-4 text-sm">
            <p className="text-slate-700">
              <a href="/find-subcontractors" className="font-semibold text-blue-700">Browse by trade and state →</a>
            </p>
            <p className="mt-1 text-slate-700">
              Help small businesses get government work?{" "}
              <a href="/sub-finder/partners" className="font-semibold text-blue-700">Sub Finder for advisors and partners →</a>
            </p>
          </div>

          {d.packages.length ? (
            <div className="rounded-2xl border border-slate-200 bg-white p-4 text-sm">
              <h2 className="font-bold text-slate-900">Your Trade Packages</h2>
              <ul className="mt-2 space-y-1">
                {d.packages.map((p) => (
                  <li key={p.slug}>
                    <a href={`/trade-package/${p.slug}`} className="text-blue-700 hover:underline">{p.trade}: {p.title.slice(0, 60)}</a>{" "}
                    <span className="text-xs text-slate-500">· {p.responses} response{p.responses === 1 ? "" : "s"}</span>
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
        </aside>
      </div>
    </main>
  );
}

function SharePanel({ url, text }: { url: string; text: string }) {
  const [copied, setCopied] = useState(false);
  const share = async () => {
    try {
      const native = typeof navigator.share === "function";
      if (native) await navigator.share({ title: "Trade Package", text, url });
      else {
        await navigator.clipboard.writeText(text);
        setCopied(true);
      }
      trackEvent("sub_finder_share", native ? "native" : "copy");
    } catch {
      /* cancelled */
    }
  };
  return (
    <div className="mt-2 space-y-2 text-sm">
      <p className="font-semibold text-emerald-700">Your Trade Package is ready.</p>
      <input readOnly value={url} className="w-full rounded-lg border border-slate-300 bg-slate-50 px-2 py-1.5 text-xs" onFocus={(e) => e.currentTarget.select()} />
      <div className="grid grid-cols-2 gap-2">
        <button type="button" onClick={share} className="rounded-lg bg-slate-900 px-3 py-2 font-semibold text-white">{copied ? "Copied" : "Share link"}</button>
        <a href={`sms:?&body=${encodeURIComponent(text)}`} onClick={() => trackEvent("sub_finder_share", "sms")} className="rounded-lg border border-slate-300 px-3 py-2 text-center font-semibold text-slate-800">Text it</a>
        <a href={`mailto:?subject=${encodeURIComponent("Quote request")}&body=${encodeURIComponent(text)}`} onClick={() => trackEvent("sub_finder_share", "email")} className="col-span-2 rounded-lg border border-slate-300 px-3 py-2 text-center font-semibold text-slate-800">Email it</a>
      </div>
      <p className="text-xs text-slate-500">Send it from your own phone or email to the subs you work with. Their quotes come to your inbox.</p>
    </div>
  );
}

/**
 * SAM.gov registered small businesses (Sub Finder item 5). Public registration data; these
 * businesses haven't joined Contrax and Contrax never contacts them. The prime reaches out.
 */
function RegisteredSubs({ data, trade, state, signedIn, pkgUrl }: { data: { total: number; rows: { uei: string; name: string; city: string | null; url: string | null; certs: string[] }[] }; trade: string; state: string; signedIn: boolean; pkgUrl: string | null }) {
  if (!data.total) return null;
  return (
    <div className="mt-8">
      <h2 className="text-lg font-bold text-slate-900">
        Registered with the government{trade ? ` · ${trade}` : ""}{state ? ` · ${state}` : ""}
      </h2>
      <p className="mt-1 text-sm text-slate-600">
        {data.total.toLocaleString("en-US")} small business{data.total === 1 ? " is" : "es are"} registered in SAM.gov for this work. They haven't joined Contrax, and Contrax doesn't contact them:
        reach out through their website{pkgUrl ? " and share your Trade Package link" : ""} yourself.
      </p>
      <ul className="mt-2 grid gap-2 sm:grid-cols-2">
        {data.rows.map((r) => (
          <li key={r.uei} className="rounded-xl border border-slate-200 bg-white p-3 text-sm">
            <p className="font-semibold text-slate-900">{r.name}</p>
            <p className="text-xs text-slate-600">{r.city ?? ""}</p>
            {r.certs.length ? <p className="text-xs text-emerald-700">{certNames(r.certs.filter((c) => c !== "vosb" || !r.certs.includes("sdvosb"))).join(", ")}</p> : null}
            {r.url ? (
              <a href={r.url} target="_blank" rel="nofollow noopener noreferrer" onClick={() => trackEvent("sub_finder_registered_site", r.uei)} className="text-xs font-semibold text-blue-700 hover:underline">
                Website →
              </a>
            ) : null}
          </li>
        ))}
      </ul>
      {data.total > data.rows.length ? (
        <p className="mt-2 text-sm text-slate-700">
          {signedIn ? `Showing ${data.rows.length} of ${data.total.toLocaleString("en-US")}, certified businesses first. Narrow it with the certification filter.` : (
            <>
              Showing {data.rows.length} of {data.total.toLocaleString("en-US")}.{" "}
              <a href={`/signup?source=sub_finder_registered&next=${encodeURIComponent("/sub-finder")}`} className="font-semibold text-blue-700">Create an account to see more →</a>
            </>
          )}
        </p>
      ) : null}
      <p className="mt-2 text-xs text-slate-500">
        {SAM_SOURCE_NOTE} Is this your business and you'd like it removed? Email contrax.companyllc@gmail.com.
      </p>
    </div>
  );
}
