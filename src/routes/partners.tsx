import { createFileRoute, redirect } from "@tanstack/react-router";
import { createServerFn } from "@tanstack/react-start";
import { useMemo, useState } from "react";
import { sql } from "~/db";
import { getCurrentUser } from "~/lib/auth";

type Award = { title: string; agency: string; amount: string; year: number };
export type Partner = {
  id: number; company_name: string; capabilities: string[]; naics_codes: string[]; past_awards: Award[];
  location: string; contact_info: string; partner_type: "prime" | "sub" | "both"; rating: number; description: string;
  match_score: number; match_reasons: string[];
};

const SEED = [
  ["Atlas Federal Builders", ["General contracting","Design-build","Commercial renovation","LEED construction"], ["236220","237310"], [{title:"Fort Meade Campus Renovation",agency:"GSA",amount:"$18.2M",year:2024}], "Baltimore, MD", "https://atlasfederal.example.com", "prime", 5, "Experienced small-business prime delivering complex federal renovations and secure facilities."],
  ["CivicGrid Technology", ["Cloud migration","DevSecOps","Cybersecurity","Data engineering"], ["541512","541519","518210"], [{title:"VA Cloud Modernization BPA",agency:"VA",amount:"$11.4M",year:2024}], "Arlington, VA", "partners@civicgrid.example.com", "both", 5, "Cloud-native technology partner with cleared engineers and proven agency modernization work."],
  ["Blue Ridge Security Group", ["Armed security","Access control","Emergency response","Security operations"], ["561612","561611"], [{title:"Federal Protective Services Support",agency:"DHS",amount:"$7.8M",year:2023}], "Hampton, VA", "https://blueridgesecurity.example.com", "sub", 4, "Cleared protective-services team supporting federal campuses and critical infrastructure."],
  ["TerraWorks Environmental", ["Remediation","Hazardous waste","Environmental compliance","Groundwater treatment"], ["562910","541620"], [{title:"Superfund Remediation Region 5",agency:"EPA",amount:"$15.6M",year:2024}], "Chicago, IL", "hello@terraworks.example.com", "sub", 5, "Environmental remediation specialists with deep EPA and Army Corps experience."],
  ["Northstar Civil Engineering", ["Civil engineering","Bridge design","Surveying","Structural inspection"], ["541330","237310"], [{title:"I-95 Bridge Rehabilitation",agency:"DOT",amount:"$18.2M",year:2024}], "Richmond, VA", "https://northstarcivil.example.com", "both", 4, "Multidisciplinary civil engineering firm helping primes deliver transportation programs."],
  ["Summit Mission Support", ["Program management","Logistics","Staff augmentation","Training"], ["541611","561210"], [{title:"Defense Logistics Readiness",agency:"DoD",amount:"$9.1M",year:2023}], "Alexandria, VA", "team@summitmission.example.com", "sub", 4, "Mission-support partner for defense and civilian agencies, from PMO to field logistics."],
  ["Ironclad Networks", ["Network operations","Zero trust","SOC operations","Cloud security"], ["541513","541519"], [{title:"DHS Cybersecurity Operations",agency:"DHS",amount:"$24.5M",year:2024}], "Reston, VA", "https://ironcladnetworks.example.com", "sub", 5, "24/7 security operations and zero-trust implementation with TS/SCI-cleared staff."],
  ["Greenline Energy Services", ["Energy efficiency","HVAC","Solar installation","Facility maintenance"], ["238220","221114","561210"], [{title:"Federal Energy Performance Contract",agency:"DOE",amount:"$6.7M",year:2023}], "Denver, CO", "partners@greenlineenergy.example.com", "both", 4, "Energy and facilities specialist helping construction primes meet performance targets."],
  ["Apex Health Analytics", ["Healthcare analytics","Actuarial analysis","Data visualization","Program evaluation"], ["541611","541690"], [{title:"HHS Healthcare Consulting BPA",agency:"HHS",amount:"$49.8M",year:2024}], "Bethesda, MD", "https://apexhealth.example.com", "sub", 5, "Healthcare analytics and policy experts supporting HHS, CMS, and NIH programs."],
  ["Redwood Architecture Studio", ["Architecture","Interior design","Historic preservation","BIM modeling"], ["541310","541330"], [{title:"Historic Courthouse Preservation",agency:"GSA",amount:"$4.2M",year:2023}], "Washington, DC", "studio@redwoodarch.example.com", "sub", 4, "Federal architecture practice with BIM and historic-preservation credentials."],
  ["Prairie Data Systems", ["IT help desk","Systems integration","Application development","Database administration"], ["541511","541512","541513"], [{title:"DOE National Lab IT Support",agency:"DOE",amount:"$32M",year:2024}], "Oak Ridge, TN", "https://prairiedata.example.com", "both", 4, "Scalable IT delivery partner for scientific, classified, and administrative environments."],
  ["HarborPoint Marine Contractors", ["Marine construction","Dredging","Port infrastructure","Heavy civil"], ["237990","237310"], [{title:"Norfolk Harbor Improvements",agency:"USACE",amount:"$21.3M",year:2024}], "Norfolk, VA", "contracts@harborpoint.example.com", "prime", 4, "Heavy-civil and marine contractor serving ports, waterways, and coastal installations."],
] as const;

async function ensurePartners() {
  await sql() `CREATE TABLE IF NOT EXISTS partner_companies (id SERIAL PRIMARY KEY, company_name TEXT NOT NULL, capabilities JSONB NOT NULL DEFAULT '[]'::jsonb, naics_codes JSONB NOT NULL DEFAULT '[]'::jsonb, past_awards JSONB NOT NULL DEFAULT '[]'::jsonb, location TEXT, contact_info TEXT, partner_type TEXT NOT NULL DEFAULT 'both', rating INTEGER DEFAULT 3, description TEXT, created_at TIMESTAMPTZ DEFAULT NOW())`;
  // Safe migrations for databases created by an earlier version.
  for (const statement of [
    sql() `ALTER TABLE partner_companies ADD COLUMN IF NOT EXISTS id SERIAL`,
    sql() `ALTER TABLE partner_companies ADD COLUMN IF NOT EXISTS company_name TEXT`,
    sql() `ALTER TABLE partner_companies ALTER COLUMN name DROP NOT NULL`,
    sql() `ALTER TABLE partner_companies ADD COLUMN IF NOT EXISTS capabilities JSONB DEFAULT '[]'::jsonb`,
    sql() `ALTER TABLE partner_companies ADD COLUMN IF NOT EXISTS naics_codes JSONB DEFAULT '[]'::jsonb`,
    sql() `ALTER TABLE partner_companies ADD COLUMN IF NOT EXISTS past_awards JSONB DEFAULT '[]'::jsonb`,
    sql() `ALTER TABLE partner_companies ADD COLUMN IF NOT EXISTS location TEXT`,
    sql() `ALTER TABLE partner_companies ADD COLUMN IF NOT EXISTS contact_info TEXT`,
    sql() `ALTER TABLE partner_companies ADD COLUMN IF NOT EXISTS partner_type TEXT DEFAULT 'both'`,
    sql() `ALTER TABLE partner_companies ADD COLUMN IF NOT EXISTS rating INTEGER DEFAULT 3`,
    sql() `ALTER TABLE partner_companies ADD COLUMN IF NOT EXISTS description TEXT`,
  ]) { try { await statement; } catch {} }
  // If table was created with 'name' instead of 'company_name', migrate data.
  try { await sql()`UPDATE partner_companies SET company_name = name WHERE company_name IS NULL AND name IS NOT NULL`; } catch {}
  const count = await sql() `SELECT COUNT(*) AS count FROM partner_companies`;
  if (Number((count[0] as any)?.count || 0) === 0) for (const p of SEED) await sql() `INSERT INTO partner_companies (company_name,name,capabilities,naics_codes,past_awards,location,contact_info,partner_type,rating,description) VALUES (${p[0]},${p[0]},${JSON.stringify(p[1])}::jsonb,${JSON.stringify(p[2])}::jsonb,${JSON.stringify(p[3])}::jsonb,${p[4]},${p[5]},${p[6]},${p[7]},${p[8]})`;
}

export const findPartners = createServerFn({ method: "GET" }).validator((data: unknown) => (data || {}) as { bid_id?: number }).handler(async ({ data }) => {
  const user = await getCurrentUser();
  if (!user) throw new Error("Not authenticated");
  await ensurePartners();
  const profileRows = await sql() `SELECT industry, service_categories, naics_codes FROM business_profiles WHERE user_id = ${user.id}`;
  const profile: any = profileRows[0] || {};
  let bid: any = null;
  if (data.bid_id) { const rows = await sql() `SELECT title,description,category FROM bids WHERE id = ${data.bid_id}`; bid = rows[0]; }
  const userNaics = new Set<string>((Array.isArray(profile.naics_codes) ? profile.naics_codes : []).map(String));
  const userCaps = (Array.isArray(profile.service_categories) ? profile.service_categories : []).map((x: string) => x.toLowerCase());
  const targetText = `${profile.industry || ""} ${bid?.title || ""} ${bid?.description || ""} ${bid?.category || ""}`.toLowerCase();
  const rows = await sql() `SELECT * FROM partner_companies ORDER BY company_name`;
  return (rows as any[]).map((r) => {
    const caps: string[] = Array.isArray(r.capabilities) ? r.capabilities : []; const codes: string[] = Array.isArray(r.naics_codes) ? r.naics_codes.map(String) : []; const awards: Award[] = Array.isArray(r.past_awards) ? r.past_awards : [];
    const overlap = codes.filter((c) => userNaics.has(c)); const complementary = caps.filter((c) => !userCaps.some((u) => c.toLowerCase().includes(u) || u.includes(c.toLowerCase())));
    const relevantAwards = awards.filter((a) => `${a.title} ${a.agency}`.toLowerCase().split(/\s+/).some((word) => word.length > 4 && targetText.includes(word)));
    const score = Math.min(100, Math.round((overlap.length ? Math.min(45, overlap.length * 22) : 0) + Math.min(35, complementary.length * 7) + Math.min(20, (relevantAwards.length || (awards.length && targetText ? 1 : 0)) * 10) + (overlap.length || complementary.length ? 5 : 0)));
    const reasons = [...overlap.map((c) => `NAICS overlap: ${c}`), ...relevantAwards.slice(0, 2).map((a) => `Past award: ${a.title}`), ...complementary.slice(0, 2).map((c) => `Complementary: ${c}`)];
    return { id: r.id, company_name: r.company_name, capabilities: caps, naics_codes: codes, past_awards: awards, location: r.location || "", contact_info: r.contact_info || "", partner_type: r.partner_type, rating: Number(r.rating || 3), description: r.description || "", match_score: score, match_reasons: reasons } as Partner;
  }).sort((a, b) => b.match_score - a.match_score || b.rating - a.rating);
});

const PROD_URL = "https://www.contrax.company";
const TITLE = "Partners — Contrax";
const DESC = "Find complementary prime contractors and subcontractors matched to your capabilities, NAICS codes, and government contracting opportunities.";

export const Route = createFileRoute("/partners")({
  loader: async ({ location }) => { const user = await getCurrentUser(); if (!user) throw redirect({ to: "/login" }); return findPartners({ data: { bid_id: Number(new URLSearchParams(location.search).get("bid_id")) || undefined } }); },
  component: PartnersPage,
  head: () => ({
    meta: [
      { title: TITLE },
      { name: "description", content: DESC },
      { name: "robots", content: "index, follow" },
      { property: "og:type", content: "website" },
      { property: "og:url", content: `${PROD_URL}/partners` },
      { property: "og:title", content: TITLE },
      { property: "og:description", content: DESC },
      { property: "og:image", content: `${PROD_URL}/logo-square.png` },
    ],
  }),
});

function Stars({ rating }: { rating: number }) { return <span className="inline-flex text-amber-400" aria-label={`${rating} out of 5 stars`}>{[1,2,3,4,5].map((n) => <svg key={n} className={`h-4 w-4 ${n <= rating ? "fill-current" : "fill-slate-200 text-slate-200"}`} viewBox="0 0 20 20"><path d="M10 1.5l2.63 5.33 5.88.85-4.25 4.14 1 5.85L10 14.9l-5.26 2.77 1-5.85L1.5 7.68l5.87-.85L10 1.5z" /></svg>)}</span>; }
function PartnersPage() {
  const partners = Route.useLoaderData(); const [query, setQuery] = useState(""); const [type, setType] = useState(""); const [rating, setRating] = useState(""); const [expanded, setExpanded] = useState<number | null>(null);
  const filtered = useMemo(() => partners.filter((p) => (!query || `${p.company_name} ${p.capabilities.join(" ")} ${p.naics_codes.join(" ")}`.toLowerCase().includes(query.toLowerCase())) && (!type || p.partner_type === type || p.partner_type === "both") && (!rating || p.rating >= Number(rating))), [partners, query, type, rating]);
  return <div className="min-h-screen bg-slate-50"><header className="sticky top-0 z-10 border-b border-slate-200 bg-white"><div className="mx-auto flex max-w-6xl items-center justify-between px-4 py-3"><a href="/" className="flex items-center gap-2"><img src="/logo.png" alt="Contrax" className="h-8 w-auto" /></a><nav className="flex items-center gap-4"><a href="/dashboard" className="text-sm font-medium text-slate-500 hover:text-slate-900">Dashboard</a><span className="text-sm font-semibold text-blue-600">Partners</span></nav></div></header><main className="mx-auto max-w-6xl px-4 py-8"><div className="mb-8"><p className="text-sm font-semibold uppercase tracking-wider text-blue-600">Team smarter</p><h1 className="mt-1 text-3xl font-bold text-slate-900">Partner Finder</h1><p className="mt-2 max-w-2xl text-slate-500">Find complementary primes and subcontractors matched to your capabilities, NAICS codes, and target bids.</p></div><div className="mb-6 flex flex-col gap-3 rounded-2xl border border-slate-200 bg-white p-4 shadow-sm sm:flex-row"><input aria-label="Search partners" value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search company, capability, or NAICS code..." className="min-w-0 flex-1 rounded-xl border border-slate-300 px-4 py-2.5 text-sm outline-none focus:border-blue-500" /><select value={type} onChange={(e) => setType(e.target.value)} className="rounded-xl border border-slate-300 px-3 py-2 text-sm"><option value="">All partner types</option><option value="prime">Prime contractors</option><option value="sub">Subcontractors</option><option value="both">Prime & sub</option></select><select value={rating} onChange={(e) => setRating(e.target.value)} className="rounded-xl border border-slate-300 px-3 py-2 text-sm"><option value="">Any rating</option><option value="5">★★★★★</option><option value="4">★★★★+</option><option value="3">★★★+</option></select></div><p className="mb-4 text-sm text-slate-500">{filtered.length} partner{filtered.length === 1 ? "" : "s"} found · ranked by fit</p><div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">{filtered.map((p) => { const open = expanded === p.id; return <article key={p.id} className="flex flex-col rounded-2xl border border-slate-200 bg-white p-5 shadow-sm transition hover:border-blue-200"><div className="flex items-start justify-between gap-3"><div><h2 className="font-bold text-slate-900">{p.company_name}</h2><span className={`mt-2 inline-flex rounded-full px-2.5 py-1 text-xs font-semibold ${p.partner_type === "prime" ? "bg-blue-100 text-blue-700" : p.partner_type === "sub" ? "bg-green-100 text-green-700" : "bg-indigo-100 text-indigo-700"}`}>{p.partner_type === "both" ? "Prime & Sub" : p.partner_type === "prime" ? "Prime" : "Subcontractor"}</span></div><div className="text-right"><Stars rating={p.rating} /><p className={`mt-2 text-xs font-bold ${p.match_score > 70 ? "text-green-600" : p.match_score >= 40 ? "text-amber-600" : "text-slate-400"}`}>{p.match_score}% match</p></div></div><div className="mt-4 flex flex-wrap gap-1.5">{p.capabilities.slice(0, 3).map((c) => <span key={c} className="rounded-md bg-slate-100 px-2 py-1 text-xs font-medium text-slate-600">{c}</span>)}</div><p className="mt-4 text-sm text-slate-500">{p.location}</p><p className="mt-2 line-clamp-2 text-sm leading-relaxed text-slate-600">{p.description}</p><div className="mt-4 h-1.5 overflow-hidden rounded-full bg-slate-100"><div className={`h-full ${p.match_score > 70 ? "bg-green-500" : p.match_score >= 40 ? "bg-amber-500" : "bg-red-400"}`} style={{ width: `${Math.max(5,p.match_score)}%` }} /></div><button type="button" onClick={() => setExpanded(open ? null : p.id)} className="mt-4 text-left text-sm font-semibold text-blue-600 hover:text-blue-700">{open ? "Hide details ↑" : "View capabilities, awards & contact →"}</button>{open && <div className="mt-4 space-y-4 border-t border-slate-100 pt-4 text-sm"><div><b className="text-slate-700">All capabilities</b><div className="mt-2 flex flex-wrap gap-1.5">{p.capabilities.map((c) => <span key={c} className="rounded bg-blue-50 px-2 py-1 text-xs text-blue-700">{c}</span>)}</div></div><div><b className="text-slate-700">NAICS</b><p className="mt-1 font-mono text-xs text-slate-500">{p.naics_codes.join(" · ")}</p></div><div><b className="text-slate-700">Past awards</b><ul className="mt-1 space-y-1 text-slate-600">{p.past_awards.map((a) => <li key={a.title}>• {a.title} ({a.agency}, {a.year}) — {a.amount}</li>)}</ul></div>{p.match_reasons.length > 0 && <div className="rounded-lg bg-green-50 p-3"><b className="text-green-800">Why this match</b><ul className="mt-1 text-xs text-green-700">{p.match_reasons.map((r) => <li key={r}>✓ {r}</li>)}</ul></div>}<a href={p.contact_info.startsWith("http") ? p.contact_info : `mailto:${p.contact_info}`} target={p.contact_info.startsWith("http") ? "_blank" : undefined} rel="noreferrer" className="inline-flex rounded-lg bg-amber-500 px-3 py-2 font-semibold text-white hover:bg-amber-600">Contact partner</a></div>}</article>; })}</div></main></div>;
}
