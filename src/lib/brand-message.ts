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
    // Owner 2026-11-10: no brand names here ("Max", "Auto-Pilot", "the Pathway" meant nothing to a busy contractor).
    detail: "Our AI assistant explains the bid in plain English, flags your strongest fits, and builds a checklist so you don't miss a requirement.",
    href: "/pathway",
    cta: "See how to win bids",
  },
];
