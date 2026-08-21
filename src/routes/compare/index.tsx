import { createFileRoute } from "@tanstack/react-router";

const columns = ["Contrax", "GovWin / Deltek", "BidNet / Bonfire", "GovSpend", "Manual Bidding (SAM.gov)", "Consultant / Gov't Contract Specialist"];
const rows = [
  ["Pricing", "$19–199/mo with free trial", "$5K–20K+/yr (enterprise)", "$300–800/mo", "Varies by plan", "$0 (but cost of time)", "$3–10K+/mo retainer"],
  ["Incumbent Pricing Intel", "Yes (5-yr history)", "Partial (enterprise only)", "No", "No", "No", "No"],
  ["Free trial", "21-day free trial", "No or limited", "No or limited", "No or limited", "N/A", "No"],
  ["Bid coverage", "Federal + City (SAM.gov + NYC, synced daily)", "Federal only (strong)", "State/Local focused", "Federal spend data", "Limited to what you search", "Depends on their expertise"],
  ["Proposal drafting", "Yes (tailored to each RFP)", "No built-in drafting", "No", "No", "N/A", "Depends on consultant"],
  ["Win probability scoring", "Yes", "Partial (spend analytics)", "No", "Spend analytics", "N/A", "Subjective"],
  ["Ease of use / onboarding", "Minutes (4-step wizard)", "Weeks (enterprise onboarding)", "Moderate", "Moderate", "Steep (learn each system)", "Quick, but onboarding takes weeks"],
  ["Team collaboration", "Yes (role-based workspace)", "Enterprise", "Limited", "Yes", "N/A", "N/A"],
  ["Calendar / Slack integrations", "Planned", "Limited", "No", "Limited", "N/A", "N/A"],
  ["Best for", "Small/mid-size businesses new to gov contracting", "Large enterprises with dedicated BD teams", "State/local government vendors", "Teams needing contract spending intelligence", "Very small needs", "Well-funded companies"],
];

export const Route = createFileRoute("/compare/")({
  head: () => ({
    meta: [
      { title: "Contrax vs GovWin, BidNet & More | Government Contract Software Comparison" },
      { name: "description", content: "Compare Contrax vs GovWin, BidNet, GovSpend, SAM.gov manual bidding, and consultants. See pricing, proposal tools, bid coverage, and the best government contract software for small businesses." },
      { name: "robots", content: "index, follow" },
      { property: "og:type", content: "website" },
      { property: "og:url", content: "https://www.contrax.company/compare" },
      { property: "og:title", content: "Contrax vs GovWin, BidNet & More" },
      { property: "og:description", content: "A clear government contract software comparison for small businesses choosing between Contrax, GovWin, BidNet, SAM.gov, and consultants." },
      { property: "og:image", content: "https://www.contrax.company/logo-square.png" },
      { property: "og:image:type", content: "image/png" },
      { property: "og:image:alt", content: "Contrax government contract software comparison" },
      { property: "og:image:width", content: "1200" },
      { property: "og:image:height", content: "630" },
      { property: "og:site_name", content: "Contrax" },
      { name: "twitter:card", content: "summary_large_image" },
      { name: "twitter:title", content: "Contrax vs GovWin, BidNet & More" },
      { name: "twitter:description", content: "Compare pricing, coverage, proposal drafting, and collaboration across government contracting tools." },
      { name: "twitter:image", content: "https://www.contrax.company/logo-square.png" },
    ],
    links: [{ rel: "canonical", href: "https://www.contrax.company/compare" }],
  }),
  component: ComparePage,
});

function Mark({ value }: { value: string }) {
  const positive = value === "Yes" || value.startsWith("Yes ") || value.startsWith("21-day");
  const negative = ["No", "N/A"].includes(value) || value.startsWith("No ");
  return <span className="inline-flex items-start gap-2"><span className={positive ? "font-bold text-green-600" : negative ? "font-bold text-red-400" : "hidden"}>{positive ? "✓" : "✕"}</span><span>{value}</span></span>;
}

function ComparePage() {
  return <div className="min-h-screen bg-white">
    <section className="bg-gradient-to-br from-slate-900 via-slate-800 to-blue-900 py-20 sm:py-28">
      <div className="mx-auto max-w-5xl px-6 text-center"><p className="text-sm font-semibold uppercase tracking-widest text-amber-400">Government contracting software comparison</p><h1 className="mt-4 text-4xl font-extrabold tracking-tight text-white sm:text-5xl">Contrax vs. the Competition — How We Stack Up Against GovWin, BidNet &amp; More</h1><p className="mx-auto mt-6 max-w-3xl text-lg leading-relaxed text-blue-100/80">Choosing the right contracting platform is a big decision. Compare pricing, coverage, automated capabilities, and collaboration tools so you can make an informed choice for your business.</p></div>
    </section>
    <section className="py-16 sm:py-24"><div className="mx-auto max-w-7xl px-6"><div className="mb-10 max-w-2xl"><p className="font-semibold text-amber-600">A side-by-side look</p><h2 className="mt-2 text-3xl font-bold tracking-tight text-slate-900 sm:text-4xl">Find the right fit for your growth</h2><p className="mt-4 text-gray-600">Every option has a place. Here is how the tools compare on the capabilities that matter most.</p></div>
      <div className="hidden overflow-x-auto rounded-2xl border border-gray-200 shadow-sm md:block"><table className="w-full min-w-[1050px] border-collapse text-left text-sm"><thead><tr className="bg-slate-900 text-white"><th className="w-44 p-5 font-semibold">Capability</th>{columns.map((c, i) => <th key={c} className={`p-5 font-semibold ${i === 0 ? "bg-blue-900/60 text-amber-300" : ""}`}>{c}</th>)}</tr></thead><tbody>{rows.map(([label, ...values], r) => <tr key={label} className={r % 2 ? "bg-slate-50" : "bg-white"}><th className="p-5 font-semibold text-slate-900">{label}</th>{values.map((v, i) => <td key={i} className={`p-5 align-top leading-relaxed ${i === 0 ? "bg-blue-50/70 font-medium text-slate-900" : "text-gray-600"}`}><Mark value={v} /></td>)}</tr>)}</tbody></table></div>
      <div className="space-y-5 md:hidden">{columns.slice(1).map((competitor, ci) => <article key={competitor} className="rounded-2xl border border-gray-200 bg-white p-6 shadow-sm"><h3 className="text-xl font-bold text-slate-900">{competitor}</h3><div className="mt-5 space-y-4">{rows.map(([label, contrax, ...others]) => <div key={label} className="border-t border-gray-100 pt-3"><p className="text-xs font-semibold uppercase tracking-wide text-gray-500">{label}</p><div className="mt-1 text-sm text-gray-700"><span className="font-semibold text-blue-700">Contrax:</span> {contrax}</div><div className="mt-1 text-sm text-gray-600"><span className="font-semibold text-slate-700">{competitor}:</span> <Mark value={others[ci]} /></div></div>)}</div></article>)}</div>
    </div></section>
    <section className="bg-slate-50 py-16 sm:py-24"><div className="mx-auto max-w-3xl px-6"><h2 className="text-center text-3xl font-bold text-slate-900 sm:text-4xl">The Bottom Line</h2><div className="mt-8 space-y-5 text-lg leading-relaxed text-gray-600"><p>Contrax is built for small and mid-size businesses that want a practical path into government contracting. It combines opportunity discovery, plain-English bid summaries, win probability scoring, and proposal drafting in one affordable workspace.</p><p>At $19–199 per month, Contrax gives growing teams coverage of federal procurement sources without the enterprise price tag. The 21-day free trial lets you see matched opportunities before committing, while the guided onboarding takes minutes instead of weeks.</p><p>GovWin can be the right choice for a large enterprise with a $50M+ pipeline, a dedicated business development team, and a need for deep federal spend intelligence. BidNet or Bonfire may suit vendors focused specifically on state and local procurement. Manual SAM.gov searching remains useful for a very small need, and a specialist can bring valuable hands-on expertise when budget is less constrained.</p><p>For everyone else—especially teams ready to find more relevant bids and submit stronger proposals without hiring a full department—Contrax offers the best balance of capability, coverage, and cost.</p></div></div></section>
    <section className="bg-slate-900 py-16"><div className="mx-auto max-w-3xl px-6 text-center"><h2 className="text-3xl font-bold text-white sm:text-4xl">Ready to start winning contracts?</h2><p className="mt-4 text-lg text-blue-100/70">21-day free trial. No credit card required.</p><a href="/signup" className="mt-8 inline-flex items-center rounded-xl bg-amber-500 px-8 py-4 font-semibold text-white shadow-lg shadow-amber-500/25 transition hover:bg-amber-400">Start Free Trial <span className="ml-2">→</span></a></div></section>
    <section className="bg-gray-50 py-16 sm:py-24"><div className="mx-auto max-w-7xl px-6"><div className="mx-auto max-w-2xl text-center"><h2 className="text-sm font-semibold uppercase tracking-widest text-blue-600">The alternative</h2><h3 className="mt-3 text-3xl font-bold tracking-tight text-slate-900 sm:text-4xl">Contrax vs. doing it yourself, a specialist, or generic tools</h3><p className="mt-4 text-lg text-gray-600">Beyond the named platforms, the realistic choices are manual bidding, hiring a consultant, or repurposing generic RFP software. Here is how those stack up.</p></div>
      <div className="mt-14 overflow-x-auto rounded-2xl border border-gray-200 bg-white shadow-sm"><table className="w-full min-w-[820px] border-collapse text-left text-sm"><thead><tr className="border-b border-gray-200 bg-gray-50"><th className="px-6 py-5 text-sm font-semibold text-slate-700"><span className="sr-only">Criteria</span></th>{[{name:"Contrax",key:"contrax",highlight:true},{name:"Manual Bidding",key:"manual",highlight:false},{name:"Consultant",key:"consultant",highlight:false},{name:"Other Tools",key:"tools",highlight:false}].map((col)=>(<th key={col.key} className={`px-5 py-5 text-center ${col.highlight?"bg-blue-50/60":""}`}><span className={`text-sm font-bold ${col.highlight?"text-blue-700":"text-slate-700"}`}>{col.name}</span></th>))}</tr></thead><tbody className="divide-y divide-gray-100">{[{
        label:"Bid discovery",tooltip:"Who finds opportunities for you?",
        contrax:{value:"Scans federal and city procurement sites daily",positive:true},
        manual:{value:"You search SAM.gov, state portals & city sites manually",positive:false},
        consultant:{value:"Consultant checks known sources during business hours",positive:false},
        tools:{value:"Requires you to set up searches & filters yourself",positive:false},
      },{
        label:"Time to proposal",tooltip:"How fast from finding to submitting?",
        contrax:{value:"Hours — drafts in minutes",positive:true},
        manual:{value:"Days to weeks — research + writing from scratch",positive:false},
        consultant:{value:"Days — depends on their availability & backlog",positive:false},
        tools:{value:"Days — you still write the content",positive:false},
      },{
        label:"Monthly cost",tooltip:"What it costs per month",
        contrax:{value:"$19–$199/month",positive:true},
        manual:{value:"Hundreds in lost staff hours",positive:false},
        consultant:{value:"$3,000–$10,000+/month retainer",positive:false},
        tools:{value:"$200–$1,000/month",positive:false},
      },{
        label:"Proposal quality",tooltip:"Drafted vs. manual vs. template",
        contrax:{value:"Tailored drafts for each RFP",positive:true},
        manual:{value:"Depends entirely on your writing skills",positive:false},
        consultant:{value:"Professional — but expensive",positive:false},
        tools:{value:"Template-based — generic, not tailored",positive:false},
      },{
        label:"Learning curve",tooltip:"How easy to get started",
        contrax:{value:"Minutes — simple onboarding wizard",positive:true},
        manual:{value:"Steep — must learn each procurement system",positive:false},
        consultant:{value:"None — they handle it, but onboarding takes weeks",positive:false},
        tools:{value:"Moderate to steep — complex configuration required",positive:false},
      },{
        label:"Coverage",tooltip:"Federal, state, local?",
        contrax:{value:"Federal + state + local, all in one place",positive:true},
        manual:{value:"Limited to the sites you have time to check",positive:false},
        consultant:{value:"Usually focused on federal or their specialty",positive:false},
        tools:{value:"Varies — many only cover federal (SAM.gov)",positive:false},
      },].map((row)=>(
        <tr key={row.label} className="transition-colors hover:bg-gray-50/50"><td className="px-6 py-4"><div className="text-sm font-semibold text-slate-800">{row.label}</div><p className="mt-0.5 text-xs text-gray-400">{row.tooltip}</p></td>
        {(["contrax","manual","consultant","tools"] as const).map((key)=>{const cell=row[key];const highlight=key==="contrax";return(<td key={key} className={`px-5 py-4 text-center ${highlight?"bg-blue-50/30":""}`}><div className="flex flex-col items-center gap-1.5"><span className={cell.positive?"font-bold text-green-600":"font-bold text-red-400"}>{cell.positive?"✓":"✕"}</span><p className={`text-xs leading-relaxed ${highlight?"font-medium text-slate-800":"text-gray-500"}`}>{cell.value}</p></div></td>);})}
        </tr>))}</tbody></table></div>
      <div className="mt-12 text-center"><a href="/pricing" className="inline-flex items-center gap-2 rounded-xl border-2 border-slate-900 px-8 py-3 text-sm font-semibold text-slate-900 transition-all hover:bg-slate-900 hover:text-white active:scale-[0.98]">See plans <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" /></svg></a></div>
    </div></section>
    <section className="py-16 sm:py-24"><div className="mx-auto max-w-3xl px-6"><h2 className="text-center text-3xl font-bold text-slate-900">Frequently asked questions</h2><div className="mt-8 divide-y divide-gray-200 rounded-2xl border border-gray-200 bg-white">{[
      ["Is Contrax better than GovWin?", "For small and mid-size businesses, often yes: Contrax is more affordable, easier to onboard, includes AI scoring and proposal drafting tools, and costs a fraction of GovWin's enterprise pricing. GovWin may be a better fit for large enterprises needing deep federal intelligence."],
      ["Does Contrax replace SAM.gov?", "No. SAM.gov remains the official source for federal opportunities and submissions. Contrax complements it by monitoring SAM.gov, filtering matches, and helping you understand and respond to bids."],
      ["Can I switch from BidNet to Contrax?", "Yes. Contrax can work alongside or replace BidNet for teams that want federal opportunity coverage plus automated summaries, scoring, and proposal drafting."],
      ["Is Contrax suitable for federal contracting?", "Yes. Contrax monitors federal opportunities, including SAM.gov data, and helps you assess fit, understand RFP requirements, and draft tailored proposals."],
      ["How much does Contrax cost compared to hiring a consultant?", "Contrax costs $19–199 per month, compared with typical consultant retainers of $3,000–10,000 or more per month. A consultant may still be worthwhile for specialized strategy or hands-on support."],
      ["Do I need any government contracting experience?", "No. Contrax's four-step onboarding, plain-English bid summaries, and guided tools are designed to help first-time government contractors get started with confidence."],
    ].map(([q, a]) => <details key={q} className="group p-6"><summary className="cursor-pointer list-none pr-8 font-semibold text-slate-900 marker:hidden"><span className="flex items-center justify-between">{q}<span className="text-xl text-amber-500 transition group-open:rotate-45">+</span></span></summary><p className="mt-3 leading-relaxed text-gray-600">{a}</p></details>)}</div></div></section>
  </div>;
}
