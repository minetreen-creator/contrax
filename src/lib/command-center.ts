/**
 * Command Center (owner 2026-11-05: "I need an admin dashboard like this!",
 * with a screenshot of a "command center" home: greeting, Needs your
 * attention, a message box for the assistant, live operations tiles and a
 * sidebar). Contrax's own version, fed only by real data.
 *
 * PURE: greeting, the attention list and the operations tiles.
 */

export const ET = "America/New_York";

/** "Good morning" before noon, "Good afternoon" before 6 PM, else "Good evening" (Eastern). PURE. */
export function greeting(now: Date): string {
  const hour = Number(new Intl.DateTimeFormat("en-US", { timeZone: ET, hour: "numeric", hourCycle: "h23" }).format(now));
  return hour < 12 ? "Good morning" : hour < 18 ? "Good afternoon" : "Good evening";
}

export interface CommandCounts {
  outreachDrafts: number;
  outreachSentToday: number;
  storiesPending: number;
  dataFeedRequestsNew: number;
  bidFitReviewsOpen: number;
  nonprofitReviews: number;
  passesEndingSoon: number;
  failingSources: { source: string; cause: string }[];
  sourcesSyncedToday: number;
  newBidsToday: number;
  openBids: number;
  lastSyncAt: string | null;
  federalFiguresFailing: number;
  federalFiguresLastAt: string | null;
}

export interface AttentionItem {
  key: string;
  label: string;
  detail: string;
  href: string;
  /** "money" items come first, then "approve", then "fix". */
  kind: "money" | "approve" | "fix";
}

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

/** What is waiting on the owner, most valuable first. Nothing invented: zero counts are left out. PURE. */
export function attentionItems(c: CommandCounts): AttentionItem[] {
  const items: AttentionItem[] = [];
  if (c.dataFeedRequestsNew > 0)
    items.push({ key: "data-feed", kind: "money", label: `${plural(c.dataFeedRequestsNew, "data feed request")}`, detail: "A business asked for the $299–$799/mo bid data feed. Reply the same day.", href: "/admin/data-access" });
  if (c.bidFitReviewsOpen > 0)
    items.push({ key: "bid-fit", kind: "money", label: `${plural(c.bidFitReviewsOpen, "bid fit review")} to answer`, detail: "Paid or requested reviews waiting on you.", href: "/admin/bid-fit-reviews" });
  if (c.passesEndingSoon > 0)
    items.push({ key: "passes", kind: "money", label: `${plural(c.passesEndingSoon, "$5 pass", "$5 passes")} ending within 5 days`, detail: "A personal note before the pass ends is the best shot at a $19/month customer.", href: "/admin/customers" });
  if (c.outreachDrafts > 0)
    items.push({ key: "outreach", kind: "approve", label: `${plural(c.outreachDrafts, "outreach draft")} to approve`, detail: `${c.outreachSentToday} sent today. Nothing goes out until you approve it.`, href: "/admin/outreach" });
  if (c.storiesPending > 0)
    items.push({ key: "stories", kind: "approve", label: `${plural(c.storiesPending, "success story", "success stories")} to review`, detail: "Approve to publish, named the way the customer chose.", href: "/admin/stories" });
  if (c.nonprofitReviews > 0)
    items.push({ key: "nonprofits", kind: "approve", label: `${plural(c.nonprofitReviews, "nonprofit application")} to review`, detail: "Manual review, 3-business-day promise.", href: "/admin/nonprofits" });
  if (c.failingSources.length > 0)
    items.push({ key: "sources", kind: "fix", label: `${plural(c.failingSources.length, "bid source")} failing`, detail: c.failingSources.slice(0, 3).map((f) => `${f.source}: ${f.cause}`).join(" · "), href: "/admin/live" });
  if (c.federalFiguresFailing > 0)
    items.push({ key: "federal", kind: "fix", label: `${plural(c.federalFiguresFailing, "county", "counties")} not refreshing federal figures`, detail: "USAspending is retried every hour.", href: "/admin" });
  const order = { money: 0, approve: 1, fix: 2 } as const;
  return items.sort((a, b) => order[a.kind] - order[b.kind]);
}

export interface OperationRow {
  name: string;
  status: "working" | "waiting" | "needs-approval" | "problem";
  summary: string;
  lastAt: string | null;
}

const HOUR = 3_600_000;

/** The automated jobs, from what they left in the database. PURE. */
export function operations(c: CommandCounts, now: Date): OperationRow[] {
  const ago = (iso: string | null) => (iso ? now.getTime() - new Date(iso).getTime() : Infinity);
  const rows: OperationRow[] = [
    {
      name: "Bid sync",
      status: c.failingSources.length > 0 && ago(c.lastSyncAt) < 6 * HOUR ? "problem" : ago(c.lastSyncAt) < 6 * HOUR ? "working" : "waiting",
      summary: `${c.openBids.toLocaleString("en-US")} open bids · ${c.newBidsToday.toLocaleString("en-US")} new today · ${c.sourcesSyncedToday} sources read today${c.failingSources.length ? ` · ${c.failingSources.length} failing` : ""}`,
      lastAt: c.lastSyncAt,
    },
    {
      name: "Outreach",
      status: c.outreachDrafts > 0 ? "needs-approval" : "waiting",
      summary: `${c.outreachDrafts} drafts waiting · ${c.outreachSentToday} sent today · cap 90 a day`,
      lastAt: null,
    },
    {
      name: "Federal award figures",
      status: c.federalFiguresFailing > 0 ? "problem" : ago(c.federalFiguresLastAt) < 26 * HOUR ? "working" : "waiting",
      summary: c.federalFiguresFailing > 0 ? `${c.federalFiguresFailing} counties failing, retried hourly` : "Counties refresh every hour from USAspending",
      lastAt: c.federalFiguresLastAt,
    },
    {
      name: "Reviews & stories",
      status: c.storiesPending + c.nonprofitReviews + c.bidFitReviewsOpen > 0 ? "needs-approval" : "waiting",
      summary: `${c.storiesPending} stories · ${c.nonprofitReviews} nonprofit · ${c.bidFitReviewsOpen} bid fit`,
      lastAt: null,
    },
  ];
  return rows;
}

/** The four tiles: counts of operations by status. PURE. */
export function tiles(rows: readonly OperationRow[]): { working: number; waiting: number; needsApproval: number; problems: number } {
  return {
    working: rows.filter((r) => r.status === "working").length,
    waiting: rows.filter((r) => r.status === "waiting").length,
    needsApproval: rows.filter((r) => r.status === "needs-approval").length,
    problems: rows.filter((r) => r.status === "problem").length,
  };
}

/** Quick Capture notes: one line, trimmed, 1–500 characters. PURE. */
export function cleanNote(raw: unknown): string | null {
  const s = typeof raw === "string" ? raw.replace(/\s+/g, " ").trim() : "";
  return s.length >= 1 && s.length <= 500 ? s : null;
}
