import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { alertNewlyDeadSources, deadSourceEmail, isDeadRun, likelyCause, newlyDeadTwice } from "./source-alerts";

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
