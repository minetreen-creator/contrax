import { createFileRoute } from "@tanstack/react-router";
import { CertGuidePage } from "~/components/CertGuideLayout";

const TITLE = "WOSB/EDWOSB Set-Aside Guide: Winning as a Women-Owned Business";
const DESC =
  "WOSB vs EDWOSB explained: who qualifies, how to get certified through the SBA, and where to find women-owned small business set-aside contracts in eligible NAICS codes.";

export const Route = createFileRoute("/learn/wosb-edwosb-guide")({
  head: () => ({
    meta: [
      { title: TITLE },
      { name: "description", content: DESC },
      { name: "robots", content: "index, follow" },
      { property: "og:type", content: "article" },
      { property: "og:url", content: "https://www.contrax.company/learn/wosb-edwosb-guide" },
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
    links: [{ rel: "canonical", href: "https://www.contrax.company/learn/wosb-edwosb-guide" }],
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
      eyebrow="WOSB / EDWOSB Guide"
      title="WOSB/EDWOSB Set-Aside Guide: Winning as a Women-Owned Business"
      description="The WOSB Federal Contract Program sets aside billions in federal work for women-owned firms — and the EDWOSB tier opens even more doors. Here's how to qualify, certify, and find the opportunities."
      current="/learn/wosb-edwosb-guide"
    >
      <p className="text-lg leading-relaxed text-slate-600">
        Each year, the federal government awards a targeted percentage of contracting dollars to women-owned small businesses through the WOSB Federal Contract Program. Agencies can set aside contracts exclusively for WOSBs and EDWOSBs in eligible industries — and in some cases award them sole-source. For a woman-owned firm, certification is the key that unlocks this pipeline.
      </p>

      <Section n={1} title="WOSB vs EDWOSB: what's the difference?">
        <p className="leading-relaxed text-slate-600">Both programs require a business that is at least 51% unconditionally owned, controlled, and managed by one or more women who are U.S. citizens. The difference is economic status:</p>
        <ul className="mt-4 space-y-2">
          <Bullet><strong className="text-slate-800">WOSB:</strong> any qualifying women-owned small business. WOSB set-asides are available in a specific list of NAICS codes where women are underrepresented in federal contracting.</Bullet>
          <Bullet><strong className="text-slate-800">EDWOSB:</strong> a women-owned firm whose owner also proves economic disadvantage — personal net worth (excluding primary residence and business equity), adjusted gross income, and total assets must fall within SBA thresholds.</Bullet>
        </ul>
        <p className="mt-4 leading-relaxed text-slate-600">If you qualify for EDWOSB, pursue it: EDWOSB set-asides are mandatory in a broader set of NAICS codes, and only EDWOSBs can receive those awards.</p>
      </Section>

      <Section n={2} title="How to get certified">
        <p className="leading-relaxed text-slate-600">You can certify directly through the SBA's free online portal at <strong className="text-slate-800">certify.sba.gov</strong>, or through one of the SBA-approved third-party certifiers (such as WBENC) whose certification the SBA accepts. The practical steps:</p>
        <ul className="mt-4 space-y-2">
          <Bullet><strong className="text-slate-800">Document 51% ownership and control:</strong> stock or membership records, operating agreements, and proof the woman owner directs day-to-day operations, strategy, and contracting decisions.</Bullet>
          <Bullet><strong className="text-slate-800">Confirm the right NAICS codes:</strong> your primary NAICS code must be on the WOSB/EDWOSB eligible list for set-aside eligibility.</Bullet>
          <Bullet><strong className="text-slate-800">Complete the portal application:</strong> upload ownership, control, and (for EDWOSB) financial documentation, and attest to eligibility.</Bullet>
          <Bullet><strong className="text-slate-800">Add your status to SAM.gov</strong> and keep your registration active — an expired SAM registration makes even a certified WOSB ineligible.</Bullet>
        </ul>
        <div className="mt-6 rounded-2xl border border-amber-200 bg-amber-50 p-6">
          <p className="text-sm font-semibold text-amber-800">💡 Pro tip</p>
          <p className="mt-2 text-sm text-amber-700">Before you apply, run your finances through the EDWOSB thresholds. Many owners who assume they only qualify as WOSB are actually EDWOSB-eligible — and EDWOSB status unlocks more set-asides.</p>
        </div>
      </Section>

      <Section n={3} title="Where the set-aside opportunities are">
        <p className="leading-relaxed text-slate-600">WOSB set-asides are concentrated in industries where women-owned firms are underrepresented — commonly including construction, janitorial and facility services, engineering and technical services, IT services, and several manufacturing categories. To find them:</p>
        <ul className="mt-4 space-y-2">
          <Bullet>Filter federal opportunity searches by "Women-Owned Small Business" or "EDWOSB" set-aside designations on SAM.gov and agency portals.</Bullet>
          <Bullet>Watch for <strong className="text-slate-800">sole-source authority</strong>: in eligible NAICS codes, agencies can award contracts to a qualified WOSB or EDWOSB without full competition.</Bullet>
          <Bullet>Track the <strong className="text-slate-800">limitations on subcontracting</strong> — for services, your firm must perform at least 50% of the work itself.</Bullet>
          <Bullet>Set up automated alerts on set-aside designations so you see qualifying opportunities the day they post — competition for WOSB set-asides is real, and early visibility wins.</Bullet>
        </ul>
      </Section>

      <Section n={4} title="Turning certification into contracts">
        <p className="leading-relaxed text-slate-600">
          Certification alone doesn't win bids — but it does remove the biggest barrier: the "can you even bid?" question. Update your capability statement with your WOSB/EDWOSB status, mention it in your technical approach only where relevant, and pair certification with real past performance and competitive pricing. Tools like Contrax make the pipeline automatic: set-aside-first bid matching that surfaces WOSB and EDWOSB opportunities for your NAICS codes, AI proposal drafting, and win-probability scoring so you bid where you can win.
        </p>
        <p className="mt-4 leading-relaxed text-slate-600">
          Requirements and NAICS eligibility lists change periodically — confirm the current rules on the SBA's official program pages before applying.
        </p>
      </Section>
    </CertGuidePage>
  );
}
