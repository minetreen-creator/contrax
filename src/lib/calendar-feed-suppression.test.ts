/**
 * ICS CALENDAR — countdown-suppression pins (owner 2026-10-08, Virginia drive).
 *
 * The saved-bid calendar feed knowingly carries the venue's own offset (DTSTART is
 * the raw stored instant) — but its two VALARMs are DERIVED countdowns
 * (`TRIGGER:-P2D` "Bid due in 2 days", `TRIGGER:-P1D` "Bid due tomorrow"). For a
 * source whose published close-date time zone is not settled (eVA + the four
 * Virginia locality CivicEngage boards) those triggers are the misleading math the
 * owner ruled against (`~/lib/deadline-label`), so they are NOT emitted.
 *
 * DETERMINISTIC, zero network, no DATABASE_URL.
 */
import { describe, expect, test } from "bun:test";
import { buildSavedBidsCalendar, type CalendarBid } from "./calendar-feed";

const dueDate = "2026-10-15T02:00:00Z";
const now = new Date("2026-10-10T12:00:00Z");

function feed(source: string | null | undefined, extra: Partial<CalendarBid> = {}): string {
  return buildSavedBidsCalendar(
    [{ bidId: 41, title: "Janitorial services", agency: "City of Suffolk", dueDate, source, ...extra }],
    now,
  );
}

describe("calendar feed — zone-unverified sources keep the event, lose the alarms", () => {
  test("an unflagged source is byte-identical to before (both VALARMs present)", () => {
    const ics = feed("sam_gov");
    expect(ics).toContain("TRIGGER:-P2D");
    expect(ics).toContain("TRIGGER:-P1D");
    expect(ics).toContain("Bid due in 2 days: Janitorial services");
    expect(ics).toContain("Bid due tomorrow: Janitorial services");
  });

  test("a NULL source is unchanged too (fail-open)", () => {
    const ics = feed(null);
    expect(ics).toBe(feed(undefined));
    expect(ics).toContain("TRIGGER:-P2D");
    expect(ics).toContain("TRIGGER:-P1D");
  });

  test("every pinned suppressed source loses both VALARMs but keeps its VEVENT", () => {
    for (const source of ["va_eva", "va_loudoun", "va_suffolk", "va_lynchburg", "va_charlottesville"]) {
      const ics = feed(source);
      expect(ics).not.toContain("VALARM");
      expect(ics).not.toContain("TRIGGER:");
      expect(ics).not.toContain("Bid due in 2 days");
      expect(ics).not.toContain("Bid due tomorrow");
      // The bid itself is still there — the member asked to be reminded of the date.
      expect(ics).toContain("BEGIN:VEVENT");
      expect(ics).toContain("Bid due: Janitorial services");
      expect(ics).toContain("DTSTART:20261015T020000Z");
      expect(ics).toContain("END:VEVENT");
      expect(ics).toContain("END:VCALENDAR");
    }
  });

  test("mixed feeds suppress only the flagged rows", () => {
    const ics = buildSavedBidsCalendar(
      [
        { bidId: 1, title: "Federal", agency: "GSA", dueDate, source: "sam_gov" },
        { bidId: 2, title: "Virginia", agency: "Commonwealth of VA", dueDate, source: "va_eva" },
      ],
      now,
    );
    expect(ics).toContain("Bid due in 2 days: Federal");
    expect(ics).toContain("Bid due tomorrow: Federal");
    // The pinned source's title never appears in an alarm description.
    expect(ics).not.toContain("Bid due in 2 days: Virginia");
    expect(ics).not.toContain("Bid due tomorrow: Virginia");
    // …but its event is present.
    expect(ics).toContain("Bid due: Virginia");
    expect(ics.match(/BEGIN:VEVENT/g)?.length).toBe(2);
    expect(ics.match(/BEGIN:VALARM/g)?.length).toBe(2);
  });
});
