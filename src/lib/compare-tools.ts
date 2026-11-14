/**
 * Comparison pages against the self-serve tools (owner 2026-11-14, competitor review idea 3:
 * "alternatives to X" pages are how buyers who are already shopping find a vendor). Every fact
 * about another company here is taken from that company's own public page, named in `source`,
 * on the date in CHECKED. Nothing is claimed about a competitor that its own page does not say,
 * and each page says plainly when the other tool is the better buy. PURE data.
 */
import { REPORT_PRICE } from "~/lib/pipeline-report";

export const CHECKED = "November 14, 2026";

export interface CompareTool {
  slug: string;
  name: string;
  /** What it is, in one line, in neutral words. */
  what: string;
  /** Facts from the company's own page. */
  facts: { label: string; value: string }[];
  source: { label: string; url: string };
  /** When that tool is the better choice. */
  betterWhen: string;
}

export const COMPARE_TOOLS: readonly CompareTool[] = [
  {
    slug: "highergov",
    name: "HigherGov",
    what: "A self-serve platform for searching government opportunities and market data.",
    facts: [
      { label: "Entry price", value: "Starter plan, $500 a year, 1 user" },
      { label: "Starter plan covers", value: "Market intelligence, federal opportunities and forecasts, and state and local opportunities" },
    ],
    source: { label: "HigherGov plans and pricing", url: "https://highergov.com/pricing/" },
    betterWhen: "you have someone who will log in every week and run the searches. For data alone, it costs less than we do.",
  },
  {
    slug: "govtribe",
    name: "GovTribe",
    what: "A federal market intelligence platform priced per seat.",
    facts: [
      { label: "Price per seat", value: "$1,900 a year for one seat, down to $1,200 at six or more" },
      { label: "GovTribe Pro", value: "$2,100 a year per seat, down to $1,400" },
      { label: "Trial", value: "7 days, no credit card" },
    ],
    source: { label: "GovTribe vs. HigherGov, by GovTribe", url: "https://govtribe.com/compare/govtribe-vs-highergov" },
    betterWhen: "you run a capture team that needs several people working one shared pipeline every day.",
  },
  {
    slug: "cleatus",
    name: "CLEATUS",
    what: "An AI platform that matches contracts, breaks down solicitations and drafts proposals.",
    facts: [
      { label: "Self-serve price", value: "$78 a month on annual plans for its data and AI plan" },
      { label: "Trial", value: "7 days free" },
      { label: "Built around", value: "Daily AI contract matching, automatic contract breakdown and an AI proposal writer" },
    ],
    source: { label: "CLEATUS comparison page", url: "https://www.cleat.ai/alternative/procurement-sciences" },
    betterWhen: "your main need is writing proposals faster and you want to do that work in software yourself.",
  },
];

export const COMPARE_BY_SLUG: Readonly<Record<string, CompareTool>> = Object.fromEntries(COMPARE_TOOLS.map((t) => [t.slug, t]));

/** What Contrax offers beside any of them. The prices are the site's own. */
export const CONTRAX_SIDE: { label: string; value: string }[] = [
  { label: "Do it yourself", value: "Search open bids in your trade and state; start for $5" },
  { label: "One report, prepared for you", value: `Pipeline Snapshot, ${REPORT_PRICE} once, in your inbox within 1 business day` },
  { label: "Every month, prepared for you", value: "Contrax Managed, $499 a month, month to month" },
  { label: "Who does the work", value: "We do. You read one report" },
];

export const compareTitle = (t: CompareTool) => `${t.name} Alternative: Have Your Government Contract Research Done for You | Contrax`;
export const compareDescription = (t: CompareTool) =>
  `${t.name} is a tool you run yourself. Contrax prepares the report for you: the contracts ending in your trade and state, who holds them, and the open bids that fit. See how they differ.`;
