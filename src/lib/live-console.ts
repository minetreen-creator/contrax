import type { Lead } from "./hot-leads";
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
  // Plan buy buttons (tracked from 2026-10-19, src/lib/checkout.ts).
  plan_checkout_started: { kind: "checkout", title: "Clicked a plan" },
  plan_checkout_redirected: { kind: "checkout", title: "Opened plan checkout" },
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
  /** The visitor's contrax_vid, for the founder live chat (admin only). */
  vid: string;
  place: string | null;
  /** Two-letter US state for the map dot; null outside the US or when unknown. */
  state: string | null;
  /** The city's spot on /us-states-albers.json (lower 48 only); null falls back to the state's center. */
  point?: [number, number] | null;
  path: string;
  at: string;
  /** Hot Lead Radar score (src/lib/hot-leads.ts). */
  lead?: Lead;
  /** Pinned in the scraper tracker (src/lib/scraper-watch.ts). */
  tracked?: boolean;
}

// The projection /us-states-albers.json was drawn with (us-atlas: d3
// geoAlbersUsa, scale 1300, translate [487.5, 305]), lower 48 only: conic
// equal-area, parallels 29.5° and 45.5°, rotated 96° W, centered on 38.7° N.
const RAD = Math.PI / 180;
const SIN0 = Math.sin(29.5 * RAD);
const CONE_N = (SIN0 + Math.sin(45.5 * RAD)) / 2;
const CONE_C = 1 + SIN0 * (2 * CONE_N - SIN0);
const CONE_R0 = Math.sqrt(CONE_C) / CONE_N;
function conic(lambda: number, phi: number): [number, number] {
  const r = Math.sqrt(CONE_C - 2 * CONE_N * Math.sin(phi)) / CONE_N;
  return [r * Math.sin(lambda * CONE_N), CONE_R0 - r * Math.cos(lambda * CONE_N)];
}
const CENTER = conic(-0.6 * RAD, 38.7 * RAD);

/**
 * A lower-48 coordinate on the map's 975×610 drawing, or null for Alaska,
 * Hawaii, anywhere outside the lower 48's box, or bad input (those dots stay
 * on the state's center).
 */
export function mapPoint(lat: number | null | undefined, lon: number | null | undefined): [number, number] | null {
  if (lat == null || lon == null || !Number.isFinite(lat) || !Number.isFinite(lon)) return null;
  if (lat < 24 || lat > 50 || lon < -125 || lon > -66) return null;
  const [x, y] = conic((lon + 96) * RAD, lat * RAD);
  return [Math.round((487.5 + 1300 * (x - CENTER[0])) * 10) / 10, Math.round((305 - 1300 * (y - CENTER[1])) * 10) / 10];
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

/**
 * Money panel (owner 2026-10-20): the path from a trial to a sale over the
 * last 7 days, counted in unique visitors, plus who pays now. Every step is a
 * tracked event or a users row; nothing is estimated.
 */
export interface MoneyStats {
  payingNow: number;
  /** Unique visitors who opened /pricing or /upgrade. */
  sawPlans: number;
  /** Clicked a plan's buy button. */
  clickedBuy: number;
  /** Reached Stripe checkout. */
  openedCheckout: number;
  /** Clicked buy while signed out and were sent to sign up. */
  signinRequired: number;
  /** Checkout could not be created. */
  failed: number;
  /** "$5 first month" Starter subscriptions (Stripe), or null when Stripe could not be read. */
  firstMonth?: FirstMonthStats | null;
  /** $5 30-day Starter passes (owner 2026-10-30), from the accounts table; null when unreadable. */
  starterPass?: StarterPassStats | null;
}

/** The $5 30-day Starter pass (src/lib/starter-pass.ts). Passes are one-time payments, not Stripe subscriptions. */
export interface StarterPassStats {
  /** Accounts that bought a pass. */
  bought: number;
  /** Pass still running. */
  activeNow: number;
  /** Bought a pass, then subscribed at $19/month. */
  continued: number;
  /** Pass ran out without a subscription (back on free Basic). */
  ended: number;
}

/** The $5 first-month Starter offer, read from Stripe subscription metadata. */
export interface FirstMonthStats {
  /** Subscriptions started on the offer. */
  started: number;
  /** Still active or past due now. */
  payingNow: number;
  /** Older than one billing month and still active: they paid the full $19. */
  pastMonthOne: number;
  canceled: number;
}

/** Days after the start before a subscription counts as past month one. */
export const FIRST_MONTH_DAYS = 32;

/** Counts for the Money panel from Stripe subscriptions (`created` in seconds). */
export function firstMonthStats(subs: readonly { status: string; created: number }[], now: number): FirstMonthStats {
  const paying = (s: string) => s === "active" || s === "past_due";
  return {
    started: subs.filter((s) => s.status !== "incomplete" && s.status !== "incomplete_expired").length,
    payingNow: subs.filter((s) => paying(s.status)).length,
    pastMonthOne: subs.filter((s) => s.status === "active" && now - s.created * 1000 > FIRST_MONTH_DAYS * 24 * HOUR).length,
    canceled: subs.filter((s) => s.status === "canceled").length,
  };
}

/** Trials ending within `days` of `now`, soonest first. */
export function trialsEndingWithin(trials: readonly TrialCard[], days: number, now: number): TrialCard[] {
  const limit = now + days * 24 * HOUR;
  return trials
    .filter((t) => {
      const end = new Date(t.endsAt).getTime();
      return end > now && end <= limit;
    })
    .sort((a, b) => new Date(a.endsAt).getTime() - new Date(b.endsAt).getTime());
}

/** The money panel's steps, in order. */
export function moneySteps(m: MoneyStats): { label: string; value: number }[] {
  return [
    { label: "Saw the plans", value: m.sawPlans },
    { label: "Clicked buy", value: m.clickedBuy },
    { label: "Opened checkout", value: m.openedCheckout },
  ];
}

/**
 * Stripe checkouts actually paid (owner 2026-10-31: "it says I have 5 money
 * moments but nobody has paid"). Counts paid sessions only, minus admin and
 * @test.contrax buyers. PURE.
 */
export function paidCheckoutCount(
  sessions: readonly { payment_status?: string | null; customer_details?: { email?: string | null } | null }[],
  isAdmin: (email: string) => boolean,
): number {
  return sessions.filter((s) => {
    if (s.payment_status !== "paid") return false;
    const email = String(s.customer_details?.email ?? "").trim().toLowerCase();
    if (email && (isAdmin(email) || email.endsWith("@test.contrax"))) return false;
    return true;
  }).length;
}
