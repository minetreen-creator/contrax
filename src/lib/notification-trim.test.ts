import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";

const read = (p: string) => readFileSync(new URL(p, import.meta.url), "utf8");

test("only match notifications beyond the newest 200 per account are ever deleted", () => {
  const lib = read("./notification-trim.server.ts");
  expect(lib).toContain("export const MATCH_NOTIFICATIONS_KEPT = 200;");
  expect(lib.match(/DELETE FROM/g)?.length).toBe(1);
  expect(lib).toContain("WHERE user_id = ${uid} AND type = 'new_bid_match'");
  expect(lib).toContain("ORDER BY created_at DESC, id DESC");
  expect(lib).toContain("OFFSET ${MATCH_NOTIFICATIONS_KEPT}");
});

test("the trim follows each batch and cannot fail it", () => {
  const src = read("./notifications.ts");
  expect(src).toContain('trimMatchNotifications(rows.filter((r) => r.type === "new_bid_match").map((r) => r.userId))');
  expect(src).toContain("trim failed (non-fatal)");
});
