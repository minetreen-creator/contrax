import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { DB_INDEXES, DB_INDEX_TABLES, indexStatement } from "./db-indexes";
import { isDeclaredCrawler } from "./bid-watermark";

describe("the missing lookup indexes", () => {
  test("cover what the pages filter on, and only add indexes", () => {
    const defs = DB_INDEXES.map((i) => `${i[1]} ${i[2]}`);
    expect(defs).toContain("bids (normalized_state, due_date)");
    expect(defs).toContain("bids (due_date)");
    expect(defs).toContain("notifications (user_id, read)");
    expect(new Set(DB_INDEXES.map((i) => i[0])).size).toBe(DB_INDEXES.length);
    expect([...DB_INDEX_TABLES].sort()).toEqual(["award_leads", "bids", "notifications"]);
    for (const [name, table, def] of DB_INDEXES) {
      expect(indexStatement(name, table, def, true)).toBe(`CREATE INDEX CONCURRENTLY IF NOT EXISTS ${name} ON ${table} ${def}`);
      expect(indexStatement(name, table, def, false)).toBe(`CREATE INDEX IF NOT EXISTS ${name} ON ${table} ${def}`);
    }
  });

  test("a statement is refused unless it is a plain name and column list", () => {
    expect(() => indexStatement("x; DROP TABLE bids", "bids", "(id)", false)).toThrow();
    expect(() => indexStatement("idx_ok", "bids", "(id); DELETE FROM bids", false)).toThrow();
  });

  test("the job never deletes or changes rows", () => {
    const job = readFileSync(new URL("../jobs/ensure-indexes.ts", import.meta.url), "utf8");
    expect(job).not.toMatch(/DELETE FROM|UPDATE \w+ SET|TRUNCATE|DROP TABLE|INSERT INTO/i);
  });
});

describe("no watermark row for a crawler that names itself", () => {
  test("search and AI crawlers are recognised", () => {
    expect(isDeclaredCrawler("Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)")).toBe(true);
    expect(isDeclaredCrawler("Mozilla/5.0 AppleWebKit/537.36 (KHTML, like Gecko; compatible; GPTBot/1.2; +https://openai.com/gptbot)")).toBe(true);
    expect(isDeclaredCrawler("Mozilla/5.0 (compatible; bingbot/2.0; +http://www.bing.com/bingbot.htm)")).toBe(true);
  });
  test("a person, a script and a missing browser string are still marked", () => {
    expect(isDeclaredCrawler("Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 Version/18.0 Mobile/15E148 Safari/604.1")).toBe(false);
    expect(isDeclaredCrawler("python-requests/2.32.3")).toBe(false);
    expect(isDeclaredCrawler("")).toBe(false);
    expect(isDeclaredCrawler(null)).toBe(false);
  });
});
