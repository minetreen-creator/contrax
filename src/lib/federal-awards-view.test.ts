import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { AWARDS_FREE_ROWS, AWARDS_MEMBER_ROWS, awardLikePattern, awardMoney, cleanAwardQuery, cleanAwardState } from "./federal-awards-view";

// Owner 2026-11-08: /awards listed open bids as awards ("Open opportunity" as the winner).
describe("/awards shows real federal awards", () => {
  test("search terms are cleaned and escaped", () => {
    expect(cleanAwardQuery("  janitorial   services ")).toBe("janitorial services");
    expect(cleanAwardQuery("a")).toBe("");
    expect(cleanAwardQuery("<script>")).toBe("script");
    expect(awardLikePattern("50%_off\\")).toBe("%50\\%\\_off\\\\%");
    expect(cleanAwardState("va")).toBe("VA");
    expect(cleanAwardState("Virginia")).toBe("");
  });

  test("money reads like the competitor's page", () => {
    expect(awardMoney(37778)).toBe("$38K");
    expect(awardMoney(9500)).toBe("$9,500");
    expect(awardMoney(1_302_909)).toBe("$1.3M");
    expect(awardMoney(12_675_813_052)).toBe("$12.7B");
    expect(awardMoney(null)).toBe("—");
  });

  test("free viewers get a sample; the member list stays on the server", () => {
    expect(AWARDS_FREE_ROWS).toBeLessThan(AWARDS_MEMBER_ROWS);
    const fn = readFileSync(new URL("./federal-awards.ts", import.meta.url), "utf8");
    expect(fn).toContain("listLimit: paid ? AWARDS_MEMBER_ROWS : AWARDS_FREE_ROWS");
  });

  test("open bids are never labeled as awards", () => {
    const page = readFileSync(new URL("../routes/awards.tsx", import.meta.url), "utf8");
    expect(page).not.toContain('winning_company: "Open opportunity"');
    expect(page).toContain("<FederalAwardsSection data={federal} />");
    expect(page).toContain("Open bids: see who held similar work");
    const q = readFileSync(new URL("./federal-awards.server.ts", import.meta.url), "utf8");
    expect(q).toContain("SELECT DISTINCT ON (award_key) award_key, award_id, recipient_name");
  });
});
