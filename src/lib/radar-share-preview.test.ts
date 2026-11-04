import { describe, expect, test } from "bun:test";
import { shareHtml } from "./radar-share";

// Owner 2026-11-04: "remove the free wording from the preview".
describe("Radar share link preview", () => {
  test("never says free", () => {
    const html = shareHtml({ trade: "construction", state: "PA", count: 25, cap: 25, closestDue: "2026-11-20T00:00:00Z", now: "2026-11-04T12:00:00Z" });
    expect(html).toContain("updated every day");
    expect(html.toLowerCase()).not.toContain("free");
  });
});
