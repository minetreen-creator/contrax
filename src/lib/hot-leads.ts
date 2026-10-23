/**
 * Mission Control: Hot Lead Radar and Voice Announcer (owner 2026-10-23:
 * "do 2,3"). PURE: lead scoring for visitors on the site now, plain-English
 * page names, and the lines the announcer speaks.
 */
import type { FeedItem } from "./live-console";

export type LeadLevel = "hot" | "warm" | "cold";

export interface LeadSignals {
  /** The page the visitor is on now. */
  currentPath: string;
  /** Distinct paths this visitor viewed in the last 60 minutes. */
  pathsHour: string[];
  /** Page views in the last 60 minutes. */
  viewsHour: number;
  /** Distinct days with a visit in the last 30 days (1 = first day). */
  visitDays: number;
  /** Has a Contrax account. */
  signedIn: boolean;
}

export interface Lead {
  score: number;
  level: LeadLevel;
  reasons: string[];
}

export const HOT_SCORE = 60;
export const WARM_SCORE = 30;

const BUY_PAGE = /^\/(pricing|upgrade|signup|post-checkout)(\/|$)/;
const SCOUT_PAGE = /^\/bid-scout(\/|$)|^\/bid-fit-review(\/|$)/;
const PRODUCT_PAGE = /^\/(radar|bid\/|town\/|contracts-in\/|bids-in\/|data(\/|$))/;

/** Score how close a visitor on the site right now is to buying. */
export function scoreLead(s: LeadSignals): Lead {
  const reasons: string[] = [];
  let score = 0;
  const visited = (re: RegExp) => s.pathsHour.some((p) => re.test(p));
  if (BUY_PAGE.test(s.currentPath)) {
    score += 40;
    reasons.push(`on ${pageName(s.currentPath)} now`);
  } else if (visited(BUY_PAGE)) {
    score += 25;
    reasons.push("looked at pricing");
  }
  if (visited(SCOUT_PAGE)) {
    score += 25;
    reasons.push("read Bid Scout");
  }
  if (s.visitDays >= 2) {
    score += Math.min(30, 10 * s.visitDays);
    reasons.push(`${ordinal(s.visitDays)} day visiting`);
  }
  if (s.viewsHour >= 5) {
    score += 15;
    reasons.push(`${s.viewsHour} pages this hour`);
  }
  if (visited(PRODUCT_PAGE)) {
    score += 10;
    reasons.push("searching bids");
  }
  if (s.signedIn) {
    score += 10;
    reasons.push("has an account");
  }
  score = Math.min(100, score);
  const level: LeadLevel = score >= HOT_SCORE ? "hot" : score >= WARM_SCORE ? "warm" : "cold";
  return { score, level, reasons };
}

function ordinal(n: number): string {
  const s = n % 100 >= 11 && n % 100 <= 13 ? "th" : n % 10 === 1 ? "st" : n % 10 === 2 ? "nd" : n % 10 === 3 ? "rd" : "th";
  return `${n}${s}`;
}

const STATE_NAMES: Record<string, string> = {
  al: "Alabama", ak: "Alaska", az: "Arizona", ar: "Arkansas", ca: "California", co: "Colorado", ct: "Connecticut", de: "Delaware", dc: "D.C.", fl: "Florida", ga: "Georgia", hi: "Hawaii", id: "Idaho", il: "Illinois", in: "Indiana", ia: "Iowa", ks: "Kansas", ky: "Kentucky", la: "Louisiana", me: "Maine", md: "Maryland", ma: "Massachusetts", mi: "Michigan", mn: "Minnesota", ms: "Mississippi", mo: "Missouri", mt: "Montana", ne: "Nebraska", nv: "Nevada", nh: "New Hampshire", nj: "New Jersey", nm: "New Mexico", ny: "New York", nc: "North Carolina", nd: "North Dakota", oh: "Ohio", ok: "Oklahoma", or: "Oregon", pa: "Pennsylvania", ri: "Rhode Island", sc: "South Carolina", sd: "South Dakota", tn: "Tennessee", tx: "Texas", ut: "Utah", vt: "Vermont", va: "Virginia", wa: "Washington", wv: "West Virginia", wi: "Wisconsin", wy: "Wyoming",
};

const words = (slug: string) => decodeURIComponent(slug).replace(/[-_]+/g, " ").trim();

/** A page path in words: "/pricing" → "the pricing page". */
export function pageName(path: string): string {
  const p = (path.split("?")[0] || "/").toLowerCase();
  const seg = p.split("/").filter(Boolean);
  if (seg.length === 0) return "the homepage";
  switch (seg[0]) {
    case "pricing":
      return "the pricing page";
    case "upgrade":
      return "the upgrade page";
    case "signup":
      return "the signup page";
    case "bid-scout":
      return "Bid Scout";
    case "radar":
      return "Contract Radar";
    case "bid":
      return "a bid";
    case "town":
      return "What's Your Town Buying";
    case "learn":
      return seg[1] ? "a free course" : "the free courses";
    case "launchpad":
      return "Launchpad";
    case "grants":
      return "grants";
    case "data":
      return "the data API page";
    case "blog":
      return "the blog";
    case "contracts-in": {
      const state = STATE_NAMES[seg[1] ?? ""] ?? (seg[1] ? words(seg[1]) : "a state");
      return seg[2] ? `${words(seg[2])} bids in ${state}` : `bids in ${state}`;
    }
    case "bids-in":
      return seg[2] ? `bids in ${words(seg[2])}` : "local bids";
    default:
      return words(seg[0]);
  }
}

/** What the announcer says for a new feed event. */
export function feedLine(f: Pick<FeedItem, "kind" | "place" | "title" | "detail">): string {
  const where = f.place ? ` from ${f.place}` : "";
  switch (f.kind) {
    case "purchase":
      return `Sale! ${f.title}${where}.`;
    case "checkout":
      return `Someone${where} just opened checkout.`;
    case "signup":
      return `New signup${where}!`;
    case "trial":
      return "A new trial just started.";
    case "search":
      return `New search${where}${f.title ? `: ${f.title}` : ""}.`;
  }
}

/** What the announcer says when a new visitor arrives. */
export function visitorLine(place: string | null, path: string): string {
  return `New visitor${place ? ` from ${place}` : ""}, on ${pageName(path)}.`;
}

/** What the announcer says when a visitor turns hot. */
export function hotLine(place: string | null, path: string): string {
  return `Hot lead${place ? ` in ${place}` : ""}, on ${pageName(path)}. Now's a good time to say hi.`;
}

/** Spot on the radar: angle from the visitor id (stable), distance from score (hotter = closer). */
export function radarSpot(vid: string, score: number): { x: number; y: number } {
  let h = 0;
  for (let i = 0; i < vid.length; i++) h = (h * 31 + vid.charCodeAt(i)) >>> 0;
  const angle = ((h % 360) * Math.PI) / 180;
  const r = 0.15 + 0.8 * (1 - Math.min(100, Math.max(0, score)) / 100);
  return { x: Math.round((50 + 46 * r * Math.cos(angle)) * 10) / 10, y: Math.round((50 + 46 * r * Math.sin(angle)) * 10) / 10 };
}

export type AnnounceTone = "money" | "hot" | "blip";
export interface Announcement {
  text: string;
  tone: AnnounceTone;
  /** The visitor a hot-lead line is about (Red Alert's "Say hi"). */
  vid?: string;
}

/** Red Alert Mode: a sale, a checkout, or a visitor who just turned hot. */
export function isRedAlert(a: Announcement): boolean {
  return a.tone === "money" || a.tone === "hot";
}
export interface AnnounceState {
  feedIds: Set<string>;
  vids: Set<string>;
  hotVids: Set<string>;
}

/** Most lines spoken per poll; the rest are summed up in one line. */
export const MAX_LINES_PER_POLL = 4;

interface AnnounceVisitor {
  vid: string;
  place: string | null;
  path: string;
  lead?: Lead;
}

/**
 * What changed since the last poll, as lines to speak: money first, then hot
 * leads, then signups/searches, then new visitors. Nothing on the first poll
 * (prev null), so opening the page doesn't read out the last 48 hours.
 */
export function announcements(
  prev: AnnounceState | null,
  feed: Pick<FeedItem, "id" | "kind" | "place" | "title" | "detail" | "money">[],
  online: AnnounceVisitor[],
): { lines: Announcement[]; state: AnnounceState } {
  const state: AnnounceState = {
    feedIds: new Set(feed.map((f) => f.id)),
    vids: new Set(online.map((v) => v.vid)),
    hotVids: new Set(online.filter((v) => v.lead?.level === "hot").map((v) => v.vid)),
  };
  if (!prev) return { lines: [], state };
  const newFeed = feed.filter((f) => !prev.feedIds.has(f.id));
  const money = newFeed.filter((f) => f.money).map((f) => ({ text: feedLine(f), tone: "money" as const }));
  const hot = online
    .filter((v) => v.lead?.level === "hot" && !prev.hotVids.has(v.vid))
    .map((v) => ({ text: hotLine(v.place, v.path), tone: "hot" as const, vid: v.vid }));
  const other = newFeed.filter((f) => !f.money).map((f) => ({ text: feedLine(f), tone: "blip" as const }));
  const arrivals = online
    .filter((v) => !prev.vids.has(v.vid) && !(v.lead?.level === "hot" && !prev.hotVids.has(v.vid)))
    .map((v) => ({ text: visitorLine(v.place, v.path), tone: "blip" as const }));
  const all = [...money, ...hot, ...other, ...arrivals];
  if (all.length <= MAX_LINES_PER_POLL) return { lines: all, state };
  const kept = all.slice(0, MAX_LINES_PER_POLL - 1);
  const rest = all.length - kept.length;
  return { lines: [...kept, { text: `And ${rest} more updates.`, tone: "blip" }], state };
}
