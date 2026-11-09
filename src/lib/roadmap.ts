/**
 * Personal government contracting roadmap (owner 2026-11-09, "build the roadmap"). From the
 * member's own profile and Contrax's data it says where they stand, what to pursue now, which
 * certifications could open set-aside work, which agencies and primes to target, what they are
 * missing, their next 3 actions and a 90-day plan with milestones they check off. PURE.
 *
 * Every number comes from data Contrax already holds (the gap map, the prime finder, Auto-Pilot);
 * certifications are suggested "if you qualify", never assumed.
 */
import { FEDERAL_TRADE_NAICS } from "~/lib/federal-trade-data";
import { SEO_TRADES } from "~/lib/seo-trades";

export interface RoadmapProfile {
  businessName?: string | null;
  industry?: string | null;
  services?: string[];
  naics?: string[];
  states?: string[];
  certifications?: string[];
  uei?: string | null;
  samExpiration?: string | null;
  yearsInBusiness?: number | null;
  pastPerformance?: string | null;
  capabilityStatement?: string | null;
}

export interface RoadmapMarket {
  spend: number;
  setAsideShare: number;
  topAgencies: { name: string; amount: number }[];
  ending12: number;
  label: "opening" | "crowded" | "small" | null;
}

export interface RoadmapPrime {
  name: string;
  value: number;
  agencies: string[];
  nextEnd: string | null;
}

export interface RoadmapPick {
  bidId: number;
  title: string;
  decision: "pursue" | "partner";
  fit: number;
  missing: string[];
}

export interface RoadmapInput {
  profile: RoadmapProfile;
  trade: string | null;
  state: string | null;
  market: RoadmapMarket | null;
  primes: RoadmapPrime[];
  picks: RoadmapPick[];
  done: string[];
  now?: Date;
}

const TRADE_WORDS: Record<string, RegExp> = {
  janitorial: /janitor|custodial|cleaning|housekeeping/,
  "security-guard": /security guard|guard service|security service|security officer/,
  trucking: /trucking|freight|hauling|transport/,
  landscaping: /landscap|lawn|mowing|grounds/,
  construction: /construction|contractor|building|roofing|paving|concrete|renovation/,
  hvac: /hvac|heating|air condition|plumb|mechanical/,
  electrical: /electric/,
  "it-services": /information technology|\bit\b|software|network|computer/,
  cybersecurity: /cyber/,
  "waste-hauling": /waste|trash|garbage|refuse|recycl/,
};

/** The SEO trade that best fits the profile: NAICS codes first, then words. PURE. */
export function profileTradeSlug(p: RoadmapProfile): string | null {
  const naics = (p.naics ?? []).map(String);
  for (const t of SEO_TRADES) {
    const codes = FEDERAL_TRADE_NAICS[t.slug] ?? [];
    if (naics.some((n) => codes.some((c) => n.startsWith(c) || c.startsWith(n)))) return t.slug;
  }
  const text = [p.industry, ...(p.services ?? [])].join(" ").toLowerCase();
  // Specific trades before the broad ones (cyber before IT, waste before trucking, HVAC before construction).
  const order = ["cybersecurity", "waste-hauling", "security-guard", "janitorial", "landscaping", "hvac", "electrical", "trucking", "it-services", "construction"];
  return order.find((slug) => TRADE_WORDS[slug].test(text)) ?? null;
}

export type CheckStatus = "done" | "missing" | "warn";
export interface ReadinessItem {
  key: string;
  label: string;
  status: CheckStatus;
  detail: string;
  href: string;
}

const DAY = 86_400_000;

export function readiness(p: RoadmapProfile, trade: string | null, now: Date = new Date()): ReadinessItem[] {
  const samDays = p.samExpiration ? Math.floor((new Date(p.samExpiration).getTime() - now.getTime()) / DAY) : null;
  const sam: ReadinessItem = !p.uei
    ? { key: "sam", label: "SAM.gov registration (UEI)", status: "missing", detail: "Federal agencies can only award to businesses registered in SAM.gov. It is free and takes 1 to 4 weeks.", href: "https://sam.gov/content/entity-registration" }
    : samDays !== null && samDays < 0
      ? { key: "sam", label: "SAM.gov registration (UEI)", status: "missing", detail: "Your SAM.gov registration has expired. Renew it before you bid.", href: "https://sam.gov/content/entity-registration" }
      : samDays !== null && samDays <= 60
        ? { key: "sam", label: "SAM.gov registration (UEI)", status: "warn", detail: `Your SAM.gov registration expires in ${samDays} days. Renew it now; renewals can take weeks.`, href: "https://sam.gov/content/entity-registration" }
        : { key: "sam", label: "SAM.gov registration (UEI)", status: "done", detail: p.samExpiration ? "Registered. Renew once a year." : "UEI on file. Add your SAM.gov expiration date so Contrax can remind you.", href: "/onboarding" };
  return [
    {
      key: "trade",
      label: "Your trade and states",
      status: trade && (p.states ?? []).length ? "done" : "missing",
      detail: trade && (p.states ?? []).length ? "Set: your bids, picks and this roadmap use them." : "Set your trade and the states you work in so Contrax can match bids to you.",
      href: "/onboarding",
    },
    sam,
    {
      key: "naics",
      label: "NAICS codes",
      status: (p.naics ?? []).length ? "done" : "missing",
      detail: (p.naics ?? []).length ? `${(p.naics ?? []).length} on file.` : "Agencies file every bid under a NAICS code. Add the codes for your work.",
      href: "/onboarding",
    },
    {
      key: "capability",
      label: "Capability statement",
      status: (p.capabilityStatement ?? "").trim().length >= 80 ? "done" : "missing",
      detail: (p.capabilityStatement ?? "").trim().length >= 80 ? "On file. Attach it to every intro email." : "A one-page summary primes and buyers ask for. Launchpad builds one from your profile.",
      href: "/launchpad",
    },
    {
      key: "past",
      label: "Past performance",
      status: (p.pastPerformance ?? "").trim().length >= 40 ? "done" : "missing",
      detail: (p.pastPerformance ?? "").trim().length >= 40 ? "On file." : "List 2 or 3 jobs like the ones you want, public or private. Buyers score it.",
      href: "/onboarding",
    },
  ];
}

export type Stage = "getting-ready" | "ready-to-bid" | "bidding";

export function stageOf(items: ReadinessItem[], picks: RoadmapPick[]): Stage {
  const missing = items.filter((i) => i.status === "missing").map((i) => i.key);
  if (missing.includes("sam") || missing.includes("trade")) return "getting-ready";
  return picks.length ? "bidding" : "ready-to-bid";
}

export const STAGE_TEXT: Record<Stage, { title: string; detail: string }> = {
  "getting-ready": { title: "Getting ready", detail: "A few setup steps stand between you and your first bid." },
  "ready-to-bid": { title: "Ready to bid", detail: "You are set up. Now pick targets and get in front of buyers and primes." },
  bidding: { title: "Bidding", detail: "Contrax is finding fits for you. Keep bids and prime introductions going." },
};

export interface CertSuggestion {
  code: string;
  name: string;
  who: string;
  unlocks: string;
  href: string;
}

const CERTS: CertSuggestion[] = [
  { code: "sdvosb", name: "Service-Disabled Veteran-Owned (SDVOSB)", who: "at least 51% owned and run by veterans with a service-connected disability", unlocks: "SDVOSB set-asides and sole-source awards, and the VA's veteran-first buying", href: "https://veterans.certify.sba.gov/" },
  { code: "vosb", name: "Veteran-Owned (VOSB)", who: "at least 51% owned and run by veterans", unlocks: "VA veteran set-asides", href: "https://veterans.certify.sba.gov/" },
  { code: "wosb", name: "Women-Owned (WOSB / EDWOSB)", who: "at least 51% owned and run by women", unlocks: "WOSB set-asides in industries where women-owned firms are underrepresented", href: "https://wosb.certify.sba.gov/" },
  { code: "hubzone", name: "HUBZone", who: "based in a HUBZone with 35% of staff living in one", unlocks: "HUBZone set-asides and a 10% price preference in open competition", href: "https://www.sba.gov/federal-contracting/contracting-assistance-programs/hubzone-program" },
  { code: "8a", name: "SBA 8(a)", who: "owned by socially and economically disadvantaged individuals, 2+ years in business", unlocks: "8(a) set-asides and sole-source awards for 9 years", href: "https://www.sba.gov/federal-contracting/contracting-assistance-programs/8a-business-development-program" },
];

/** Certifications the member does not hold, to check "if you qualify". PURE. */
export function certSuggestions(p: RoadmapProfile): CertSuggestion[] {
  const have = new Set((p.certifications ?? []).map((c) => c.toLowerCase()));
  return CERTS.filter((c) => !have.has(c.code) && !(c.code === "vosb" && have.has("sdvosb")));
}

/** What Auto-Pilot most often said the member is missing, most common first. PURE. */
export function commonGaps(picks: RoadmapPick[], n = 3): { item: string; times: number }[] {
  const counts = new Map<string, { item: string; times: number }>();
  for (const p of picks) {
    for (const m of p.missing) {
      const key = m.toLowerCase().replace(/[^a-z0-9 ]/g, "").trim();
      if (!key) continue;
      const c = counts.get(key) ?? { item: m, times: 0 };
      c.times++;
      counts.set(key, c);
    }
  }
  return [...counts.values()].sort((a, b) => b.times - a.times).slice(0, n);
}

export interface Milestone {
  key: string;
  label: string;
  href?: string;
  /** Done from the profile itself (no checkbox needed). */
  auto?: boolean;
}

export interface Phase {
  title: string;
  days: string;
  milestones: Milestone[];
}

/** The 90-day plan, with setup steps already done marked automatically. PURE. */
export function ninetyDayPlan(items: ReadinessItem[], trade: string | null, state: string | null): Phase[] {
  const ok = (k: string) => items.find((i) => i.key === k)?.status === "done";
  const q = trade && state ? `?trade=${trade}&state=${state}` : "";
  return [
    {
      title: "Get set up",
      days: "Days 1 to 14",
      milestones: [
        { key: "sam", label: "Register (or renew) in SAM.gov and get your UEI", href: "https://sam.gov/content/entity-registration", auto: ok("sam") },
        { key: "profile", label: "Finish your profile: trade, states, NAICS codes, past performance", href: "/onboarding", auto: ok("trade") && ok("naics") && ok("past") },
        { key: "capability", label: "Make your one-page capability statement", href: "/launchpad", auto: ok("capability") },
        { key: "certs", label: "Check which certifications you qualify for", href: "#certifications" },
      ],
    },
    {
      title: "Get in front of buyers",
      days: "Days 15 to 45",
      milestones: [
        { key: "agencies", label: "Pick 3 target agencies and register in their vendor portals", href: "#agencies" },
        { key: "primes", label: "Send intro emails to 3 primes that must subcontract", href: `/prime-finder${q}` },
        { key: "first-bid", label: "Bid on, or quote a prime for, your first job", href: "/radar" },
        { key: "recompetes", label: "List contracts ending in the next year that you could rebid", href: `/recompetes${q}` },
      ],
    },
    {
      title: "Build a track record",
      days: "Days 46 to 90",
      milestones: [
        { key: "two-bids", label: "Submit 2 more bids or subcontract quotes", href: "/radar" },
        { key: "debrief", label: "Ask for a debrief on any bid you lose", href: "#debrief" },
        { key: "past-update", label: "Add each new job to your past performance", href: "/onboarding" },
        { key: "cert-apply", label: "Apply for a certification you qualify for", href: "#certifications" },
      ],
    },
  ];
}

export function milestoneDone(m: Milestone, done: readonly string[]): boolean {
  return Boolean(m.auto) || done.includes(m.key);
}

/** The 3 things to do next: the first unfinished milestones, in plan order. PURE. */
export function nextActions(plan: Phase[], done: readonly string[], n = 3): Milestone[] {
  return plan.flatMap((p) => p.milestones).filter((m) => !milestoneDone(m, done)).slice(0, n);
}

export function progress(plan: Phase[], done: readonly string[]): { done: number; total: number } {
  const all = plan.flatMap((p) => p.milestones);
  return { done: all.filter((m) => milestoneDone(m, done)).length, total: all.length };
}

/** All milestone keys a member may check off (the API accepts only these). */
export const MILESTONE_KEYS: readonly string[] = ninetyDayPlan([], null, null).flatMap((p) => p.milestones.map((m) => m.key));
