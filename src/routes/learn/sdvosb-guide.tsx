import { createFileRoute } from "@tanstack/react-router";
import { CertGuidePage } from "~/components/CertGuideLayout";

const TITLE = "SDVOSB Government Contracts: Veteran-Owned Business Guide";
const DESC =
  "SDVOSB eligibility, SBA verification through the certification portal, and the set-aside and sole-source advantages of being a service-disabled veteran-owned small business.";

export const Route = createFileRoute("/learn/sdvosb-guide")({
  head: () => ({
    meta: [
      { title: TITLE },
      { name: "description", content: DESC },
      { name: "robots", content: "index, follow" },
      { property: "og:type", content: "article" },
      { property: "og:url", content: "https://www.contrax.company/learn/sdvosb-guide" },
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
    links: [{ rel: "canonical", href: "https://www.contrax.company/learn/sdvosb-guide" }],
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
      eyebrow="SDVOSB Guide"
      title="SDVOSB Government Contracts: Veteran-Owned Business Guide"
      description="Service-disabled veteran-owned small businesses get some of the strongest preferences in federal contracting — including mandatory set-asides at the VA. Here's how to qualify, get verified, and win."
      current="/learn/sdvosb-guide"
    >
      <p className="text-lg leading-relaxed text-slate-600">
        The SDVOSB program is one of the federal government's most powerful small-business advantages. The Department of Veterans Affairs is required to set aside contracts for SDVOSBs whenever it can — and other agencies can too, plus award sole-source contracts and evaluation preferences. The catch: you must be verified before you can bid.
      </p>

      <Section n={1} title="SDVOSB eligibility — do you qualify?">
        <p className="leading-relaxed text-slate-600">To qualify as a Service-Disabled Veteran-Owned Small Business, your firm must meet all of these conditions:</p>
        <ul className="mt-4 space-y-2">
          <Bullet>At least 51% unconditionally owned and controlled by one or more service-disabled veterans, or by veterans who became permanently and totally disabled after service.</Bullet>
          <Bullet>The service-disabled veteran must have served on active duty (or in the Reserve/National Guard) and hold a service-connected disability rated by the VA — a rating of 0% or more qualifies.</Bullet>
          <Bullet>The veteran owner must manage the firm's day-to-day operations and hold its highest officer position.</Bullet>
          <Bullet>The business must be small under the NAICS size standard for the contracts it pursues.</Bullet>
        </ul>
        <p className="mt-4 leading-relaxed text-slate-600">The disability rating itself comes from the VA, not the SBA — if you haven't yet filed for a rating, that's the first step and can take time, so start early.</p>
      </Section>

      <Section n={2} title="The verification process">
        <p className="leading-relaxed text-slate-600">SDVOSB status is verified by the SBA through its certification portal at <strong className="text-slate-800">certify.sba.gov</strong>. The process:</p>
        <ul className="mt-4 space-y-2">
          <Bullet><strong className="text-slate-800">Register in SAM.gov</strong> and get your UEI — verification requires an active SAM registration.</Bullet>
          <Bullet><strong className="text-slate-800">Create your SBA certification account</strong> and start the SDVOSB application, uploading proof of ownership, control, veteran status, and the service-connected disability rating.</Bullet>
          <Bullet><strong className="text-slate-800">Complete the eligibility questionnaire</strong>, including the "unconditional ownership" attestations, and pay the application fee if one applies at the time you apply.</Bullet>
          <Bullet><strong className="text-slate-800">Respond to SBA questions quickly</strong> — incomplete applications are the most common reason for delay. Once verified, your status flows into SAM.gov and procurement databases automatically.</Bullet>
        </ul>
        <div className="mt-6 rounded-2xl border border-amber-200 bg-amber-50 p-6">
          <p className="text-sm font-semibold text-amber-800">💡 Pro tip</p>
          <p className="mt-2 text-sm text-amber-700">Verification is only the beginning: the SBA re-verifies firms periodically, and you must keep your SAM.gov registration and ownership documents current. A lapse in either can knock you out of an active bid.</p>
        </div>
      </Section>

      <Section n={3} title="The set-aside advantages">
        <p className="leading-relaxed text-slate-600">Verified SDVOSBs enjoy benefits that most small businesses never see:</p>
        <ul className="mt-4 space-y-2">
          <Bullet><strong className="text-slate-800">Mandatory VA set-asides:</strong> the VA's "Rule of Two" requires set-asides for SDVOSB/VOSB firms whenever two or more can perform the work at a fair price.</Bullet>
          <Bullet><strong className="text-slate-800">Sole-source awards:</strong> in qualifying circumstances, agencies — including the VA — can award contracts to a verified SDVOSB without competition.</Bullet>
          <Bullet><strong className="text-slate-800">Agency-wide preferences:</strong> other federal agencies may set aside contracts under the FAR SDVOSB program and may consider SDVOSB status as a plus factor in evaluations.</Bullet>
          <Bullet><strong className="text-slate-800">Lower competition:</strong> set-aside pools are dramatically smaller than full-and-open markets, so a verified firm with solid past performance can build a real pipeline.</Bullet>
        </ul>
      </Section>

      <Section n={4} title="Turning verification into wins">
        <p className="leading-relaxed text-slate-600">
          Once verified, treat the set-aside market like a full-time pipeline: monitor VA and agency portals for SDVOSB-designated solicitations, maintain a current capability statement that leads with your verification status, and invest in past performance in the NAICS codes you target — set-asides still require a winning technical approach and fair price.
        </p>
        <p className="mt-4 leading-relaxed text-slate-600">
          Contrax is built for exactly this: it matches your SDVOSB certification to set-aside bids the moment they post, scores your win probability, and drafts compliant proposals — so verified status turns into submitted bids, not just eligibility.
        </p>
      </Section>
    </CertGuidePage>
  );
}
