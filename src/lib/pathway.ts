/**
 * The Contrax Pathway (owner 2026-11-09): the owner's positioning line and the four connected
 * steps, shared by /pathway and the homepage. PURE.
 */
export const PATHWAY_LINE = "Contrax doesn't just show you government contracts. It shows you how to get into the business of winning them.";

export interface PathwayStep {
  n: number;
  name: string;
  question: string;
  what: string;
  bullets: string[];
  href: string;
  cta: string;
  access: string;
  event: string;
}

export const PATHWAY_STEPS: PathwayStep[] = [
  {
    n: 1,
    name: "Know your market",
    question: "Where is the work in my trade, and who already has it?",
    what: "The gap map shows, state by state, what federal agencies spend in your trade, how much is set aside for small businesses, who buys it and how many companies hold the work now.",
    bullets: ["Federal spending and the small-business share", "Top buying agencies", "Openings: big spending, few companies holding the work"],
    href: "/gap-map",
    cta: "Open the gap map",
    access: "Free",
    event: "gap_map",
  },
  {
    n: 2,
    name: "Get your plan",
    question: "What should I do first, and what am I missing?",
    what: "Your roadmap is built from your business profile: where you stand, the certifications to check, the agencies and primes to target, your next 3 actions and a 90-day plan you check off.",
    bullets: ["Readiness: SAM.gov, NAICS, capability statement, past performance", "Certifications to check, if you qualify", "A 90-day plan saved to your account"],
    href: "/roadmap",
    cta: "Get my roadmap",
    access: "Free with an account",
    event: "roadmap",
  },
  {
    n: 3,
    name: "Find the bids that fit",
    question: "Which of today's bids are worth my time?",
    what: "Search every open federal, state and local bid in Radar. For members, Auto-Pilot reads each morning's new bids against your profile and says pursue, partner or pass, with why and what you may need.",
    bullets: ["Radar: open bids by trade and state", "Auto-Pilot: fit, eligibility by set-aside, pursue/partner/pass", "The strong fits lead your 6 AM email"],
    href: "/radar",
    cta: "Search open bids",
    access: "Search free; Auto-Pilot for members",
    event: "radar",
  },
  {
    n: 4,
    name: "Team with the primes",
    question: "Who already holds the contracts, and how do I get on their team?",
    what: "The prime finder lists the companies holding federal work in your trade and state, the ones required to subcontract to small businesses first, with when their contracts end and an intro email drafted from your profile.",
    bullets: ["Primes with SBA or GSA subcontracting plans", "When to reach out: 3 to 12 months before a contract ends", "An intro email you send yourself"],
    href: "/prime-finder",
    cta: "Find primes",
    access: "First 3 free; every prime with Professional",
    event: "prime_finder",
  },
];

