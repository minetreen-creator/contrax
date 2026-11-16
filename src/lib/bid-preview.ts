/**
 * Homepage bid preview (owner 2026-11-16, from a pasted layout: trade tabs, "what the agency
 * posts" beside "what Contrax gives you", then a state picker). The pasted sample content was
 * invented (a made-up awardee, price and match score); this widget shows none of that. Each tab is
 * a REAL open bid: the left side is the opening of the agency's own notice as Contrax stores it,
 * the right side is the brief Contrax already generated for that bid, and every requirement, date
 * and warning on it carries the words from the notice it came from. A trade with no bid that
 * passes the example rules (open, complete, consistent dates, brief still matches the notice) has
 * no tab, and with no tabs the widget is not drawn. PURE, browser-safe.
 */
import type { RfpSummary } from "~/components/RfpSummaryCard";

/** The tabs, in order. The first with a bid is selected. */
export const PREVIEW_TRADES = ["janitorial", "construction", "hvac", "landscaping", "security-guard"] as const;
export type PreviewTrade = (typeof PREVIEW_TRADES)[number];
export const PREVIEW_TAB_LABEL: Record<PreviewTrade, string> = {
  janitorial: "Janitorial", construction: "Construction", hvac: "HVAC", landscaping: "Landscaping", "security-guard": "Security",
};
/** Lower-case words for the sentence under the widget. */
export const PREVIEW_TRADE_WORDS: Record<PreviewTrade, string> = {
  janitorial: "janitorial", construction: "construction", hvac: "HVAC and plumbing", landscaping: "landscaping", "security-guard": "security guard",
};

/** A notice shorter than this is not a wall of text and proves nothing. */
export const PREVIEW_MIN_NOTICE_CHARS = 500;
/** How much of the notice the left side shows. */
export const PREVIEW_EXCERPT_CHARS = 900;
/** Bids closing sooner than this are skipped, so a tab does not show a job nobody can still bid. */
export const PREVIEW_MIN_DAYS_LEFT = 3;
export const PREVIEW_MAX_ITEMS = 4;

export interface BidPreview {
  trade: PreviewTrade;
  id: number;
  title: string;
  agency: string | null;
  location: string | null;
  /** YYYY-MM-DD */
  due: string;
  notice: string;
  noticeChars: number;
  noticeWords: number;
  summary: RfpSummary;
}

/** The opening of the notice, cut at a sentence end when one falls in the last third. Words unchanged. PURE. */
export function previewExcerpt(text: string, max: number = PREVIEW_EXCERPT_CHARS): string {
  const clean = String(text ?? "").replace(/\s+/g, " ").trim();
  if (clean.length <= max) return clean;
  const cut = clean.slice(0, max);
  const end = Math.max(cut.lastIndexOf(". "), cut.lastIndexOf("; "));
  return end > max * 0.66 ? cut.slice(0, end + 1) : `${cut.slice(0, cut.lastIndexOf(" "))}…`;
}

export const wordCount = (text: string): number => String(text ?? "").split(/\s+/).filter(Boolean).length;

/** Where the state picker sends a visitor: the open bids for that trade in that state. PURE. */
export function previewStateHref(stateName: string, trade: PreviewTrade): string {
  return `/contracts-in/${stateName.toLowerCase().replace(/\s+/g, "-")}/${trade}?source=home_bid_preview`;
}

/** "Dec 4, 2026" from YYYY-MM-DD or an ISO date; the text itself when it is not a date. PURE. */
export function previewDay(v: string | null | undefined): string {
  const s = String(v ?? "").trim();
  const m = /^(\d{4}-\d{2}-\d{2})/.exec(s);
  if (!m) return s;
  return new Date(`${m[1]}T12:00:00Z`).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" });
}
