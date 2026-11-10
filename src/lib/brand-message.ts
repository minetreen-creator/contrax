/**
 * The one message Contrax markets around (owner 2026-11-10): "Find the opportunity. Build the team.
 * Get the work." Used on the homepage and in posts; each step points at the tools that do it.
 */
export const BRAND_MESSAGE = "Find the opportunity. Build the team. Get the work.";

export const BRAND_STEPS: readonly { title: string; detail: string; href: string; cta: string }[] = [
  {
    title: "Find the opportunity.",
    detail: "Government bids in your trade and state from federal, state and local buyers, in your inbox every morning.",
    href: "/radar",
    cta: "Search open bids",
  },
  {
    title: "Build the team.",
    detail: "Find certified local subs and collect their quotes, plus crew housing where we have a partner.",
    href: "/sub-finder",
    cta: "Open Sub Finder",
  },
  {
    title: "Get the work.",
    detail: "Max reads the bid with you, Auto-Pilot flags your strongest fits and bid checklists get you to submit.",
    href: "/pathway",
    cta: "See the Pathway",
  },
];
