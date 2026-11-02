import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { closesTooSoon, closingSoonLast } from "./radar-closing-soon";

const NOW = Date.parse("2026-11-02T04:00:00Z");
const inDays = (d: number) => new Date(NOW + d * 86_400_000).toISOString();

describe("bids closing within 2 days go last (owner 2026-11-02, Conroe visitor)", () => {
  test("closesTooSoon", () => {
    expect(closesTooSoon(inDays(0.2), NOW)).toBe(true);
    expect(closesTooSoon(inDays(1.9), NOW)).toBe(true);
    expect(closesTooSoon(inDays(2.1), NOW)).toBe(false);
    expect(closesTooSoon(inDays(30), NOW)).toBe(false);
    expect(closesTooSoon(null, NOW)).toBe(false);
    expect(closesTooSoon("not a date", NOW)).toBe(false);
  });

  test("keeps ranking, moves the closing ones to the end", () => {
    const rows = [
      { id: "harris-mowing", due: inDays(0.5) },
      { id: "a", due: inDays(20) },
      { id: "tomorrow", due: inDays(1) },
      { id: "b", due: inDays(5) },
      { id: "no-date", due: null },
    ];
    expect(closingSoonLast(rows, (r) => r.due, NOW).map((r) => r.id)).toEqual(["a", "b", "no-date", "harris-mowing", "tomorrow"]);
  });

  test("radar applies it to matches and related rows", () => {
    const src = readFileSync("src/routes/radar.tsx", "utf8");
    expect(src).toContain("closingSoonLast(scored.filter((m) => m.strong)");
    expect(src).toContain("closingSoonLast(related,");
  });
});
