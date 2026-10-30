import { describe, expect, test } from "bun:test";
import { recapLines, trialEmailContent, trialEmailStage, type TrialEmailRow, type TrialRecap } from "./trial-emails";

const DAY = 24 * 60 * 60 * 1000;
const NOW = Date.parse("2026-10-19T11:00:00Z");
const started = (daysAgo: number) => new Date(NOW - daysAgo * DAY).toISOString();
const row = (over: Partial<TrialEmailRow> = {}): TrialEmailRow => ({
  trial_started_at: started(5.5),
  subscription_status: null,
  ...over,
});

describe("trialEmailStage", () => {
  test("reminder within 2 days of the end, once", () => {
    expect(trialEmailStage(row({ trial_started_at: started(5.5) }), NOW)).toBe("reminder");
    expect(trialEmailStage(row({ trial_started_at: started(5.5), trial_reminder_sent_at: started(0) }), NOW)).toBeNull();
  });
  test("nothing earlier in the trial", () => {
    expect(trialEmailStage(row({ trial_started_at: started(2) }), NOW)).toBeNull();
  });
  test("ended notice within 3 days after the end, once", () => {
    expect(trialEmailStage(row({ trial_started_at: started(8) }), NOW)).toBe("ended");
    expect(trialEmailStage(row({ trial_started_at: started(8), trial_ended_sent_at: started(0) }), NOW)).toBeNull();
  });
  test("old trials that ended before this shipped are never emailed", () => {
    expect(trialEmailStage(row({ trial_started_at: started(30) }), NOW)).toBeNull();
  });
  test("never to admins, payers, grant accounts or accounts without a trial", () => {
    expect(trialEmailStage(row({ is_admin: true }), NOW)).toBeNull();
    expect(trialEmailStage(row({ subscription_status: "active" }), NOW)).toBeNull();
    expect(trialEmailStage(row({ access_expires_at: started(-10) }), NOW)).toBeNull();
    expect(trialEmailStage(row({ trial_started_at: null }), NOW)).toBeNull();
  });
});

const recap = (over: Partial<TrialRecap> = {}): TrialRecap => ({
  openMatches: 14,
  closingThisWeek: 3,
  saved: 4,
  savedClosingSoon: 1,
  matchLabel: "janitorial in VA",
  ...over,
});

describe("recapLines", () => {
  test("uses the member's own counts", () => {
    expect(recapLines(recap())).toEqual([
      "Contrax has 14 open bids for janitorial in VA right now, and 3 close this week.",
      "You saved 4 bids, and 1 closes in the next 10 days.",
    ]);
  });
  test("leaves out zero counts instead of showing them", () => {
    expect(recapLines(recap({ openMatches: 0, saved: 0 }))).toEqual([]);
    expect(recapLines(recap({ closingThisWeek: 0, savedClosingSoon: 0 }))).toEqual([
      "Contrax has 14 open bids for janitorial in VA right now.",
      "You saved 4 bids.",
    ]);
  });
  test("singulars read correctly", () => {
    expect(recapLines(recap({ openMatches: 1, closingThisWeek: 1, saved: 1, savedClosingSoon: 0, matchLabel: null }))).toEqual([
      "Contrax has 1 open bid right now, and 1 closes this week.",
      "You saved 1 bid.",
    ]);
  });
});

describe("trialEmailContent", () => {
  test("reminder and ended subjects, price and no-auto-renewal note", () => {
    const r = trialEmailContent("reminder", recap());
    expect(r.subject).toBe("Your Contrax trial ends soon");
    expect(r.html).toContain("$19/month");
    // Owner 2026-10-30: the $5 is a 30-day pass with no automatic renewal.
    expect(r.html).toContain("$5 for 30 days, no automatic renewal");
    expect(trialEmailContent("ended", recap()).subject).toContain("trial ended");
  });
  test("escapes the profile label", () => {
    const r = trialEmailContent("ended", recap({ matchLabel: "<b>x</b>" }));
    expect(r.html).not.toContain("<b>x</b>");
    expect(r.html).toContain("&lt;b&gt;x&lt;/b&gt;");
  });
  test("still reads well with no counts", () => {
    const r = trialEmailContent("ended", recap({ openMatches: 0, saved: 0 }));
    expect(r.html).not.toContain("<ul");
    expect(r.text).toContain("upgrade?utm_source=email&utm_campaign=trial_ended");
  });
});
