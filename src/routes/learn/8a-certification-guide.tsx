import { createFileRoute } from "@tanstack/react-router";
import { CertGuidePage } from "~/components/CertGuideLayout";

const TITLE = "8(a) Certification Guide: Eligibility, Timeline and Benefits";
const DESC =
  "Everything you need to know about SBA 8(a) certification: eligibility requirements, the application process, the 9-year program timeline, and the contracting benefits for disadvantaged small businesses.";

export const Route = createFileRoute("/learn/8a-certification-guide")({
  head: () => ({
    meta: [
      { title: TITLE },
      { name: "description", content: DESC },
      { name: "robots", content: "index, follow" },
      { property: "og:type", content: "article" },
      { property: "og:url", content: "https://www.contrax.company/learn/8a-certification-guide" },
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
    links: [{ rel: "canonical", href: "https://www.contrax.company/learn/8a-certification-guide" }],
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
      eyebrow="SBA Certification Guide"
      title="How to Get 8(a) Certified: The Complete Guide"
      description="The 8(a) Business Development program is the federal government's most powerful small-business program — and it runs on a 9-year clock. Here is what it takes to qualify, apply, and make the most of every year."
      current="/learn/8a-certification-guide"
    >
      <p className="text-lg leading-relaxed text-slate-600">
        The SBA 8(a) Business Development program gives socially and economically disadvantaged small businesses a direct path to federal contracts — including sole-source awards that never go to full open competition. But the clock starts ticking the day you're admitted: the program runs for exactly nine years, so planning matters as much as qualifying.
      </p>

      <Section n={1} title="Do you qualify?">
        <p className="leading-relaxed text-slate-600">To enter the 8(a) program, your business must meet all of these conditions:</p>
        <ul className="mt-4 space-y-2">
          <Bullet>At least 51% unconditionally owned and controlled by one or more socially and economically disadvantaged individuals who are U.S. citizens.</Bullet>
          <Bullet>The disadvantaged owner must be actively involved in daily management and hold the highest officer position.</Bullet>
          <Bullet>The business must be small under the NAICS size standard for its primary industry.</Bullet>
          <Bullet>The owner must demonstrate economic disadvantage (personal net worth, adjusted gross income, and total assets within SBA thresholds) and social disadvantage (membership in a designated group or an individual showing of disadvantage).</Bullet>
          <Bullet>Good character, a track record (or credible plan) for success, and no prior participation in the program.</Bullet>
        </ul>
      </Section>

      <Section n={2} title="How to apply">
        <p className="leading-relaxed text-slate-600">The application is online and free through the SBA's certification portal at <strong className="text-slate-800">certify.sba.gov</strong>. Follow these steps:</p>
        <ul className="mt-4 space-y-2">
          <Bullet><strong className="text-slate-800">Register in SAM.gov</strong> and obtain your Unique Entity ID (UEI) — you can't apply without an active registration.</Bullet>
          <Bullet><strong className="text-slate-800">Gather your documents:</strong> three years of personal and business tax returns, personal financial statements, a business plan, and proof of ownership and control.</Bullet>
          <Bullet><strong className="text-slate-800">Complete the online application</strong> in certify.sba.gov, including the narrative on social disadvantage and the required economic-disadvantage disclosures.</Bullet>
          <Bullet><strong className="text-slate-800">Respond to SBA follow-ups promptly.</strong> Missing documents are the #1 reason applications stall. SBA typically issues a decision within about 90 days of a complete application.</Bullet>
        </ul>
        <div className="mt-6 rounded-2xl border border-amber-200 bg-amber-50 p-6">
          <p className="text-sm font-semibold text-amber-800">💡 Pro tip</p>
          <p className="mt-2 text-sm text-amber-700">Certification is free — the SBA never charges for 8(a) applications. Be wary of paid "assistance" firms that promise approval; the fastest path is a complete, accurate, honest application.</p>
        </div>
      </Section>

      <Section n={3} title="The 9-year program timeline">
        <p className="leading-relaxed text-slate-600">8(a) participation is a fixed 9-year clock in two stages:</p>
        <ul className="mt-4 space-y-2">
          <Bullet><strong className="text-slate-800">Developmental stage (years 1–4):</strong> the program's most valuable years. You can receive sole-source 8(a) contracts and set-asides, access mentor-protégé relationships, and get business-development training.</Bullet>
          <Bullet><strong className="text-slate-800">Transitional stage (years 5–9):</strong> SBA gradually shifts you toward competing in the open market — fewer sole-source awards, more emphasis on competitive growth, and annual business-plan reviews.</Bullet>
        </ul>
        <p className="mt-4 leading-relaxed text-slate-600">Because the clock doesn't pause, use year one to build your pipeline: get your capability statement ready, add your 8(a) status to SAM.gov, and start bidding while the sole-source window is wide open.</p>
      </Section>

      <Section n={4} title="The benefits, in practice">
        <p className="leading-relaxed text-slate-600">8(a) firms get four things other small businesses don't:</p>
        <ul className="mt-4 space-y-2">
          <Bullet><strong className="text-slate-800">Sole-source authority:</strong> agencies can award 8(a) contracts up to the statutory dollar threshold without full-and-open competition.</Bullet>
          <Bullet><strong className="text-slate-800">Set-aside priority:</strong> 8(a) set-asides must be considered before many other small-business categories in agency acquisition planning.</Bullet>
          <Bullet><strong className="text-slate-800">Mentor-protégé and joint ventures:</strong> pairing with an established firm to pursue larger contracts with reduced affiliation risk.</Bullet>
          <Bullet><strong className="text-slate-800">A clear growth trajectory:</strong> the 9-year structure forces a plan — which is exactly what a credible, bankable GovCon business looks like by year five.</Bullet>
        </ul>
        <p className="mt-6 leading-relaxed text-slate-600">
          Eligibility rules and thresholds change, so always confirm current requirements on the SBA's official site before applying. When you're certified, tools like Contrax can match your 8(a) status to set-aside opportunities the moment they're posted — and track your program clock so you maximize every one of the nine years.
        </p>
      </Section>

      <Section n={5} title="The numbers SBA actually checks">
        <p className="leading-relaxed text-slate-600">"Economically disadvantaged" is not a judgement call in practice — SBA tests it against three published financial thresholds (13 CFR 124.104):</p>
        <ul className="mt-4 space-y-2">
          <Bullet><strong className="text-slate-800">Net worth below $850,000.</strong> SBA excludes your ownership interest in the applicant firm and the equity in your primary residence when it runs this test.</Bullet>
          <Bullet><strong className="text-slate-800">Income.</strong> If your adjusted gross income averaged over the three preceding years exceeds $400,000, SBA presumes you are not economically disadvantaged. The presumption can be rebutted, but you should plan on proving it rather than assuming it.</Bullet>
          <Bullet><strong className="text-slate-800">Total assets.</strong> If the fair market value of all your assets — including your primary residence and the value of the firm — exceeds $6.5 million, you generally will not be considered economically disadvantaged. Your IRA or other qualified retirement account is the main exclusion here.</Bullet>
          <Bullet><strong className="text-slate-800">Recent transfers.</strong> Assets you moved to an immediate family member or family trust for less than fair market value within two years before applying are attributed back to you.</Bullet>
        </ul>
        <p className="mt-4 leading-relaxed text-slate-600">
          Take a hypothetical owner with $300,000 in retirement savings, $180,000 of home equity in a $550,000 house, and 100% of a janitorial firm doing $1.4M in revenue. Her net worth test leaves the firm, the home equity, and the retirement account out; her total-asset test puts the house back in at its full $550,000. Owners routinely clear one test and fail the other.
        </p>
        <p className="mt-4 leading-relaxed text-slate-600">
          The full rule text is at <a href="https://www.ecfr.gov/current/title-13/section-124.104" className="font-semibold text-blue-700 underline">eCFR 13 CFR 124.104</a>.
        </p>
      </Section>

      <Section n={6} title="Clock, caps, and the mistakes that end applications">
        <p className="leading-relaxed text-slate-600">Four operational rules decide whether a good application survives its first year:</p>
        <ul className="mt-4 space-y-2">
          <Bullet><strong className="text-slate-800">Complete means complete.</strong> SBA tells you within 15 days whether your package is complete, and processes a complete package within 90 days — but the clock pauses every time SBA asks for more information (124.204). A document you have to send twice is a month you lose.</Bullet>
          <Bullet><strong className="text-slate-800">The business plan is due within 60 days of admission.</strong> SBA can suspend your access to 8(a) benefits, contracts included, if the plan is not with your servicing office by then (124.402).</Bullet>
          <Bullet><strong className="text-slate-800">Excessive withdrawals can terminate you.</strong> Aggregate withdrawals above $250,000 in a fiscal year (sales up to $1M), $300,000 (sales of $1M–$2M), or $400,000 (sales over $2M) put your eligibility at risk (124.112).</Bullet>
          <Bullet><strong className="text-slate-800">Sole-source has a dollar edge.</strong> Agencies must compete an 8(a) requirement when two or more eligible participants are expected to offer at a fair market price and the anticipated award, including options, exceeds $4,500,000 — or $7,000,000 in manufacturing NAICS codes (124.506). Below that line, sole source is on the table.</Bullet>
        </ul>
        <p className="mt-4 leading-relaxed text-slate-600">
          The step-by-step application walkthrough is in our <a href="/blog/8a-certification-guide" className="font-semibold text-blue-700 underline">8(a) certification guide for small businesses</a>. If your owner is also a woman or a veteran, compare the <a href="/learn/wosb-edwosb-guide" className="font-semibold text-blue-700 underline">WOSB/EDWOSB</a> and <a href="/learn/sdvosb-guide" className="font-semibold text-blue-700 underline">SDVOSB</a> guides — certifications stack, and the <a href="/learn/hubzone-guide" className="font-semibold text-blue-700 underline">HUBZone</a> preference can apply to the same bid.
        </p>
      </Section>
    </CertGuidePage>
  );
}
