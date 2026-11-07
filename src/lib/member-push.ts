/**
 * Contrax app notifications for members (owner 2026-11-07: "yes build the
 * app"; the app is open to everyone, the phone notifications are for paid
 * plans). PURE: what the lock screen says, where a tap goes, and when we are
 * allowed to buzz someone. Storage and sending live in member-push.server.ts.
 */

export interface PushPayload {
  title: string;
  body: string;
  tag: string;
  url: string;
}

const clip = (s: string, n: number) => (s.length > n ? `${s.slice(0, n - 1).trimEnd()}…` : s);

/** One buzz for a batch of new matching bids. PURE. */
export function newMatchesPush(bids: { id: number; title: string; agency: string }[], label: string): PushPayload | null {
  if (!bids.length) return null;
  const first = bids[0];
  const what = label ? ` for ${clip(label, 40)}` : "";
  const title = bids.length === 1 ? `🔔 New bid${what}` : `🔔 ${bids.length} new bids${what}`;
  const lead = clip(first.title || "New bid", 90);
  const body = bids.length === 1
    ? `${lead}${first.agency ? ` · ${clip(first.agency, 50)}` : ""}`
    : `${lead} and ${bids.length - 1} more`;
  return {
    title,
    body,
    tag: `matches-${first.id}`,
    url: bids.length === 1 ? `/bid/${first.id}` : "/app?view=new",
  };
}

/** A saved bid is due soon. PURE. */
export function dueSoonPush(bid: { id: number; title: string; dueIso: string }, now: number = Date.now()): PushPayload {
  const hours = Math.max(0, (Date.parse(bid.dueIso) - now) / 3_600_000);
  const when = hours < 30 ? "tomorrow" : `in ${Math.round(hours / 24)} days`;
  return {
    title: `⏰ Saved bid due ${when}`,
    body: clip(bid.title || "Your saved bid", 120),
    tag: `due-${bid.id}`,
    url: `/bid/${bid.id}`,
  };
}

/**
 * No buzzing at night. Sync runs around the clock, so matches found between
 * 9 PM and 7 AM Eastern wait for the first run after 7 AM (they stay unsent
 * in the log, so nothing is lost). PURE.
 */
export function inSendingHours(now: Date = new Date()): boolean {
  const hour = Number(new Intl.DateTimeFormat("en-US", { timeZone: "America/New_York", hour: "numeric", hourCycle: "h23" }).format(now));
  return hour >= 7 && hour < 21;
}
