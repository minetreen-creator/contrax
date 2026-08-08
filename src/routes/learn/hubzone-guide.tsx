import { createFileRoute } from "@tanstack/react-router";
import { CertGuidePage } from "~/components/CertGuideLayout";

const TITLE = "HUBZone Explained: Contracting Advantages for Underutilized Areas";
const DESC =
  "How the SBA HUBZone program works: the HUBZone map, certification requirements, the 10% price evaluation preference, and set-aside and sole-source contracting advantages.";

export const Route = createFileRoute("/learn/hubzone-guide")({
  head: () => ({
    meta: [
      { title: TITLE },
      { name: "description", content: DESC },
      { name: "robots", content: "index, follow" },
      { property: "og:type", content: "article" },
      { property: "og:url", content: "https://www.contrax.company/learn/hubzone-guide" },
      { property: "og:title", content: TITLE },
      { property: "og:description", content: DESC },
      { property: "og:image", content: "https://www.contrax.company/logo-square.png" },
      { property: "og:image:width", content: "1200" },
      { property: "og:image:height", content: "630" },
      { property: "og:site_name", content: "Contrax" },
      { name: "twitter:card", content: "summary_large_image" },
      { name: "twitter:title", content: TITLE },
      { name: "twitter:description", content: DESC },
      { name: "twitter:image", content: "https://www.contrax.company/logo-square.png" },
    ],
    links: [{ rel: "canonical", href: "https://www.contrax.company/learn/hubzone-guide" }],
  }),
  component: GuidePage,
});

function Section({ n, title, children }: { n: number; title: string; children: React.ReactNode }) {
  return (
    <section className="mb-12">
      <div className="mb-5 flex items-center gap-4">
        <span className="flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-xl bg-amber-500 text-lg font-bold text-white shadow-md">{n}</span>
        <h2 className="text-2xl font-bold text-slate-900 sm:text-3xl">{title}</h2>
      </div>
      {children}
    </section>
  );
}

function Bullet({ children }: { children: React.ReactNode }) {
  return (
    <li className="flex items-start gap-3 text-slate-600">
      <span className="mt-1.5 h-1.5 w-1.5 flex-shrink-0 rounded-full bg-amber-500" />
      <span>{children}</span>
    </li>
  );
}

function GuidePage() {
  return (
    <CertGuidePage
      eyebrow="HUBZone Guide"
      title="HUBZone Explained: Contracting Advantages for Underutilized Areas"
      description="The HUBZone program rewards businesses that invest in historically underutilized communities with a 10% price evaluation preference and exclusive set-aside opportunities. Here's how it works."
      current="/learn/hubzone-guide"
    >
      <p className="text-lg leading-relaxed text-slate-600">
        The Historically Underutilized Business Zone (HUBZone) program gives certified small businesses a competitive edge that no other certification offers: a <strong className="text-slate-800">10% price evaluation preference</strong> in full-and-open competitions, plus access to HUBZone-only set-asides and sole-source awards. For a small business located in — and hiring from — an eligible area, it's one of the fastest ways to level the playing field.
      </p>

      <Section n={1} title="Understanding the HUBZone map">
        <p className="leading-relaxed text-slate-600">A "HUBZone" is a geographic area designated by the SBA. Your business must have its <strong className="text-slate-800">principal office located inside a HUBZone</strong>. The SBA's interactive HUBZone map (maps.certify.sba.gov) shows the qualifying areas, which include:</p>
        <ul className="mt-4 space-y-2">
          <Bullet><strong className="text-slate-800">Qualified census tracts</strong> — low-income areas designated by HUD.</Bullet>
          <Bullet><strong className="text-slate-800">Qualified non-metropolitan counties</strong> — rural counties with low median household income.</Bullet>
          <Bullet><strong className="text-slate-800">Base closure areas</strong> — communities affected by closed military bases.</Bullet>
          <Bullet><strong className="text-slate-800">Governor-designated areas</strong> and <strong className="text-slate-800">Indian lands</strong>.</Bullet>
        </ul>
        <p className="mt-4 leading-relaxed text-slate-600">Boundaries change over time as census data updates, so check the official map before applying — and before you renew — rather than assuming your address still qualifies.</p>
      </Section>

      <Section n={2} title="Certification requirements">
        <p className="leading-relaxed text-slate-600">To certify, your business must satisfy three requirements at all times:</p>
        <ul className="mt-4 space-y-2">
          <Bullet><strong className="text-slate-800">Ownership:</strong> at least 51% owned and controlled by U.S. citizens, or by a community development corporation, agricultural cooperative, or other qualifying entity.</Bullet>
          <Bullet><strong className="text-slate-800">Location:</strong> the principal office — where day-to-day management happens — must be in a HUBZone.</Bullet>
          <Bullet><strong className="text-slate-800">Hiring:</strong> at least 35% of employees must reside in a HUBZone.</Bullet>
        </ul>
        <p className="mt-4 leading-relaxed text-slate-600">Apply free through the SBA's certification portal at <strong className="text-slate-800">certify.sba.gov</strong>: complete the application, upload proof of ownership, location, and employee residency, and respond to any SBA follow-ups. The SBA verifies your employees' addresses and your office location, so keep records current.</p>
      </Section>

      <Section n={3} title="The benefits — what certification buys you">
        <p className="leading-relaxed text-slate-600">A HUBZone certification delivers four concrete advantages:</p>
        <ul className="mt-4 space-y-2">
          <Bullet><strong className="text-slate-800">10% price evaluation preference:</strong> in full-and-open competitions, the government may treat your bid as up to 10% lower than it actually is — a decisive edge against larger competitors.</Bullet>
          <Bullet><strong className="text-slate-800">HUBZone set-asides:</strong> contracts set aside exclusively for HUBZone-certified firms, where you only compete against other certified businesses.</Bullet>
          <Bullet><strong className="text-slate-800">Sole-source authority:</strong> agencies can award contracts to a HUBZone firm without full-and-open competition, subject to statutory dollar thresholds.</Bullet>
          <Bullet><strong className="text-slate-800">Priority consideration:</strong> in agency acquisition planning, HUBZone set-asides must be considered before full-and-open competition for qualifying requirements.</Bullet>
        </ul>
      </Section>

      <Section n={4} title="Staying certified and winning">
        <p className="leading-relaxed text-slate-600">
          HUBZone certification isn't a one-time event — the SBA reviews eligibility regularly, and the rules require you to maintain the 35% employee-residency ratio and your qualifying principal office. Keep employee residency data in one place, re-check the map at every renewal, and don't let SAM.gov registration lapse.
        </p>
        <p className="mt-4 leading-relaxed text-slate-600">
          When you're certified, put the preference to work: target HUBZone-designated solicitations in your NAICS codes, and use your 10% cushion strategically on full-and-open bids. Contrax does the surveillance for you — its set-aside-first matching surfaces HUBZone opportunities the day they post, with win-probability scoring and proposal drafting so your certification actually converts into submitted bids.
        </p>
      </Section>
    </CertGuidePage>
  );
}
