import { createFileRoute } from "@tanstack/react-router";
import { createServerFn } from "@tanstack/react-start";
import { useEffect, useState } from "react";
import { SiteHeader } from "~/components/SiteHeader";
import { DIRECTORY_MIN_LISTINGS_TO_SELL, SUPPLIER_CERTS, certLabel, type SupplierListing } from "~/lib/suppliers";

/**
 * /suppliers — small-business supplier directory (owner 2026-10-06, revenue idea
 * #8). Small businesses list free; primes pay for Prime Access to see contacts.
 * Every listing is entered by the business itself — nothing is seeded or invented —
 * and the paid plan is offered only once the directory has
 * DIRECTORY_MIN_LISTINGS_TO_SELL listings, so no one pays for an empty list.
 */
const PROD_URL = "https://www.contrax.company";
const TITLE = "Small Business Subcontractor Directory | SDVOSB, WOSB, HUBZone, 8(a) | Contrax";
const DESC =
  "Prime contractors: find certified small businesses by NAICS, state and certification to meet your subcontracting goals. Small businesses: list your company free.";

const getDirectory = createServerFn({ method: "GET" }).handler(async () => {
  try {
    const { getCurrentUser } = await import("~/lib/auth");
    const { canSeeSupplierContacts } = await import("~/lib/suppliers-access.server");
    const { listSuppliers, countListedSuppliers } = await import("~/lib/suppliers.server");
    const user = await getCurrentUser();
    const withContacts = await canSeeSupplierContacts(user);
    const [suppliers, total] = await Promise.all([listSuppliers({ naics: null, state: null, cert: null, q: null }, withContacts), countListedSuppliers()]);
    return { suppliers, total, withContacts, signedIn: !!user };
  } catch {
    return { suppliers: [] as SupplierListing[], total: 0, withContacts: false, signedIn: false };
  }
});

export const Route = createFileRoute("/suppliers/")({
  loader: () => getDirectory(),
  component: () => (
    <>
      <SiteHeader />
      <DirectoryPage />
    </>
  ),
  head: () => ({
    meta: [
      { title: TITLE },
      { name: "description", content: DESC },
      { name: "robots", content: "index, follow" },
      { property: "og:type", content: "website" },
      { property: "og:url", content: `${PROD_URL}/suppliers` },
      { property: "og:title", content: TITLE },
      { property: "og:description", content: DESC },
      { property: "og:image", content: `${PROD_URL}/logo-square.png` },
      { property: "og:site_name", content: "Contrax" },
    ],
    links: [{ rel: "canonical", href: `${PROD_URL}/suppliers` }],
  }),
});

function DirectoryPage() {
  const initial = Route.useLoaderData();
  const [suppliers, setSuppliers] = useState<SupplierListing[]>(initial.suppliers);
  const [naics, setNaics] = useState("");
  const [state, setState] = useState("");
  const [cert, setCert] = useState("");
  const [q, setQ] = useState("");
  const [loading, setLoading] = useState(false);
  const filtered = !!(naics || state || cert || q);

  useEffect(() => {
    if (!filtered) {
      setSuppliers(initial.suppliers);
      return;
    }
    const t = setTimeout(() => {
      const p = new URLSearchParams();
      if (naics) p.set("naics", naics.trim());
      if (state) p.set("state", state.trim());
      if (cert) p.set("cert", cert);
      if (q) p.set("q", q.trim());
      setLoading(true);
      fetch(`/api/suppliers?${p.toString()}`)
        .then((r) => r.json())
        .then((j) => setSuppliers(j.suppliers ?? []))
        .catch(() => setSuppliers([]))
        .finally(() => setLoading(false));
    }, 300);
    return () => clearTimeout(t);
  }, [naics, state, cert, q]);

  const selling = initial.total >= DIRECTORY_MIN_LISTINGS_TO_SELL;
  const input = "mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm";

  return (
    <main className="bg-slate-50">
      <section className="mx-auto max-w-5xl px-4 pb-8 pt-12">
        <p className="text-sm font-semibold uppercase tracking-wide text-amber-700">Supplier directory</p>
        <h1 className="mt-2 text-3xl font-extrabold leading-tight text-slate-900 sm:text-4xl">Find certified small businesses to team with</h1>
        <p className="mt-4 max-w-3xl text-lg text-slate-700">
          Prime contractors need SDVOSB, WOSB, HUBZone, 8(a) and other small businesses to meet their subcontracting goals. Search by industry code,
          state and certification.
        </p>
        <div className="mt-6 flex flex-wrap gap-3">
          <a href="/suppliers/join" className="rounded-xl bg-amber-500 px-5 py-3 text-sm font-bold text-slate-950 hover:bg-amber-400">
            Small business? List your company free
          </a>
          {!initial.withContacts && (
            <a href="#primes" className="rounded-xl border border-slate-300 bg-white px-5 py-3 text-sm font-bold text-slate-900 hover:bg-slate-100">
              For prime contractors
            </a>
          )}
        </div>
      </section>

      <section className="mx-auto max-w-5xl px-4 pb-10">
        <div className="grid gap-3 rounded-xl border border-slate-200 bg-white p-4 sm:grid-cols-4">
          <label className="text-sm font-medium text-slate-700">
            Search
            <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="e.g. HVAC, janitorial" className={input} />
          </label>
          <label className="text-sm font-medium text-slate-700">
            NAICS
            <input value={naics} onChange={(e) => setNaics(e.target.value.replace(/\D/g, ""))} placeholder="e.g. 2382" inputMode="numeric" className={input} />
          </label>
          <label className="text-sm font-medium text-slate-700">
            State
            <input value={state} onChange={(e) => setState(e.target.value.toUpperCase().slice(0, 2))} placeholder="e.g. VA" className={input} />
          </label>
          <label className="text-sm font-medium text-slate-700">
            Certification
            <select value={cert} onChange={(e) => setCert(e.target.value)} className={input}>
              <option value="">Any</option>
              {SUPPLIER_CERTS.map((c) => (
                <option key={c.code} value={c.code}>
                  {c.label}
                </option>
              ))}
            </select>
          </label>
        </div>
        <p className="mt-3 text-sm text-slate-600">
          {loading ? "Searching…" : `${initial.total.toLocaleString("en-US")} ${initial.total === 1 ? "business" : "businesses"} listed`}
        </p>

        {suppliers.length === 0 ? (
          <p className="mt-3 rounded-xl border border-slate-200 bg-white p-4 text-sm text-slate-600">
            {filtered
              ? "No listed businesses match yet. Try a shorter NAICS code or another state."
              : "The directory just opened, so no businesses are listed yet. Small businesses can add themselves free in two minutes."}
          </p>
        ) : (
          <ul className="mt-3 grid gap-3 sm:grid-cols-2">
            {suppliers.map((s) => (
              <li key={s.id} className="rounded-xl border border-slate-200 bg-white p-4 text-sm">
                <p className="font-semibold text-slate-900">{s.company_name}</p>
                <p className="mt-0.5 text-slate-500">{[s.city, s.states.join(", ")].filter(Boolean).join(" · ")}</p>
                {s.certifications.length > 0 && (
                  <div className="mt-2 flex flex-wrap gap-1.5">
                    {s.certifications.map((c) => (
                      <span key={c} title={certLabel(c)} className="rounded-full bg-emerald-50 px-2 py-0.5 text-[11px] font-semibold text-emerald-800">
                        {c === "8A" ? "8(a)" : c === "HUBZONE" ? "HUBZone" : c === "SMALL" ? "Small" : c}
                      </span>
                    ))}
                  </div>
                )}
                <p className="mt-2 text-slate-700">{s.capabilities}</p>
                <p className="mt-2 text-xs text-slate-500">NAICS {s.naics.join(", ")}</p>
                {initial.withContacts ? (
                  <div className="mt-3 border-t border-slate-100 pt-2 text-slate-700">
                    <p>
                      {s.contact_name}
                      {s.contact_email && (
                        <>
                          {" · "}
                          <a className="text-blue-700 underline" href={`mailto:${s.contact_email}`}>
                            {s.contact_email}
                          </a>
                        </>
                      )}
                      {s.contact_phone && ` · ${s.contact_phone}`}
                    </p>
                    <p className="text-xs text-slate-500">
                      {s.uei && `UEI ${s.uei}`}
                      {s.uei && s.website && " · "}
                      {s.website && (
                        <a className="underline" href={s.website} target="_blank" rel="noopener noreferrer nofollow">
                          {s.website.replace(/^https?:\/\//, "")}
                        </a>
                      )}
                    </p>
                  </div>
                ) : (
                  <p className="mt-3 border-t border-slate-100 pt-2 text-xs font-medium text-slate-500">Contact details: Prime Access</p>
                )}
              </li>
            ))}
          </ul>
        )}
      </section>

      {!initial.withContacts && <PrimeAccess selling={selling} signedIn={initial.signedIn} />}
    </main>
  );
}

function PrimeAccess({ selling, signedIn }: { selling: boolean; signedIn: boolean }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const buy = async () => {
    setBusy(true);
    setError("");
    try {
      const res = await fetch("/api/data-feed/checkout", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ tier: "primes" }),
      });
      const j = await res.json().catch(() => ({}));
      if (res.status === 401 && j.needsAccount) {
        window.location.assign(`/signup?plan=basic&next=${encodeURIComponent("/suppliers#primes")}`);
        return;
      }
      if (!res.ok || !j.url) throw new Error(j.error || "Checkout is unavailable right now.");
      window.location.assign(j.url);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Checkout is unavailable right now.");
      setBusy(false);
    }
  };
  return (
    <section id="primes" className="mx-auto max-w-5xl px-4 pb-14">
      <div className="max-w-xl rounded-2xl border border-slate-200 bg-white p-6">
        <h2 className="text-lg font-bold text-slate-900">For prime contractors</h2>
        {selling ? (
          <>
            <p className="mt-2 text-sm text-slate-700">
              Prime Access shows every listed business&rsquo;s contact name, email, phone, website and UEI.
            </p>
            <p className="mt-3 text-3xl font-extrabold text-slate-900">
              $199<span className="text-base font-medium text-slate-500">/month</span>
            </p>
            <button
              onClick={buy}
              disabled={busy}
              className="mt-4 w-full rounded-xl bg-slate-900 px-5 py-3 text-sm font-bold text-white hover:bg-slate-800 disabled:opacity-60"
            >
              {busy ? "Opening checkout…" : "Get Prime Access"}
            </button>
            {error && <p className="mt-3 text-sm text-red-700">{error}</p>}
            <p className="mt-3 text-xs text-slate-500">
              Cancel anytime.{signedIn ? "" : " You’ll need a free Contrax account first."}
            </p>
          </>
        ) : (
          <>
            <p className="mt-2 text-sm text-slate-700">
              The directory is filling up now. Tell us the NAICS codes, states and certifications you need, and we&rsquo;ll email you when matching
              businesses are listed.
            </p>
            <a
              href={`mailto:contrax.companyllc@gmail.com?subject=${encodeURIComponent("Supplier directory: notify me")}&body=${encodeURIComponent("Company:\nNAICS codes:\nStates:\nCertifications needed:\n")}`}
              className="mt-4 inline-block rounded-xl bg-slate-900 px-5 py-3 text-sm font-bold text-white hover:bg-slate-800"
            >
              Email me when they&rsquo;re listed
            </a>
          </>
        )}
      </div>
    </section>
  );
}
