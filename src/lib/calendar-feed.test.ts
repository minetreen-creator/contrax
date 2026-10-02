/**
 * Saved-bid calendar feed (src/lib/calendar-feed.ts): pure .ics building.
 */
import { describe, expect, test } from "bun:test";
import {
  buildSavedBidsCalendar,
  calendarFeedUrl,
  icsDateTime,
  icsEscape,
  icsFold,
  isCalendarToken,
  newCalendarToken,
} from "./calendar-feed";

const NOW = new Date("2026-10-02T12:00:00Z");

describe("calendar feed", () => {
  test("one event per saved bid with a due date, with 2-day and 1-day reminders", () => {
    const ics = buildSavedBidsCalendar(
      [
        { bidId: 101, title: "LRC Janitorial Services", agency: "State Purchasing Bureau", dueDate: "2026-10-13T05:00:00.000Z", solicitationNumber: "127693 O5" },
        { bidId: 102, title: "No date", agency: null, dueDate: "not a date" },
      ],
      NOW,
    );
    expect(ics.startsWith("BEGIN:VCALENDAR\r\n")).toBe(true);
    expect(ics.endsWith("END:VCALENDAR\r\n")).toBe(true);
    expect(ics.match(/BEGIN:VEVENT/g)!.length).toBe(1);
    const unfolded = ics.replace(/\r\n /g, "");
    expect(unfolded).toContain("UID:saved-bid-101@contrax.company");
    expect(unfolded).toContain("DTSTAMP:20261002T120000Z");
    expect(unfolded).toContain("DTSTART:20261013T050000Z");
    expect(unfolded).toContain("SUMMARY:Bid due: LRC Janitorial Services");
    expect(unfolded).toContain("DESCRIPTION:Buyer: State Purchasing Bureau\\nSolicitation: 127693 O5\\nBid details on Contrax: https://www.contrax.company/bid/101");
    expect(unfolded).toContain("URL:https://www.contrax.company/bid/101");
    expect(unfolded).toContain("TRIGGER:-P2D");
    expect(unfolded).toContain("TRIGGER:-P1D");
    for (const line of ics.split("\r\n")) expect(new TextEncoder().encode(line).length).toBeLessThanOrEqual(75);
  });

  test("an empty list is still a valid calendar (a member who stopped paying)", () => {
    const ics = buildSavedBidsCalendar([], NOW);
    expect(ics).toContain("X-WR-CALNAME:Contrax bid deadlines");
    expect(ics).not.toContain("BEGIN:VEVENT");
  });

  test("text escaping and line folding", () => {
    expect(icsEscape("Roof; walls, and\\ more\nline")).toBe("Roof\\; walls\\, and\\\\ more\\nline");
    const long = "SUMMARY:" + "x".repeat(200);
    const folded = icsFold(long);
    expect(folded.split("\r\n ").join("")).toBe(long);
    for (const part of folded.split("\r\n")) expect(part.length).toBeLessThanOrEqual(75);
    expect(icsFold("SHORT:line")).toBe("SHORT:line");
  });

  test("dates and tokens", () => {
    expect(icsDateTime("2026-11-02T21:00:00.000Z")).toBe("20261102T210000Z");
    expect(icsDateTime("junk")).toBeNull();
    const t = newCalendarToken();
    expect(isCalendarToken(t)).toBe(true);
    expect(isCalendarToken("../etc")).toBe(false);
    expect(calendarFeedUrl(t)).toBe(`https://www.contrax.company/api/calendar-feed?token=${t}`);
  });
});
