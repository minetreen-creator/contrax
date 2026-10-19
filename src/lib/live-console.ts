/**
 * Owner console: live activity feed + trial countdown board (owner 2026-10-19:
 * "something flashy, cool and awesome for my admin owner console" → "do 2,3").
 * Pure, client-safe shapes and helpers; the queries live in
 * live-console.server.ts. Every item comes from a tracked row — nothing is
 * modeled or invented.
 */

export type FeedKind = "search" | "signup" | "trial" | "checkout" | "purchase";

export interface FeedItem {
  id: string;
  kind: FeedKind;
  at: string;
  place: string | null;
  title: string;
  detail: string | null;
  money: boolean;
}

export const FEED_EVENTS: Record<string, { kind: FeedKind; title: string }> = {
  signup_success: { kind: "signup", title: "New signup" },
  checkout_started: { kind: "checkout", title: "Opened checkout" },
  bid_scout_checkout_started: { kind: "checkout", title: "Opened Bid Scout checkout" },
  founding_business_checkout_started: { kind: "checkout", title: "Opened Founding Business checkout" },
  subcontracts_checkout_started: { kind: "checkout", title: "Opened subcontracts checkout" },
  bid_scout_purchased: { kind: "purchase", title: "Bought Bid Scout" },
};

export const FEED_EVENT_NAMES = Object.keys(FEED_EVENTS);

/** "Denver, CO" / "Texas" / null from the tracked city and region. */
export function placeLabel(city: string | null | undefined, region: string | null | undefined): string | null {
  const c = String(city ?? "").trim();
  const r = String(region ?? "").trim();
  if (c && r) return `${c}, ${r}`;
  return c || r || null;
}

export function searchFeedText(trade: string, state: string, matched: number): { title: string; detail: string } {
  return {
    title: `Searched ${trade}${state ? ` · ${state}` : ""}`,
    detail: matched === 0 ? "0 matches" : `${matched} match${matched === 1 ? "" : "es"}`,
  };
}

/** Newest first; ties keep their order. */
export function sortFeed(items: FeedItem[]): FeedItem[] {
  return [...items].sort((a, b) => new Date(b.at).getTime() - new Date(a.at).getTime());
}

export type TrialHeat = "hot" | "warm" | "cold";

export interface TrialCard {
  userId: number;
  email: string;
  startedAt: string;
  endsAt: string;
  msLeft: number;
  lastSeen: string | null;
  heat: TrialHeat;
  visits7d: number;
  trade: string | null;
  stateCount: number;
  searches: { trade: string; state: string; matched: number; at: string }[];
}

const HOUR = 3_600_000;

/** Hot: seen in the last day. Warm: in the last 3 days. Cold: older or never. */
export function trialHeat(lastSeen: string | null, now: number): TrialHeat {
  if (!lastSeen) return "cold";
  const ago = now - new Date(lastSeen).getTime();
  if (ago <= 24 * HOUR) return "hot";
  if (ago <= 72 * HOUR) return "warm";
  return "cold";
}

export function trialEnds(startedAt: string, trialDays: number): string {
  return new Date(new Date(startedAt).getTime() + trialDays * 24 * HOUR).toISOString();
}

/** Share of the trial still left, 0..1, for the countdown ring. */
export function trialFractionLeft(msLeft: number, trialDays: number): number {
  return Math.max(0, Math.min(1, msLeft / (trialDays * 24 * HOUR)));
}

export function timeLeftLabel(msLeft: number): string {
  if (msLeft <= 0) return "Ended";
  const hours = Math.floor(msLeft / HOUR);
  if (hours < 24) return `${hours}h left`;
  const days = Math.floor(hours / 24);
  return `${days}d ${hours % 24}h left`;
}

export function agoLabel(at: string | null, now: number): string {
  if (!at) return "never";
  const s = Math.max(0, Math.round((now - new Date(at).getTime()) / 1000));
  if (s < 60) return "just now";
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  return `${Math.floor(s / 86400)}d ago`;
}

/** Ending soonest first, hot before cold at the same time left. */
export function sortTrials(cards: TrialCard[]): TrialCard[] {
  const rank: Record<TrialHeat, number> = { hot: 0, warm: 1, cold: 2 };
  return [...cards].sort((a, b) => a.msLeft - b.msLeft || rank[a.heat] - rank[b.heat]);
}
