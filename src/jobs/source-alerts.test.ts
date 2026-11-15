import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { alertNewlyDeadSources, deadSourceEmail, isDeadRun, likelyCause, newlyDeadTwice, onePerSync } from "./source-alerts";

// Owner 2026-11-03: "what can we do to stop the source dropoff?" → "yes".
const dead = { fetched: 0, errors: "HTTP 403 for https://www.wallnj.gov/bids.aspx" };
const ok = { fetched: 12, errors: null };
const empty = { fetched: 0, errors: null };

describe("dead-source warning", () => {
  test("warns exactly once: on the second failure in a row", () => {
    expect(newlyDeadTwice([dead])).toBe(false); // one failure is often a hiccup
    expect(newlyDeadTwice([dead, ok])).toBe(false);
    expect(newlyDeadTwice([dead, dead])).toBe(true); // a new source dead twice
    expect(newlyDeadTwice([dead, dead, ok])).toBe(true);
    expect(newlyDeadTwice([dead, dead, empty])).toBe(true);
    expect(newlyDeadTwice([dead, dead, dead])).toBe(false); // already reported
    expect(newlyDeadTwice([ok, dead, dead])).toBe(false);
    expect(isDeadRun(empty)).toBe(false); // an honest zero is not dead
  });

  test("the email names each source and a plain cause", () => {
    expect(likelyCause("HTTP 403 for https://x")).toContain("refusing");
    expect(likelyCause("HTTP 404")).toContain("moved");
    expect(likelyCause("request failed: The socket connection was closed unexpectedly")).toContain("connection");
    expect(likelyCause("bid list shape changed")).toContain("layout");
    // Owner 2026-11-04: "513" in a count is not an HTTP 5xx.
    expect(likelyCause("count gate: page 2 reports numFound=513 but page 1 reported 509 — the open set moved mid-read")).toContain("kept changing");
    expect(likelyCause("HTTP 503 Service Unavailable")).toContain("trouble on its end");
    const one = deadSourceEmail([{ source: "nj_wall", error: dead.errors }]);
    expect(one.subject).toBe("Contrax: nj_wall has stopped working");
    expect(one.text).toContain("nj_wall: the site is refusing our reader");
    expect(one.push.tag).toBe("source-dead");
    const two = deadSourceEmail([{ source: "a", error: "HTTP 404" }, { source: "b", error: "timeout" }]);
    expect(two.subject).toBe("Contrax: 2 bid sources have stopped working");
  });

  test("reads the last three runs per failed source and returns only the newly dead", async () => {
    const rows = [
      { source: "nj_wall", fetched: 0, errors: "HTTP 403" },
      { source: "nj_wall", fetched: 0, errors: "HTTP 403" },
      { source: "nj_wall", fetched: 9, errors: null },
      { source: "or_oregonbuys", fetched: 0, errors: "timeout" },
      { source: "or_oregonbuys", fetched: 139, errors: null },
    ];
    const sql = async () => rows;
    const prev = process.env.RESEND_API_KEY;
    delete process.env.RESEND_API_KEY;
    try {
      const warned = await alertNewlyDeadSources(sql, ["nj_wall", "or_oregonbuys"]);
      expect(warned.map((d) => d.source)).toEqual(["nj_wall"]);
      expect(await alertNewlyDeadSources(sql, [])).toEqual([]);
      expect(await alertNewlyDeadSources(async () => { throw new Error("db down"); }, ["nj_wall"])).toEqual([]);
    } finally {
      if (prev !== undefined) process.env.RESEND_API_KEY = prev;
    }
  });

  test("the sync retries a failed tail source once and then warns", () => {
    const runner = readFileSync(new URL("./runner.ts", import.meta.url), "utf8");
    expect(runner).toContain("if (!r || r.fetched > 0 || r.errors.length === 0 || isBidnetSource(source.name)) continue;");
    expect(runner).toContain('const { alertNewlyDeadSources } = await import("./source-alerts");');
  });
});

describe("a sync and its retry are one sync (owner 2026-11-04: nyc_open_data)", () => {
  const dead = (at: string) => ({ fetched: 0, errors: "request failed: The socket connection was closed unexpectedly", created_at: at });
  const ok = (at: string) => ({ fetched: 200, errors: null, created_at: at });
  test("12:33 retry + 12:31 first try is one failed sync, not two", async () => {
    const { onePerSync, newlyDeadTwice } = await import("./source-alerts");
    const h = [dead("2026-11-04T12:33:07Z"), dead("2026-11-04T12:31:21Z"), ok("2026-11-04T08:32:51Z"), dead("2026-11-04T08:32:26Z"), ok("2026-11-04T04:33:25Z")];
    expect(onePerSync(h).map((r) => r.created_at)).toEqual(["2026-11-04T12:33:07Z", "2026-11-04T08:32:51Z", "2026-11-04T04:33:25Z"]);
    expect(newlyDeadTwice(onePerSync(h))).toBe(false);
  });
  test("two separate failed syncs still warn", async () => {
    const { onePerSync, newlyDeadTwice } = await import("./source-alerts");
    const h = [dead("2026-11-04T16:33:00Z"), dead("2026-11-04T16:31:00Z"), dead("2026-11-04T12:33:00Z"), dead("2026-11-04T12:31:00Z"), ok("2026-11-04T08:32:00Z")];
    expect(newlyDeadTwice(onePerSync(h))).toBe(true);
  });
});

describe("a retry at the end of a long sync is the same sync (owner 2026-11-15, ak_dotpf)", () => {
  test("a failure and its retry 57 minutes later, after a good sync that morning, sends no email", () => {
    const history = [
      { fetched: 0, errors: "ak_dotpf unreachable: request failed: The operation was aborted.", created_at: "2026-11-15T21:19:02Z" },
      { fetched: 0, errors: "ak_dotpf unreachable: request failed: The operation was aborted.", created_at: "2026-11-15T20:22:32Z" },
      { fetched: 10, errors: null, created_at: "2026-11-15T15:10:00Z" },
    ];
    expect(onePerSync(history)).toHaveLength(2);
    expect(newlyDeadTwice(onePerSync(history))).toBe(false);
  });

  test("failures in two separate syncs five hours apart still send it", () => {
    const history = [
      { fetched: 0, errors: "timeout", created_at: "2026-11-15T20:22:32Z" },
      { fetched: 0, errors: "timeout", created_at: "2026-11-15T15:10:00Z" },
      { fetched: 10, errors: null, created_at: "2026-11-14T20:10:00Z" },
    ];
    expect(newlyDeadTwice(onePerSync(history))).toBe(true);
  });
});
