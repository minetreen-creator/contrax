import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { MEMBER_BID_NUDGE_BODY, MEMBER_BID_NUDGE_URL, isMemberBidStage, memberBidStageOwnerAlert, memberNoticeOpenOwnerAlert } from "./member-bid-activity";

const read = (p: string) => readFileSync(new URL(p, import.meta.url), "utf8");

// Owner 2026-11-23: "how will we know if someone bids on something?" → "add it".
describe("the owner hears when a member is working a bid", () => {
  test("Preparing and Submitted each get their own alert, in the member's own words", () => {
    const base = { memberEmail: "roofer@example.com", title: "Roof Replacement", agency: "Town of Example", bidId: 42 };
    const prep = memberBidStageOwnerAlert({ ...base, stage: "preparing" });
    const sub = memberBidStageOwnerAlert({ ...base, stage: "submitted" });
    expect(prep.subject).toBe("📝 A Contrax member is preparing a bid: roofer@example.com");
    expect(sub.subject).toBe("📨 A Contrax member submitted a bid: roofer@example.com");
    expect(sub.text).toContain("Bid: Roof Replacement, Town of Example");
    expect(sub.text).toContain("Contrax cannot see what an agency receives");
    expect(sub.push.url).toBe("/bid/42");
    expect(prep.push.tag).not.toBe(sub.push.tag);
    expect(isMemberBidStage("submitted")).toBe(true);
    expect(isMemberBidStage("won")).toBe(false);
    expect(isMemberBidStage("evaluating")).toBe(false);
  });

  test("opening the official notice is told once a day per member", () => {
    const a = memberNoticeOpenOwnerAlert({ memberEmail: null, title: "", agency: null, bidId: 7 });
    expect(a.subject).toBe("📄 A Contrax member opened an official notice: (member email not on file)");
    expect(a.text).toContain("Bid: Untitled bid");
    expect(a.text).toContain("once a day per member");
    const server = read("./member-bid-activity.server.ts");
    expect(server).toContain("ON CONFLICT DO NOTHING RETURNING opened_at");
    expect(server).toContain("if ((today?.n ?? 0) > 1) return \"new\";");
    expect(server).toContain("return row && !row.is_admin ? row : null;");
  });

  test("wired: the pipeline save, every official notice link and the morning email", () => {
    const api = read("../routes/api/pipeline-workspace.ts");
    expect(api).toContain('if (body.pursuit_status === "preparing" || body.pursuit_status === "submitted") await onStage(user.id, bidId, body.pursuit_status).catch(() => {});');
    for (const f of ["../routes/bid.$bidId.tsx", "../routes/radar.tsx", "../routes/pipeline.tsx", "../routes/dashboard.tsx"]) {
      expect({ f, wired: read(f).includes("noteNoticeOpen(") }).toEqual({ f, wired: true });
    }
    expect(read("../routes/api/bid-notice-open.ts")).toContain("if (!user) return new Response(null, { status: 204 });");
    expect(read("./email.ts")).toContain("${MEMBER_BID_NUDGE_HEAD}</strong> ${MEMBER_BID_NUDGE_BODY}");
    expect(MEMBER_BID_NUDGE_BODY).toContain("Preparing or Submitted");
    expect(MEMBER_BID_NUDGE_URL).toBe("https://www.contrax.company/pipeline?source=bid_email");
  });
});
