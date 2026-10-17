import { createFileRoute } from "@tanstack/react-router";
import { createServerFn } from "@tanstack/react-start";
import { useEffect, useState } from "react";
import {
  ArrowRight,
  BadgeCheck,
  Building2,
  Check,
  Megaphone,
  Sparkles,
} from "lucide-react";
import { SiteHeader } from "~/components/SiteHeader";
import { getCurrentUser } from "~/lib/auth";
import {
  foundingBusinessSchema,
  FOUNDING_BUSINESS_TERMS,
  type FoundingBusinessListing,
} from "~/lib/founding-business";
import { trackEvent } from "~/lib/track";

const getPage = createServerFn({ method: "GET" }).handler(async () => {
  const { foundingBusinessPageData } =
    await import("~/lib/founding-business.server");
  return foundingBusinessPageData();
});
const buy = createServerFn({ method: "POST" })
  .validator((d: unknown) => foundingBusinessSchema.parse(d))
  .handler(async ({ data }) => {
    const user = await getCurrentUser();
    if (!user) return { signIn: true as const };
    const { startFoundingBusinessCheckout } =
      await import("~/lib/founding-business.server");
    return { url: await startFoundingBusinessCheckout(user.id, data) };
  });
const ownMembership = createServerFn({ method: "GET" }).handler(async () => {
  const user = await getCurrentUser();
  if (!user) return null;
  const { getOwnFoundingBusiness } =
    await import("~/lib/founding-business.server");
  return getOwnFoundingBusiness(user.id);
});
export const Route = createFileRoute("/founding-businesses")({
  loader: () => getPage(),
  head: () => ({
    meta: [
      { title: "Meet Our Founding Businesses | Contrax" },
      {
        name: "description",
        content:
          "Meet the businesses building with Contrax. Join the Founding Business launch: a year of Starter, a public company feature and one Facebook spotlight for $99 in your first year.",
      },
    ],
    links: [
      {
        rel: "canonical",
        href: "https://www.contrax.company/founding-businesses",
      },
    ],
  }),
  component: FoundingBusinesses,
});
const input =
  "mt-2 w-full rounded-xl border border-slate-300 bg-white px-4 py-3 text-slate-900 focus:border-blue-600 focus:outline-2 focus:outline-blue-200";
function Listing({
  listing,
  sample = false,
}: {
  listing: FoundingBusinessListing;
  sample?: boolean;
}) {
  return (
    <article className="relative overflow-hidden rounded-3xl border border-slate-200 bg-white p-7 shadow-sm">
      <p className="mb-6 text-xs font-bold uppercase tracking-[.18em] text-blue-700">
        {sample
          ? "Sample listing · fictional business"
          : `Founding Business · ${String(listing.slot).padStart(2, "0")}`}
      </p>
      <div className="flex items-center gap-4">
        {listing.logoUrl ? (
          <img
            src={listing.logoUrl}
            alt={`${listing.company} logo`}
            className="h-16 w-16 rounded-2xl border border-slate-100 object-contain"
            loading="lazy"
            referrerPolicy="no-referrer"
          />
        ) : (
          <span className="flex h-16 w-16 shrink-0 items-center justify-center rounded-2xl bg-blue-50 text-blue-700">
            <Building2 size={28} />
          </span>
        )}
        <h3 className="text-xl font-bold text-slate-950">{listing.company}</h3>
      </div>
      <p className="mt-6 leading-relaxed text-slate-600">{listing.services}</p>
      <p className="mt-5 text-sm font-semibold text-slate-800">
        Serving {listing.serviceArea}
      </p>
      {sample ? (
        <p className="mt-5 text-sm text-slate-500">
          Your website link appears here.
        </p>
      ) : (
        <a
          href={listing.website}
          target="_blank"
          rel="sponsored noopener noreferrer"
          className="mt-5 inline-flex items-center gap-2 font-semibold text-blue-700"
        >
          Visit company website <ArrowRight size={16} />
        </a>
      )}
    </article>
  );
}
function FoundingBusinesses() {
  const data = Route.useLoaderData();
  const [membership, setMembership] =
    useState<Awaited<ReturnType<typeof ownMembership>>>(null);
  const [membershipError, setMembershipError] = useState("");
  async function refreshMembership() {
    try {
      setMembership(await ownMembership());
      setMembershipError("");
    } catch {
      setMembershipError(
        "Payment status is temporarily unavailable. Please refresh or contact Contrax.",
      );
    }
  }
  useEffect(() => {
    void refreshMembership();
  }, []);

  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [form, setForm] = useState({
    company: "",
    services: "",
    serviceArea: "",
    website: "",
    logoUrl: "",
    consent: false,
  });
  const canBuy = data.available;
  async function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError("");
    const parsed = foundingBusinessSchema.safeParse(form);
    if (!parsed.success) {
      setError(
        parsed.error.issues[0]?.message || "Check your company details.",
      );
      return;
    }
    setBusy(true);
    try {
      trackEvent("founding_business_checkout_started", "founding-businesses");
      const result = await buy({ data: parsed.data });
      if ("signIn" in result) {
        sessionStorage.setItem(
          "contrax_founding_business_draft",
          JSON.stringify(form),
        );
        window.location.href = "/signup?next=/founding-businesses%23join";
        return;
      }
      window.location.href = result.url;
    } catch (e) {
      setError(
        e instanceof Error
          ? e.message
          : "Checkout is unavailable. Please try again.",
      );
      setBusy(false);
    }
  }
  // Restore only business details, never payment or account credentials.
  useEffect(() => {
    try {
      const saved = sessionStorage.getItem("contrax_founding_business_draft");
      if (saved) {
        const p = foundingBusinessSchema.safeParse(JSON.parse(saved));
        if (p.success) setForm(p.data);
        sessionStorage.removeItem("contrax_founding_business_draft");
      }
    } catch {}
  }, []);
  return (
    <div className="min-h-screen bg-[#f5f7fb] text-slate-900">
      <SiteHeader />
      <main>
        <section id="membership" className="mx-auto max-w-6xl px-5">
          {membership && (
            <div className="my-6 rounded-2xl border border-blue-200 bg-blue-50 p-6">
              <h2 className="font-bold">
                {membership.paid
                  ? "Your Founding Business membership is confirmed"
                  : "Your checkout is reserved; payment is not confirmed yet"}
              </h2>
              <p className="mt-2 text-sm">
                {membership.paid
                  ? `Your Starter access is activated by verified payment. Company feature: ${membership.published ? "published" : "awaiting review"}. Facebook spotlight: ${membership.spotlight ? "completed" : "pending"}.`
                  : "If you just paid, payment processing may still be underway. Refresh the status below. You can also resume your checkout with the form."}
              </p>
              <button
                type="button"
                onClick={() => void refreshMembership()}
                className="mt-3 text-sm font-semibold text-blue-700 underline"
              >
                Refresh payment status
              </button>{" "}
              <a
                href="/dashboard"
                className="ml-4 text-sm font-semibold text-blue-700 underline"
              >
                Go to dashboard
              </a>
            </div>
          )}
          {membershipError && (
            <p role="alert" className="my-4 text-sm text-red-700">
              {membershipError}
            </p>
          )}
        </section>
        <section className="relative overflow-hidden bg-[#0c1c36] px-5 py-16 text-white sm:py-24">
          <div
            aria-hidden="true"
            className="pointer-events-none absolute -right-32 -top-32 h-[500px] w-[500px] rounded-full bg-blue-500/15 blur-3xl"
          />
          <div className="relative mx-auto grid max-w-6xl gap-12 lg:grid-cols-[1.2fr_1fr] lg:items-center">
            <div>
              <p className="inline-flex items-center gap-2 rounded-full border border-amber-300/30 bg-amber-300/10 px-4 py-2 text-xs font-bold uppercase tracking-widest text-amber-200">
                <Sparkles size={15} /> Founding Business launch · 10 places
              </p>
              <h1 className="mt-7 max-w-2xl text-4xl font-bold leading-tight tracking-tight sm:text-6xl">
                Find your next opportunity.
                <br />
                <span className="text-blue-300">
                  Let us introduce
                  <br className="hidden sm:block" /> your business.
                </span>
              </h1>
              <p className="mt-6 max-w-xl text-lg leading-relaxed text-slate-300">
                A year of Contrax Starter, a public company feature, and a
                personal spotlight for the businesses joining us early.
              </p>
              <a
                href="#join"
                className="mt-8 inline-flex items-center gap-3 rounded-xl bg-amber-300 px-6 py-3.5 font-bold text-slate-950 hover:bg-amber-200"
              >
                See the $99 offer <ArrowRight size={18} />
              </a>
            </div>
            <div className="rounded-3xl border border-white/15 bg-white/5 p-7 sm:p-9">
              <p className="text-sm font-semibold text-amber-200">
                YOUR FOUNDING BUSINESS MEMBERSHIP
              </p>
              <p className="mt-4 flex items-baseline gap-3">
                <span className="text-6xl font-bold">$99</span>
                <span className="text-slate-300">first year</span>
              </p>
              <p className="mt-3 text-sm text-slate-300">
                Paid upfront · renews at $190/year
              </p>
              <ul className="mt-8 space-y-5">
                {[
                  "12 months of Starter access",
                  "Your logo, services, service area and website",
                  "12-month feature on this public page",
                  "One company spotlight on Contrax’s Facebook page",
                ].map((t) => (
                  <li className="flex gap-3" key={t}>
                    <Check size={20} className="shrink-0 text-amber-200" />
                    {t}
                  </li>
                ))}
              </ul>
              <p className="mt-7 border-t border-white/15 pt-5 text-xs leading-relaxed text-slate-400">
                Cancel before renewal in Settings → Manage subscription. The
                promotional feature and spotlight are first-year benefits.
              </p>
            </div>
          </div>
        </section>
        <section className="mx-auto max-w-6xl px-5 py-16">
          <div className="flex items-center gap-2 text-sm font-bold text-blue-700">
            <BadgeCheck size={18} /> MEET OUR FOUNDING BUSINESSES
          </div>
          <h2 className="mt-3 text-3xl font-bold tracking-tight">
            Real businesses. A place to be seen.
          </h2>
          <p className="mt-4 max-w-2xl leading-relaxed text-slate-600">
            Company profiles are paid promotional placements. Each business
            supplies its own information; membership is not a certification or
            government endorsement.
          </p>
          {data.listings.length > 0 ? (
            <div className="mt-8 grid gap-6 md:grid-cols-2 lg:grid-cols-3">
              {data.listings.map((l) => (
                <Listing key={l.slot} listing={l} />
              ))}
            </div>
          ) : (
            <div className="mt-8 grid gap-7 md:grid-cols-2">
              <Listing
                sample
                listing={{
                  slot: 0,
                  company: "Your Business, Introduced",
                  services:
                    "Use this space to tell visitors what you do, who you serve and what makes your team a good fit. This example shows the layout your company will receive.",
                  serviceArea: "Your cities, counties or region",
                  website: "",
                  logoUrl: "",
                }}
              />
              <div className="flex flex-col justify-center rounded-3xl border border-dashed border-slate-300 p-8">
                <Megaphone className="text-blue-700" size={32} />
                <h3 className="mt-4 text-2xl font-bold">
                  Your company could be here.
                </h3>
                <p className="mt-4 leading-relaxed text-slate-600">
                  {data.available
                    ? "Published member profiles will appear here after purchase and review. The example is fictional and does not represent a customer."
                    : "Member listings are temporarily unavailable. Please check again shortly."}
                </p>
              </div>
            </div>
          )}
        </section>
        <section
          id="join"
          className="scroll-mt-24 border-t border-slate-200 bg-white px-5 py-16"
        >
          <div className="mx-auto grid max-w-6xl gap-12 lg:grid-cols-[.85fr_1.15fr]">
            <div>
              <p className="text-sm font-bold uppercase tracking-widest text-blue-700">
                JOIN THE FIRST 10
              </p>
              <h2 className="mt-3 text-3xl font-bold">
                Give your business
                <br />a founding place.
              </h2>
              <p className="mt-5 leading-relaxed text-slate-600">
                Submit the company details you want published, then pay securely
                through Stripe. A Contrax account is required. This offer is for
                businesses without an existing paid plan.
              </p>
              <ol className="mt-7 space-y-5 text-slate-700">
                <li>
                  <b>1. Join.</b> Pay $99 for your first year of Starter.
                </li>
                <li>
                  <b>2. Get introduced.</b> We review and publish your profile
                  within five business days of receiving complete details. Your
                  12-month feature starts on publication.
                </li>
                <li>
                  <b>3. Get your spotlight.</b> We prepare one company post for
                  Contrax’s Facebook page, for your approval, within 30 days of
                  publication.
                </li>
              </ol>
              <p className="mt-6 text-sm leading-relaxed text-slate-500">
                No audience size, leads or contract awards are promised. You
                retain ownership of your logo and permit Contrax to use the
                submitted details for these placements.
              </p>
              <a
                href="mailto:contrax.companyllc@gmail.com"
                className="mt-4 inline-block text-sm font-semibold text-blue-700"
              >
                Questions? Talk to Nat →
              </a>
            </div>
            <form
              onSubmit={submit}
              className="rounded-3xl border border-slate-200 bg-slate-50 p-6 sm:p-8"
            >
              <p className="mb-6 text-sm font-semibold text-slate-600">
                {!data.available
                  ? "Checkout temporarily unavailable. Please check again shortly."
                  : data.remaining === 0
                    ? "All 10 places are purchased or temporarily reserved. You can resume an existing checkout below."
                    : "Limited to 10 businesses. Availability is checked again at checkout."}
              </p>
              <div className="space-y-5">
                {(
                  [
                    ["company", "Business name", "Your company name", 100],
                    [
                      "serviceArea",
                      "Service area",
                      "Cities, counties or states you serve",
                      200,
                    ],
                    [
                      "website",
                      "Company website",
                      "https://your-company.com",
                      500,
                    ],
                    [
                      "logoUrl",
                      "Logo URL (optional)",
                      "https://your-company.com/logo.png",
                      500,
                    ],
                  ] as const
                ).map(([key, label, placeholder, max]) => (
                  <label className="block text-sm font-semibold" key={key}>
                    {label}
                    <input
                      className={input}
                      name={key}
                      value={form[key]}
                      required={key !== "logoUrl"}
                      maxLength={max}
                      type={
                        key === "website" || key === "logoUrl" ? "url" : "text"
                      }
                      placeholder={placeholder}
                      onChange={(e) =>
                        setForm({ ...form, [key]: e.target.value })
                      }
                    />
                  </label>
                ))}
                <label className="block text-sm font-semibold">
                  Services and company introduction
                  <textarea
                    className={`${input} min-h-32`}
                    name="services"
                    required
                    minLength={10}
                    maxLength={600}
                    value={form.services}
                    onChange={(e) =>
                      setForm({ ...form, services: e.target.value })
                    }
                    placeholder="Describe the work your business does. Up to 600 characters."
                  />
                </label>
                <div className="rounded-xl border border-blue-100 bg-blue-50 p-4 text-sm leading-relaxed text-slate-700">
                  {FOUNDING_BUSINESS_TERMS}
                </div>
                <label className="flex items-start gap-3 text-sm leading-relaxed text-slate-600">
                  <input
                    className="mt-1 h-4 w-4 shrink-0"
                    type="checkbox"
                    required
                    checked={form.consent}
                    onChange={(e) =>
                      setForm({ ...form, consent: e.target.checked })
                    }
                  />
                  I agree to the offer terms above, confirm I can represent this
                  business, and permit publication of these company details and
                  logo.
                </label>
                {error && (
                  <p
                    role="alert"
                    className="rounded-xl bg-red-50 p-4 text-sm text-red-700"
                  >
                    {error}
                  </p>
                )}
                <button
                  disabled={busy || !canBuy}
                  className="flex w-full items-center justify-center gap-3 rounded-xl bg-blue-700 px-5 py-4 font-bold text-white hover:bg-blue-800 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  {busy
                    ? "Opening secure checkout…"
                    : "Join for $99 · first year"}
                  <ArrowRight size={18} />
                </button>
                <p className="text-center text-xs text-slate-500">
                  $190/year after year one. Cancel before renewal.{" "}
                  <a href="/terms" className="underline">
                    Terms
                  </a>{" "}
                  ·{" "}
                  <a href="/privacy" className="underline">
                    Privacy
                  </a>
                </p>
              </div>
            </form>
          </div>
        </section>
        <footer className="px-5 py-8 text-center text-sm text-slate-500">
          <a href="/">Contrax</a> · <a href="/upgrade">Compare plans</a> · Find
          government opportunities. Build your business.
        </footer>
      </main>
    </div>
  );
}
