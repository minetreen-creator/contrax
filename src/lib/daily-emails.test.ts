import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { DAILY_EMAIL_JOBS, dailyEmailsDue, newYorkDayAndHour } from "./daily-emails";
import { runDailyEmails } from "./daily-emails.server";

// Owner 2026-11-09: "move the email to vercel". Sent from Vercel; GitHub is a backup; once a day.
describe("the 6 AM New York rule", () => {
  test("winter (EST, UTC-5) and summer (EDT, UTC-4)", () => {
    expect(newYorkDayAndHour(new Date("2026-11-10T10:59:00Z"))).toEqual({ day: "2026-11-10", hour: 5 });
    expect(dailyEmailsDue(new Date("2026-11-10T10:59:00Z"))).toBe(false);
    expect(dailyEmailsDue(new Date("2026-11-10T11:00:00Z"))).toBe(true);
    expect(dailyEmailsDue(new Date("2026-07-10T09:59:00Z"))).toBe(false);
    expect(dailyEmailsDue(new Date("2026-07-10T10:00:00Z"))).toBe(true);
    // 1 AM UTC is still the previous evening in New York.
    expect(newYorkDayAndHour(new Date("2026-11-11T01:00:00Z")).day).toBe("2026-11-10");
  });
});

/** A fake daily_email_runs table shared by two triggers. */
function fakeDb(rows = new Map<string, { status: string; trigger: string }>(), digestSentToday = false) {
  const db = (() => async (strings: TemplateStringsArray, ...v: unknown[]) => {
    const text = strings.join("?");
    if (text.includes("FROM daily_email_runs WHERE day")) return [{ n: [...rows.keys()].filter((k) => k.startsWith(`${v[0]}|`)).length }];
    if (text.includes("FROM bid_digest_log")) return [{ n: digestSentToday ? 1 : 0 }];
    if (text.includes("INSERT INTO daily_email_runs") && text.includes("'earlier'")) {
      const key = `${v[0]}|${v[1]}`;
      if (!rows.has(key)) rows.set(key, { status: "done", trigger: "earlier" });
      return [];
    }
    if (text.includes("INSERT INTO daily_email_runs")) {
      const key = `${v[0]}|${v[1]}`;
      if (rows.has(key)) return [];
      rows.set(key, { status: "running", trigger: String(v[2]) });
      return [{ job: v[1] }];
    }
    if (text.includes("UPDATE daily_email_runs")) {
      const key = `${v[2]}|${v[3]}`;
      const r = rows.get(key);
      if (r) r.status = String(v[0]);
      return [];
    }
    return [];
  }) as never;
  return { db, rows };
}

describe("the once-a-day runner", () => {
  const morning = new Date("2026-11-10T11:10:00Z");

  test("nothing runs before 6 AM", async () => {
    const { db } = fakeDb();
    const ran: string[] = [];
    const r = await runDailyEmails("vercel", new Date("2026-11-10T10:50:00Z"), { db, run: async (j) => void ran.push(j) });
    expect(r.due).toBe(false);
    expect(ran).toEqual([]);
  });

  test("Vercel sends every job once; the GitHub backup then skips them all", async () => {
    const { db, rows } = fakeDb();
    const ran: string[] = [];
    const run = async (j: string) => {
      ran.push(j);
      return { ok: true };
    };
    const first = await runDailyEmails("vercel", morning, { db, run });
    expect(first.ran.map((j) => j.job)).toEqual([...DAILY_EMAIL_JOBS]);
    const second = await runDailyEmails("github", new Date("2026-11-10T12:07:00Z"), { db, run });
    expect(second.ran).toEqual([]);
    expect(second.skipped).toEqual([...DAILY_EMAIL_JOBS]);
    expect(ran).toEqual([...DAILY_EMAIL_JOBS]);
    expect([...rows.values()].every((r) => r.status === "done" && r.trigger === "vercel")).toBe(true);
  });

  test("a failing job is recorded, never retried that day, and does not stop the others", async () => {
    const { db, rows } = fakeDb();
    let digestCalls = 0;
    const run = async (j: string) => {
      if (j === "bid-digest") {
        digestCalls++;
        throw new Error("Resend down");
      }
      return {};
    };
    const r = await runDailyEmails("vercel", morning, { db, run });
    expect(r.ran.find((j) => j.job === "bid-digest")?.status).toBe("failed");
    expect(r.ran.filter((j) => j.status === "done")).toHaveLength(DAILY_EMAIL_JOBS.length - 1);
    await runDailyEmails("vercel", new Date("2026-11-10T11:20:00Z"), { db, run });
    expect(digestCalls).toBe(1);
    expect(rows.get("2026-11-10|bid-digest")?.status).toBe("failed");
  });

  test("a morning already sent the old way (the day this goes live) is not sent again", async () => {
    const { db, rows } = fakeDb(new Map(), true);
    const ran: string[] = [];
    const r = await runDailyEmails("github", new Date("2026-11-09T20:07:00Z"), { db, run: async (j) => void ran.push(j) });
    expect(ran).toEqual([]);
    expect(r.skipped).toEqual([...DAILY_EMAIL_JOBS]);
    expect(rows.get("2026-11-09|bid-digest")?.trigger).toBe("earlier");
  });

  test("the next New York day runs again", async () => {
    const { db } = fakeDb();
    const ran: string[] = [];
    const run = async (j: string) => void ran.push(j);
    await runDailyEmails("vercel", morning, { db, run });
    await runDailyEmails("vercel", new Date("2026-11-11T11:10:00Z"), { db, run });
    expect(ran).toHaveLength(DAILY_EMAIL_JOBS.length * 2);
  });
});

test("Vercel is the main trigger: the cron runs the emails itself, with room to finish", () => {
  const route = readFileSync(new URL("../routes/api/cron/daily-emails.ts", import.meta.url), "utf8");
  expect(route).toContain('runDailyEmails("vercel")');
  expect(route).not.toContain("dispatchWorkflow");
  const build = readFileSync(new URL("../../build-vercel.sh", import.meta.url), "utf8");
  expect(build).toContain('"maxDuration": 120');
});
