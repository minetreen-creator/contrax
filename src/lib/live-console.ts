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

/** Live search map: searches per searched state (the map draws /us-states-albers.json). */
export interface StateSearchStat {
  state: string;
  searches: number;
  zero: number;
  lastAt: string;
}

export type MapTone = "none" | "found" | "mixed" | "empty";

/** Green: every search found bids. Red: none did. Amber: some did. */
export function mapTone(stat: StateSearchStat | undefined): MapTone {
  if (!stat || stat.searches === 0) return "none";
  if (stat.zero === 0) return "found";
  if (stat.zero >= stat.searches) return "empty";
  return "mixed";
}

/** A state searched in the last 15 minutes pulses. */
export function isRecentSearch(stat: StateSearchStat | undefined, now: number): boolean {
  return !!stat && now - new Date(stat.lastAt).getTime() <= 15 * 60_000;
}

export interface OnlineVisitor {
  visitorKey: string;
  place: string | null;
  /** Two-letter US state for the map dot; null outside the US or when unknown. */
  state: string | null;
  path: string;
  at: string;
}

export const US_STATE_CODES: ReadonlySet<string> = new Set([
  "AL", "AK", "AZ", "AR", "CA", "CO", "CT", "DE", "DC", "FL", "GA", "HI", "ID", "IL", "IN", "IA", "KS", "KY",
  "LA", "ME", "MD", "MA", "MI", "MN", "MS", "MO", "MT", "NE", "NV", "NH", "NJ", "NM", "NY", "NC", "ND", "OH",
  "OK", "OR", "PA", "RI", "SC", "SD", "TN", "TX", "UT", "VT", "VA", "WA", "WV", "WI", "WY",
]);

/** The visitor's US state from the tracked region code, only when the country is the US. */
export function visitorState(region: string | null | undefined, country: string | null | undefined): string | null {
  const code = String(region ?? "").trim().toUpperCase();
  if (String(country ?? "").trim().toUpperCase() !== "US") return null;
  return US_STATE_CODES.has(code) ? code : null;
}

/**
 * Where the i-th visitor dot in a state sits: a sunflower spiral around the
 * state's label point, so several visitors in one state don't stack.
 */
export function dotOffset(i: number): [number, number] {
  if (i === 0) return [0, 0];
  const angle = i * 2.39996; // golden angle, radians
  const r = 11 * Math.sqrt(i);
  return [Math.round(r * Math.cos(angle) * 10) / 10, Math.round(r * Math.sin(angle) * 10) / 10];
}
