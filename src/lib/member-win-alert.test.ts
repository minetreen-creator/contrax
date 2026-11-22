import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { memberWinOwnerAlert } from "./member-win-alert";

const read = (p: string) => readFileSync(new URL(p, import.meta.url), "utf8");

describe("the owner hears when a member wins (owner 2026-11-22)", () => {
  test("a federal award naming the member says so, with the amount", () => {
    const a = memberWinOwnerAlert({ memberEmail: "pat@example.com", title: "Grounds Maintenance, Fort Jackson", agency: "Department of the Army", amount: 182400.4, source: "award_check", bidId: 77 });
    expect(a.subject).toBe("🏆 A Contrax member won a bid: pat@example.com");
    expect(a.text).toContain("Bid: Grounds Maintenance, Fort Jackson, Department of the Army, $182,400");
    expect(a.text).toContain("The federal award notice names their company as the winner.");
    expect(a.text).toContain("https://www.contrax.company/bid/77");
    expect(a.push.url).toBe("/bid/77");
  });

  test("a bid the member marked won is reported as their word", () => {
    const a = memberWinOwnerAlert({ memberEmail: null, title: "", agency: null, source: "marked_won", bidId: 5 });
    expect(a.text).toContain("Member: (member email not on file)");
    expect(a.text).toContain("Bid: Untitled bid");
    expect(a.text).toContain("That is their word; no award record was checked.");
    expect(a.push.tag.length).toBeLessThanOrEqual(64);
  });

  test("it is sent once per member and bid, from both places a win becomes known, and never for the owner", () => {
    const server = read("./member-win-alert.server.ts");
    expect(server).toContain("won_alerted_at IS NULL");
    expect(server).toContain("if (!row || row.is_admin) return false;");
    expect(read("../routes/api/pipeline-workspace.ts")).toContain('if (body.pursuit_status === "won") await onWon(user.id, bidId)');
    expect(read("../jobs/check-awards.ts")).toContain('alertOwnerOfMemberWin(uid, Number(r.bid_id), "award_check"');
  });
});
