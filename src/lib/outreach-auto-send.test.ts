import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { AUTO_SEND_BATCH, AUTO_SEND_MAX_CALLS, DAILY_OUTREACH_CAP, MAX_SEND_PER_BATCH, autoSendDone } from "./outreach";

describe("automatic outreach sending", () => {
  test("the job stops when nothing is waiting, the day is full, or a call did nothing", () => {
    expect(autoSendDone({ sent: 8, failed: 0, skipped: 0, left: 40, room: 100 })).toBe(false);
    expect(autoSendDone({ sent: 8, failed: 0, skipped: 0, left: 0, room: 100 })).toBe(true);
    expect(autoSendDone({ sent: 8, failed: 0, skipped: 0, left: 40, room: 0 })).toBe(true);
    expect(autoSendDone({ sent: 0, failed: 0, skipped: 0, left: 40, room: 100 })).toBe(true);
  });
  test("a run can reach the daily limit but not loop forever", () => {
    expect(AUTO_SEND_BATCH).toBeLessThanOrEqual(MAX_SEND_PER_BATCH);
    expect(AUTO_SEND_BATCH * AUTO_SEND_MAX_CALLS).toBeGreaterThanOrEqual(DAILY_OUTREACH_CAP);
    expect(AUTO_SEND_MAX_CALLS).toBeLessThanOrEqual(60);
  });
  test("the site sends, behind a one-use ticket; the job never touches the email service", () => {
    const route = readFileSync("src/routes/api/outreach/auto-send.ts", "utf8");
    expect(route).toContain("if (!(await redeemSendTicket(ticket))) return Response.json({ error: \"Unauthorized\" }, { status: 401 });");
    const server = readFileSync("src/lib/outreach.server.ts", "utf8");
    expect(server).toContain("DELETE FROM outreach_send_tickets WHERE ticket = ${ticket} AND expires_at > NOW() RETURNING ticket");
    expect(server).toContain("const r = await sendDrafts(waiting.map((w) => Number(w.id)));");
    const job = readFileSync("src/jobs/outreach-send.ts", "utf8");
    expect(job).not.toContain("resend");
    expect(job).not.toContain("RESEND_API_KEY");
    expect(readFileSync(".github/workflows/outreach-send.yml", "utf8")).not.toContain("RESEND_API_KEY");
  });
});
