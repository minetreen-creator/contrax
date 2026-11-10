/**
 * The Contrax Pathway (owner 2026-11-09): the owner's positioning line and the five connected
 * steps (step 5, co-op contracts, owner 2026-11-10), shared by /pathway and the homepage. PURE.
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
  // Copy pass (owner 2026-11-10): tool names capitalized the same everywhere (Gap Map, Your Roadmap,
  // Radar, Auto-Pilot, Prime Finder), one idea per sentence, and each plan named exactly.
  {
    n: 1,
    name: "Know your market",
    question: "Where is the work in my trade, and who already has it?",
    what: "The Gap Map shows, state by state, what federal agencies spend in your trade and how much is set aside for small businesses. See who buys it, and how many companies hold the work today.",
    bullets: ["Federal spending and the small-business share", "Top buying agencies", "Openings: big spending, few companies holding the work"],
    href: "/gap-map",
    cta: "Open the Gap Map",
    access: "Free",
    event: "gap_map",
  },
  {
    n: 2,
    name: "Get your plan",
    question: "What should I do first, and what am I missing?",
    what: "Your Roadmap is built from your business profile. It shows where you stand, the certifications to check, and the agencies and primes to target. Then it gives you your next 3 actions and a 90-day plan to check off.",
    bullets: ["Readiness: SAM.gov, NAICS, capability statement, past performance", "Certifications to check, if you qualify", "A 90-day plan saved to your account"],
    href: "/roadmap",
    cta: "Get my Roadmap",
    access: "Free with an account",
    event: "roadmap",
  },
  {
    n: 3,
    name: "Find the bids that fit",
    question: "Which of today's bids are worth my time?",
    what: "Search every open federal, state and local bid in Radar. With a paid plan, Auto-Pilot reads each morning's new bids against your profile. It tells you to pursue, partner or pass, with the reason and what you may need.",
    bullets: ["Radar: open bids by trade and state", "Auto-Pilot: fit, eligibility by set-aside, pursue, partner or pass", "Your strongest fits lead your 6 AM email"],
    href: "/radar",
    cta: "Search open bids",
    access: "Search free; Auto-Pilot with any paid plan",
    event: "radar",
  },
  {
    n: 4,
    name: "Team with the primes",
    question: "Who already holds the contracts, and how do I get on their team?",
    what: "Prime Finder identifies federal contractors in your trade and state, highlighting those required to subcontract to small businesses. See when their contracts expire and send an intro email auto-drafted from your profile.",
    bullets: ["Primes with SBA or GSA subcontracting plans", "When to reach out: 3 to 12 months before a contract ends", "An intro email you send yourself"],
    href: "/prime-finder",
    cta: "Find primes",
    access: "First 3 free; unlimited with Professional",
    event: "prime_finder",
  },
  {
    n: 5,
    name: "Get on a co-op contract",
    question: "How do agencies buy from me without a bid?",
    what: "Purchasing co-ops like Sourcewell, BuyBoard and TIPS run one bid for thousands of member agencies. Win your category, and members can buy from you with a purchase order. See which categories are open for your trade now.",
    bullets: ["Open co-op solicitations for your trade, updated daily", "Which co-ops serve your area, and how each one awards vendors", "What to prepare before your category opens"],
    href: "/co-op-contracts",
    cta: "See open co-op bids",
    access: "Free",
    event: "coop_contracts",
  },
];
