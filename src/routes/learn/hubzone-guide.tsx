import { createFileRoute } from "@tanstack/react-router";
import { CertGuidePage } from "~/components/CertGuideLayout";

const TITLE = "HUBZone Explained: Contracting Advantages for Your Area";
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

      <Section n={5} title="The 35% math, done properly">
        <p className="leading-relaxed text-slate-600">The residency test is a headcount ratio, and SBA rounds it (13 CFR 126.200(d)):</p>
        <ul className="mt-4 space-y-2">
          <Bullet><strong className="text-slate-800">Round to the nearest whole number.</strong> A firm with 25 employees needs 9 HUBZone residents (35% is 8.75, rounded to 9). A firm with 95 employees needs 33 (33.25 rounded down).</Bullet>
          <Bullet><strong className="text-slate-800">A one-person firm</strong> does not get to round at all — that single employee must live in a HUBZone.</Bullet>
          <Bullet><strong className="text-slate-800">Legacy employees</strong> are the exception: up to four employees who lived in a HUBZone for at least 180 days after your certification date can keep counting even after they move, provided they work at least 30 hours a week and at least one other employee still lives in a HUBZone.</Bullet>
        </ul>
        <p className="mt-4 leading-relaxed text-slate-600">
          Hiring is the lever most firms miss. Adding three employees in a qualified tract can take a 20-person firm from 6 residents (30%, failing) to 9 residents (45%, passing) — which is often cheaper than moving the office.
        </p>
      </Section>

      <Section n={6} title="The price preference, precisely">
        <p className="leading-relaxed text-slate-600">
          The 10% preference does not apply to every bid you submit (13 CFR 126.613). It applies only when the lowest responsive offer came from a business that is <em>not</em> small: the contracting officer then adds 10% to that company's price and compares it with yours.
        </p>
        <p className="mt-4 leading-relaxed text-slate-600">
          SBA's own example makes it concrete: a large business bids $93, your HUBZone firm bids $98, and another small business bids $95. The large business is the lowest initial offer, so the preference applies — 10% of $93 is $102.30, and your $98 now beats it. Bid $103 instead and you lose. If the lowest initial offer had come from a small business, the preference would not have applied at all.
        </p>
      </Section>

      <Section n={7} title="Recertification, the 20% floor, and a moving map">
        <ul className="mt-4 space-y-2">
          <Bullet><strong className="text-slate-800">Every three years.</strong> Recertify inside the 90 calendar days before your triennial anniversary. Miss it and SBA decertifies you at the end of your eligibility period — though recertifying within 30 days can restore your status (126.500). SBA also examines each certified firm at least once every three years.</Bullet>
          <Bullet><strong className="text-slate-800">The 20% floor.</strong> While performing a HUBZone contract you must "attempt to maintain" 35%, but a firm that drops below 20% of total employees has failed the attempt and faces proposed decertification (126.602). A firm performing a HUBZone contract that sits between 20% and 35% can still recertify with documented, substantive recruiting efforts.</Bullet>
          <Bullet><strong className="text-slate-800">Ownership changes.</strong> If you merge with, acquire, or are acquired by another company, you must give SBA evidence within 30 calendar days that you still meet the requirements (126.501).</Bullet>
          <Bullet><strong className="text-slate-800">A map that moves.</strong> Qualified census tracts and non-metropolitan counties are updated every five years, areas that lose their designation stay on the map as Redesignated Areas for three years, and base-closure areas drop off after eight (126.105). A purchased building or a lease of at least 10 years in a HUBZone can protect your principal-office location for up to 10 years.</Bullet>
        </ul>
        <p className="mt-4 leading-relaxed text-slate-600">
          Next: the <a href="/learn/8a-certification-guide" className="font-semibold text-blue-700 underline">8(a) guide</a>, the <a href="/learn/wosb-edwosb-guide" className="font-semibold text-blue-700 underline">WOSB/EDWOSB guide</a>, and the <a href="/learn/sdvosb-guide" className="font-semibold text-blue-700 underline">SDVOSB guide</a> for the other set-asides — and our <a href="/blog/find-set-aside-contracts" className="font-semibold text-blue-700 underline">set-aside search guide</a> for finding the notices in SAM.gov.
        </p>
      </Section>
    </CertGuidePage>
  );
}
