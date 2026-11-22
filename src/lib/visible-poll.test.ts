import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { POLL_IDLE_STOP_MS, shouldPoll } from "./visible-poll";

test("the console asks the database only while it is on screen and in use", () => {
  expect(shouldPoll(false, 0)).toBe(true);
  expect(shouldPoll(false, POLL_IDLE_STOP_MS)).toBe(true);
  expect(shouldPoll(true, 0)).toBe(false);
  expect(shouldPoll(false, POLL_IDLE_STOP_MS + 1)).toBe(false);
});

test("no owner screen polls on a bare timer any more", () => {
  for (const f of ["../routes/admin/live.tsx", "../routes/admin/command.tsx"]) {
    const src = readFileSync(new URL(f, import.meta.url), "utf8");
    expect(src).toContain("pollWhileVisible(");
    expect(src).not.toMatch(/setInterval\(load,/);
  }
});
