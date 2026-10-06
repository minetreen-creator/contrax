import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { SiteHeader } from "~/components/SiteHeader";
import { SUPPLIER_CERTS } from "~/lib/suppliers";

/**
 * /suppliers/join — a small business lists itself in the supplier directory, free
 * (owner 2026-10-06, idea #8). Requires a Contrax account; one listing per account,
 * editable any time, and it can be hidden without deleting it.
 */
export const Route = createFileRoute("/suppliers/join")({
  component: () => (
    <>
      <SiteHeader />
      <JoinPage />
    </>
  ),
  head: () => ({
    meta: [
      { title: "List Your Small Business Free | Supplier Directory | Contrax" },
      { name: "description", content: "Get found by prime contractors looking for SDVOSB, WOSB, HUBZone, 8(a) and other small-business subcontractors. Free listing." },
    ],
    links: [{ rel: "canonical", href: "https://www.contrax.company/suppliers/join" }],
  }),
});

type Form = {
  company_name: string;
  uei: string;
  certifications: string[];
  naics: string;
  states: string;
  city: string;
  capabilities: string;
  website: string;
  contact_name: string;
  contact_email: string;
  contact_phone: string;
  listed: boolean;
};

const EMPTY: Form = {
  company_name: "",
  uei: "",
  certifications: [],
  naics: "",
  states: "",
  city: "",
  capabilities: "",
  website: "",
  contact_name: "",
  contact_email: "",
  contact_phone: "",
  listed: true,
};

function JoinPage() {
  const [form, setForm] = useState<Form>(EMPTY);
  const [state, setState] = useState<"loading" | "signed-out" | "ready">("loading");
  const [existing, setExisting] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    fetch("/api/suppliers/profile")
      .then(async (r) => {
        if (r.status === 401) return setState("signed-out");
        const j = await r.json();
        const p = j.profile as Record<string, unknown> | null;
        if (p) {
          setExisting(true);
          setForm({
            company_name: String(p.company_name ?? ""),
            uei: String(p.uei ?? ""),
            certifications: (p.certifications as string[]) ?? [],
            naics: ((p.naics as string[]) ?? []).join(", "),
            states: ((p.states as string[]) ?? []).join(", "),
            city: String(p.city ?? ""),
            capabilities: String(p.capabilities ?? ""),
            website: String(p.website ?? ""),
            contact_name: String(p.contact_name ?? ""),
            contact_email: String(p.contact_email ?? ""),
            contact_phone: String(p.contact_phone ?? ""),
            listed: p.listed !== false,
          });
        } else if (j.email) {
          setForm((f) => ({ ...f, contact_email: String(j.email) }));
        }
        setState("ready");
      })
      .catch(() => setState("ready"));
  }, []);

  const set = (k: keyof Form) => (e: { target: { value: string } }) => setForm((f) => ({ ...f, [k]: e.target.value }));
  const toggleCert = (code: string) =>
    setForm((f) => ({ ...f, certifications: f.certifications.includes(code) ? f.certifications.filter((c) => c !== code) : [...f.certifications, code] }));

  const save = async (e: { preventDefault: () => void }) => {
    e.preventDefault();
    setSaving(true);
    setError("");
    setSaved(false);
    try {
      const r = await fetch("/api/suppliers/profile", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(form) });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(j.error || "Couldn't save your listing.");
      setSaved(true);
      setExisting(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't save your listing.");
    } finally {
      setSaving(false);
    }
  };

  const input = "mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm";
  const label = "block text-sm font-medium text-slate-700";

  return (
    <main className="min-h-screen bg-slate-50">
      <section className="mx-auto max-w-2xl px-4 pb-14 pt-10">
        <a href="/suppliers" className="text-sm text-blue-700 underline">
          ← Supplier directory
        </a>
        <h1 className="mt-3 text-2xl font-extrabold text-slate-900">{existing ? "Your directory listing" : "List your small business free"}</h1>
        <p className="mt-2 text-sm text-slate-600">
          Prime contractors search this directory for small businesses to subcontract to. Your contact details are shown only to paying prime
          contractors.
        </p>

        {state === "loading" && <p className="mt-6 text-sm text-slate-500">Loading…</p>}
        {state === "signed-out" && (
          <div className="mt-6 rounded-xl border border-slate-200 bg-white p-5 text-sm text-slate-700">
            <p>You need a free Contrax account to list your company. Already have one? Sign in, then come back to this page.</p>
            <div className="mt-4 flex gap-3">
              <a href={`/signup?next=${encodeURIComponent("/suppliers/join")}`} className="rounded-lg bg-slate-900 px-4 py-2 font-semibold text-white">
                Create a free account
              </a>
              <a href="/login" className="rounded-lg border border-slate-300 px-4 py-2 font-semibold text-slate-900">
                Sign in
              </a>
            </div>
          </div>
        )}

        {state === "ready" && (
          <form onSubmit={save} className="mt-6 space-y-4 rounded-xl border border-slate-200 bg-white p-5">
            <label className={label}>
              Company name
              <input value={form.company_name} onChange={set("company_name")} className={input} required />
            </label>
            <fieldset>
              <legend className={label}>Certifications</legend>
              <div className="mt-2 grid gap-2 sm:grid-cols-2">
                {SUPPLIER_CERTS.map((c) => (
                  <label key={c.code} className="flex items-center gap-2 text-sm text-slate-700">
                    <input type="checkbox" checked={form.certifications.includes(c.code)} onChange={() => toggleCert(c.code)} />
                    {c.label}
                  </label>
                ))}
              </div>
            </fieldset>
            <label className={label}>
              NAICS codes for your work
              <input value={form.naics} onChange={set("naics")} placeholder="e.g. 238220, 561720" className={input} required />
            </label>
            <label className={label}>
              States you work in
              <input value={form.states} onChange={set("states")} placeholder="e.g. VA, NC, MD" className={input} required />
            </label>
            <label className={label}>
              What your company does
              <textarea
                value={form.capabilities}
                onChange={set("capabilities")}
                rows={4}
                placeholder="e.g. Commercial HVAC installation and service, 12 technicians, past work for VA hospitals and Army bases."
                className={input}
                required
              />
            </label>
            <div className="grid gap-4 sm:grid-cols-2">
              <label className={label}>
                City
                <input value={form.city} onChange={set("city")} className={input} />
              </label>
              <label className={label}>
                UEI (from SAM.gov, optional)
                <input value={form.uei} onChange={set("uei")} className={input} />
              </label>
              <label className={label}>
                Contact name
                <input value={form.contact_name} onChange={set("contact_name")} className={input} required />
              </label>
              <label className={label}>
                Contact email
                <input type="email" value={form.contact_email} onChange={set("contact_email")} className={input} required />
              </label>
              <label className={label}>
                Phone (optional)
                <input value={form.contact_phone} onChange={set("contact_phone")} className={input} />
              </label>
              <label className={label}>
                Website (optional)
                <input value={form.website} onChange={set("website")} className={input} />
              </label>
            </div>
            <label className="flex items-center gap-2 text-sm text-slate-700">
              <input type="checkbox" checked={form.listed} onChange={(e) => setForm((f) => ({ ...f, listed: e.target.checked }))} />
              Show my company in the directory
            </label>
            {error && <p className="text-sm text-red-700">{error}</p>}
            {saved && (
              <p className="text-sm font-medium text-emerald-700">
                Saved. {form.listed ? <a className="underline" href="/suppliers">See the directory</a> : "Your listing is hidden."}
              </p>
            )}
            <button type="submit" disabled={saving} className="w-full rounded-xl bg-amber-500 px-5 py-3 text-sm font-bold text-slate-950 hover:bg-amber-400 disabled:opacity-60">
              {saving ? "Saving…" : existing ? "Save changes" : "List my company"}
            </button>
          </form>
        )}
      </section>
    </main>
  );
}
