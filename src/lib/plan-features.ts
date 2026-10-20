/**
 * Plan descriptions and feature lists, shared by /pricing and /upgrade so the
 * two pages always say the same thing (owner 2026-10-19: /upgrade showed only
 * names and prices, so people reached it from an upgrade link with no reason
 * to pay).
 */
export interface PlanCopy {
  description: string;
  features: readonly string[];
}

export const PLAN_COPY = {
  basic: {
    description: "Where your account lands after the 7-day trial if you don't choose a plan: search only.",
    features: [
      "Search every open solicitation (new bids after a 7-day head start)",
      "2 Radar searches per account",
      "Bid matches for 1 state and 1 trade",
      "1 Saved Bid",
      "Standard Set-Aside Filters",
      "No bid emails",
    ],
  },
  starter: {
    description: "The new bids in your trade and states, in your inbox each morning, 7 days before free accounts see them.",
    features: [
      "Everything in Basic",
      "New bids the day they post, 7 days before free accounts",
      "A 6 AM email of new bids in your trade and states",
      "Bid matches for every state and trade you work in",
      "Unlimited Saved Bids",
      "Who to contact on federal bids: the contracting officer's name, email and phone",
      '"What did the winner bid last time?"',
      "Your saved bids' deadlines in Google Calendar or Outlook",
      "CRM: save contacts (up to 100) with notes, next actions and manual follow-up dates, and link them to your saved bids",
      "Or $190 a year: 2 months free",
      "Cancel anytime",
    ],
  },
  professional: {
    description: "For growing businesses that win more with full RFP intelligence — 50 AI Executive Briefs a month, incumbent pricing, and AI match scoring.",
    features: [
      "Everything in Starter",
      "Contracts Ending Soon: full access to contract holders, agencies, values and end dates — prepare before the next bid is posted",
      "50 AI Executive Briefs a month — requirements, milestones & red flags",
      "Full Incumbent Intelligence & Past Pricing",
      "AI Match Scoring",
      "CRM: 1,000 contacts, full relationship history (notes, calls, meetings, emails), and email reminders for your follow-up dates — opt-in, one email per follow-up date",
      "AI follow-up drafts written from a contact's notes and history — drafts only, never auto-sent",
      "Or $790 a year: 2 months free",
    ],
  },
  agency: {
    description: "For teams and consultants.",
    features: ["Everything in Professional"],
  },
} as const satisfies Record<string, PlanCopy>;

/** The yearly-price line is shown by /upgrade's own Monthly/Yearly switch. */
export function upgradeFeatures(features: readonly string[]): string[] {
  return features.filter((f) => !/^Or \$[\d,]+ a year/.test(f));
}
