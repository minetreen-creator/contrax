import { clip, tidyCaps } from "~/lib/supplier-report";
import type { Recompete } from "~/lib/federal-trade-data";

/**
 * The one contract shown at the top of /recompetes (owner 2026-11-27, "do it"): a real federal
 * contract with its job, agency, value and end date, and the holder hidden until the visitor has an
 * account. PURE. The holder's name, the award number and the link to the federal record never leave
 * the server for a visitor without an account (any of the three would name the holder).
 */
export type FeaturedEnding = {
  title: string;
  agency: string | null;
  amount: number;
  end_date: string;
  /** null = hidden. */
  holder: string | null;
  award_key: string | null;
  award_id: string | null;
};

export const FEATURED_MIN_AMOUNT = 100_000;
export const FEATURED_LEAD = "Another company holds this contract today. It has an end date.";
export const FEATURED_HIDDEN_LABEL = "Hidden";
export const FEATURED_CTA = "Create a free account to see who holds it";
export const FEATURED_PRIVATE_NOTE = "Contrax is a private company, not a government agency. Source: USAspending.gov.";

/** The largest candidate that is not already listed, by name, in the rows below. */
export function pickFeatured(candidates: Recompete[], shownKeys: string[]): Recompete | null {
  const shown = new Set(shownKeys);
  return candidates.find((c) => !shown.has(c.award_key) && Number(c.amount) >= FEATURED_MIN_AMOUNT && !!c.end_date) ?? null;
}

/** What the page receives. `reveal` is true only for a signed-in viewer. */
export function featuredEnding(c: Recompete | null, reveal: boolean, tradeLabel: string): FeaturedEnding | null {
  if (!c) return null;
  const generic = `${tradeLabel} contract`;
  let title = clip(tidyCaps(String(c.description ?? "")), 110) || generic;
  // A description that names the holder would undo the hiding.
  const holder = String(c.recipient_name ?? "").trim();
  const firstWord = holder.split(/\s+/)[0]?.toLowerCase() ?? "";
  if (!reveal && firstWord.length >= 4 && title.toLowerCase().includes(firstWord)) title = generic;
  return {
    title,
    agency: c.sub_agency || c.agency || null,
    amount: Number(c.amount),
    end_date: c.end_date,
    holder: reveal ? holder || null : null,
    award_key: reveal ? c.award_key : null,
    award_id: reveal ? c.award_id : null,
  };
}
