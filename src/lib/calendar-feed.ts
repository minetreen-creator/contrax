/**
 * SAVED-BID CALENDAR FEED (owner 2026-10-02, Starter value #5): a private
 * iCalendar (.ics) URL a paying member subscribes to in Google Calendar,
 * Outlook or Apple Calendar. It lists the response deadline of every bid they
 * have saved, with reminders 2 days and 1 day before.
 *
 * The URL carries a random per-user token (calendar apps fetch feeds without
 * the member's login cookie). The token is stored in `calendar_feeds` and can
 * be reset from Settings, which kills the old URL.
 *
 * ENTITLEMENT: Starter and up (the same paid rule as the head start,
 * hasPaidBidAccess). A token is only ever issued to a paid member; when a
 * member stops paying, their existing URL keeps answering with a valid but
 * EMPTY calendar (so the subscription in their calendar app does not error)
 * and the deadlines disappear.
 *
 * Only the member's own saved bids are listed; nothing is fabricated: a bid
 * without a due date is left out.
 *
 * PURE helpers here (no DB): ics text building and escaping, unit-tested in
 * calendar-feed.test.ts. The route is src/routes/api/calendar-feed.ts.
 */
import { isCountdownSuppressed } from "~/lib/deadline-label";

export const CALENDAR_FEED_PATH = "/api/calendar-feed";
const SITE = "https://www.contrax.company";

export interface CalendarBid {
  bidId: number;
  title: string;
  agency: string | null;
  dueDate: string | Date;
  solicitationNumber?: string | null;
  /**
   * Provenance label (`bids.source`). A source whose published due-date time zone
   * is not settled (eVA + the four Virginia locality boards) gets NO reminder
   * alarms: `TRIGGER:-P2D` / `-P1D` are derived countdowns off a close instant
   * that may be up to 4-5h off (`~/lib/deadline-label`). NULL/unknown ⇒ unchanged.
   */
  source?: string | null;
}

/** The feed URL for a token. */
export function calendarFeedUrl(token: string): string {
  return `${SITE}${CALENDAR_FEED_PATH}?token=${encodeURIComponent(token)}`;
}

/** A new random feed token (32 hex chars). */
export function newCalendarToken(): string {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  return [...bytes].map((b) => b.toString(16).padStart(2, "0")).join("");
}

/** True for a well-formed token (so junk never reaches the database). */
export function isCalendarToken(value: unknown): value is string {
  return typeof value === "string" && /^[0-9a-f]{32}$/.test(value);
}

/** RFC 5545 TEXT escaping: backslash, semicolon, comma, newline. */
export function icsEscape(text: string): string {
  return text
    .replace(/\\/g, "\\\\")
    .replace(/;/g, "\\;")
    .replace(/,/g, "\\,")
    .replace(/\r?\n/g, "\\n");
}

/** RFC 5545 line folding: lines longer than 75 octets continue with a leading space. */
export function icsFold(line: string): string {
  const bytes = new TextEncoder().encode(line);
  if (bytes.length <= 75) return line;
  const parts: string[] = [];
  let current = "";
  let currentBytes = 0;
  for (const ch of line) {
    const n = new TextEncoder().encode(ch).length;
    const limit = parts.length === 0 ? 75 : 74; // continuation lines start with a space
    if (currentBytes + n > limit) {
      parts.push(current);
      current = "";
      currentBytes = 0;
    }
    current += ch;
    currentBytes += n;
  }
  parts.push(current);
  return parts.join("\r\n ");
}

/** A UTC instant as an iCalendar DATE-TIME ("20261021T150000Z"). */
export function icsDateTime(value: string | Date): string | null {
  const d = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(d.getTime())) return null;
  return d.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "");
}

/**
 * The whole .ics document for a member's saved bids. `now` stamps DTSTAMP.
 * Bids with an unreadable due date are skipped.
 */
export function buildSavedBidsCalendar(bids: readonly CalendarBid[], now: Date = new Date()): string {
  const stamp = icsDateTime(now)!;
  const lines: string[] = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//Contrax LLC//Saved bid deadlines//EN",
    "CALSCALE:GREGORIAN",
    "METHOD:PUBLISH",
    "X-WR-CALNAME:Contrax bid deadlines",
    "X-WR-CALDESC:Response deadlines of the bids you saved on Contrax",
    "REFRESH-INTERVAL;VALUE=DURATION:PT6H",
    "X-PUBLISHED-TTL:PT6H",
  ];
  for (const b of bids) {
    const due = icsDateTime(b.dueDate);
    if (!due) continue;
    const link = `${SITE}/bid/${b.bidId}`;
    const description = [
      b.agency ? `Buyer: ${b.agency}` : "",
      b.solicitationNumber ? `Solicitation: ${b.solicitationNumber}` : "",
      `Bid details on Contrax: ${link}`,
    ]
      .filter(Boolean)
      .join("\n");
    lines.push(
      "BEGIN:VEVENT",
      `UID:saved-bid-${b.bidId}@contrax.company`,
      `DTSTAMP:${stamp}`,
      `DTSTART:${due}`,
      `DTEND:${due}`,
      `SUMMARY:${icsEscape(`Bid due: ${b.title}`)}`,
      `DESCRIPTION:${icsEscape(description)}`,
      `URL:${link}`,
      "TRANSP:TRANSPARENT",
    );
    // Zone-unverified source: the event stays (the member asked to be reminded of
    // this bid's date), but the derived "2 days before" / "1 day before" alarms are
    // NOT emitted — they are countdowns computed off a close instant whose time
    // zone is not settled. See `~/lib/deadline-label`.
    if (!isCountdownSuppressed(b.source)) {
      lines.push(
        "BEGIN:VALARM",
        "ACTION:DISPLAY",
        `DESCRIPTION:${icsEscape(`Bid due in 2 days: ${b.title}`)}`,
        "TRIGGER:-P2D",
        "END:VALARM",
        "BEGIN:VALARM",
        "ACTION:DISPLAY",
        `DESCRIPTION:${icsEscape(`Bid due tomorrow: ${b.title}`)}`,
        "TRIGGER:-P1D",
        "END:VALARM",
      );
    }
    lines.push("END:VEVENT");
  }
  lines.push("END:VCALENDAR");
  return lines.map(icsFold).join("\r\n") + "\r\n";
}
