import { createFileRoute } from "@tanstack/react-router";
import { CertGuidePage } from "~/components/CertGuideLayout";

const TITLE = "WOSB/EDWOSB Set-Aside Guide: How Women-Owned Businesses Win";
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

      <Section n={5} title="What EDWOSB status actually requires">
        <p className="leading-relaxed text-slate-600">EDWOSB economic disadvantage is tested against three published financial thresholds (13 CFR 127.203):</p>
        <ul className="mt-4 space-y-2">
          <Bullet><strong className="text-slate-800">Net worth below $850,000</strong> — excluding your ownership interest in the firm and your equity in your primary residence.</Bullet>
          <Bullet><strong className="text-slate-800">Income:</strong> an adjusted gross income averaged over the three preceding years above $400,000 creates a presumption that you are not economically disadvantaged.</Bullet>
          <Bullet><strong className="text-slate-800">Total assets:</strong> a fair market value above $6.5 million, counting your home and the business, generally disqualifies you.</Bullet>
          <Bullet><strong className="text-slate-800">Transfers:</strong> assets moved to an immediate family member for less than fair market value within two years of certification are attributed back to you.</Bullet>
        </ul>
        <p className="mt-4 leading-relaxed text-slate-600">
          A woman-owned engineering firm with $900,000 in revenue and a clean financial picture on all three tests is EDWOSB-eligible — which opens work a plain WOSB cannot bid. The rule text is at <a href="https://www.ecfr.gov/current/title-13/section-127.203" className="font-semibold text-blue-700 underline">eCFR 13 CFR 127.203</a>.
        </p>
      </Section>

      <Section n={6} title="Who can actually compete for a set-aside">
        <p className="leading-relaxed text-slate-600">
          SBA designates eligible industries by NAICS code, and the designation decides which pool a requirement goes into (127.503): where women are <em>under</em>represented, competition can be restricted to EDWOSBs; where women are <em>substantially</em> underrepresented, the pool includes WOSBs and EDWOSBs.
        </p>
        <p className="mt-4 leading-relaxed text-slate-600">
          Two details change how you bid. An agency cannot stack certifications — it may not limit a WOSB or EDWOSB competition to firms that are also 8(a), HUBZone, or SDVOSB (127.503(e)). And you do not have to wait for the certificate to bid: a firm with a complete application pending, no negative determination, and small size under the contract's NAICS code may submit an offer, and if it becomes the apparent successful offeror SBA must decide within 15 calendar days (127.504). Sole-source authority, where it exists, is capped at an anticipated award — including options — of $4,500,000, or $7,000,000 in manufacturing NAICS codes.
        </p>
      </Section>

      <Section n={7} title="Staying eligible — and the performance trap">
        <p className="leading-relaxed text-slate-600">
          Certification runs on a three-year cycle: SBA or your third-party certifier conducts a program examination every three years, and you must recertify or notify SBA within 90 calendar days of the end of your eligibility period. Miss that window and you are decertified — though recertifying within 30 days of the end date can reinstate you (127.400).
        </p>
        <p className="mt-4 leading-relaxed text-slate-600">
          Then the limitations on subcontracting take over. On a services contract above the simplified acquisition threshold, a WOSB prime may not pay more than 50% of what the government pays it to firms that are not similarly situated; general construction caps that at 85%, and specialty trade construction at 75% (13 CFR 125.6). Work done by a certified WOSB subcontractor does not count against the cap — a subcontract to an SDVOSB that is not also a WOSB does.
        </p>
        <p className="mt-4 leading-relaxed text-slate-600">
          Next: the <a href="/learn/8a-certification-guide" className="font-semibold text-blue-700 underline">8(a) guide</a> if your owner may also qualify as economically disadvantaged, the <a href="/learn/sdvosb-guide" className="font-semibold text-blue-700 underline">SDVOSB guide</a> for veteran-owned firms, and the <a href="/learn/hubzone-guide" className="font-semibold text-blue-700 underline">HUBZone guide</a> for the location-based preference. Our <a href="/blog/find-set-aside-contracts" className="font-semibold text-blue-700 underline">set-aside search guide</a> shows how to find the notices in SAM.gov.
        </p>
      </Section>
    </CertGuidePage>
  );
}
