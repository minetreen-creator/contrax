import type { ReactNode } from "react";

export interface CertGuideLink {
  title: string;
  href: string;
  badge: string;
  blurb: string;
}

/** The four certification-specific guides — shared by the /learn hub and article pages. */
export const CERT_GUIDES: CertGuideLink[] = [
  {
    title: "How to Get 8(a) Certified: The Complete Guide",
    href: "/learn/8a-certification-guide",
    badge: "8(a)",
    blurb: "Eligibility, the application process, and the 9-year program timeline — in plain English.",
  },
  {
    title: "WOSB/EDWOSB Set-Aside Guide: Winning as a Women-Owned Business",
    href: "/learn/wosb-edwosb-guide",
    badge: "WOSB",
    blurb: "WOSB vs EDWOSB, how to get certified, and where the set-aside opportunities are.",
  },
  {
    title: "SDVOSB Government Contracts: Veteran-Owned Business Guide",
    href: "/learn/sdvosb-guide",
    badge: "SDVOSB",
    blurb: "SDVOSB eligibility, verification through the SBA, and the set-aside advantages.",
  },
  {
    title: "HUBZone Explained: Contracting Advantages for Underutilized Areas",
    href: "/learn/hubzone-guide",
    badge: "HUBZone",
    blurb: "How the HUBZone map works, how to get certified, and the benefits for your pricing.",
  },
];

export function CertGuideHero({ eyebrow, title, description }: { eyebrow: string; title: string; description: string }) {
  return (
    <section className="bg-gradient-to-br from-slate-900 via-slate-800 to-blue-900 py-16 sm:py-24">
      <div className="mx-auto max-w-4xl px-6 text-center">
        <a href="/learn" className="inline-flex items-center gap-1.5 text-sm font-medium text-blue-200 transition hover:text-amber-300">
          ← Back to the Contrax Resource Hub
        </a>
        <p className="mt-6 text-sm font-semibold uppercase tracking-widest text-amber-400">{eyebrow}</p>
        <h1 className="mt-4 text-4xl font-extrabold tracking-tight text-white sm:text-5xl">{title}</h1>
        <p className="mx-auto mt-6 max-w-2xl text-lg leading-relaxed text-blue-100/80">{description}</p>
      </div>
    </section>
  );
}

export function RelatedGuides({ current }: { current: string }) {
  const others = CERT_GUIDES.filter((g) => g.href !== current);
  return (
    <section className="bg-slate-50 py-16">
      <div className="mx-auto max-w-5xl px-6">
        <h2 className="text-center text-2xl font-bold text-slate-900 sm:text-3xl">More certification guides</h2>
        <p className="mx-auto mt-3 max-w-2xl text-center text-gray-600">
          Set-aside certifications are how small businesses win a bigger share of federal work. Read the guides that apply to you.
        </p>
        <div className="mt-8 grid gap-5 md:grid-cols-3">
          {others.map((g) => (
            <a key={g.href} href={g.href} className="group flex flex-col rounded-2xl border border-slate-200 bg-white p-6 shadow-sm transition hover:-translate-y-1 hover:shadow-lg">
              <span className="self-start rounded-full bg-blue-50 px-3 py-1 text-xs font-bold uppercase tracking-wide text-blue-700">{g.badge}</span>
              <h3 className="mt-4 font-bold text-slate-900 group-hover:text-blue-700">{g.title}</h3>
              <p className="mt-2 text-sm leading-relaxed text-slate-600">{g.blurb}</p>
              <span className="mt-4 text-sm font-semibold text-blue-600">Read the guide →</span>
            </a>
          ))}
        </div>
      </div>
    </section>
  );
}

export function CertGuideCTA() {
  return (
    <section className="bg-slate-900 py-16">
      <div className="mx-auto max-w-3xl px-6 text-center">
        <h2 className="text-3xl font-bold text-white sm:text-4xl">Certified — now go win set-aside bids</h2>
        <p className="mt-4 text-lg text-blue-100/70">
          Contrax matches your 8(a), WOSB, SDVOSB, or HUBZone certification to set-aside opportunities first, tracks your certification deadlines, and drafts your proposals.
        </p>
        <a href="/signup" className="mt-8 inline-flex items-center rounded-xl bg-amber-500 px-8 py-4 font-semibold text-white shadow-lg shadow-amber-500/25 transition hover:bg-amber-400">
          Start Matching Set-Asides <span className="ml-2">→</span>
        </a>
      </div>
    </section>
  );
}

/** Shared page shell for certification guide articles. */
export function CertGuidePage({ eyebrow, title, description, current, children }: { eyebrow: string; title: string; description: string; current: string; children: ReactNode }) {
  return (
    <main className="min-h-screen bg-white">
      <CertGuideHero eyebrow={eyebrow} title={title} description={description} />
      <article className="mx-auto max-w-3xl px-6 py-14">
        <div className="prose-slate space-y-0">{children}</div>
      </article>
      <RelatedGuides current={current} />
      <CertGuideCTA />
    </main>
  );
}
