import { describe, expect, test } from "bun:test";
import { autopilotEmailHtml, eligibilityFor, parseAutopilotVerdict, strongPicks, type AutopilotVerdict } from "./autopilot";

const bid = { bid_id: 1, title: "Road resurfacing" };

describe("Auto-Pilot eligibility is decided by rule", () => {
  test("certified set-asides need the certification", () => {
    expect(eligibilityFor("SDVOSB Set-Aside", ["sdvosb"]).eligible).toBe("yes");
    expect(eligibilityFor("Service-Disabled Veteran-Owned", []).eligible).toBe("no");
    expect(eligibilityFor("8(a) Sole Source", ["wosb"]).eligible).toBe("no");
    expect(eligibilityFor("HUBZone", ["hubzone"]).eligible).toBe("yes");
    expect(eligibilityFor("EDWOSB", ["wosb"]).eligible).toBe("yes");
    expect(eligibilityFor("Veteran-Owned Small Business", ["sdvosb"]).eligible).toBe("yes");
  });
  test("small-business, open and blank set-asides are open", () => {
    expect(eligibilityFor("Total Small Business", []).eligible).toBe("yes");
    expect(eligibilityFor("", []).eligible).toBe("yes");
    expect(eligibilityFor(null, []).eligible).toBe("yes");
    expect(eligibilityFor("Full and Open", []).reason).toBe("Open competition.");
  });
});

describe("parsing the model's answer", () => {
  const yes = { eligible: "yes" as const, reason: "Open competition." };
  const no = { eligible: "no" as const, reason: "Set aside for HUBZone businesses." };
  test("rules win over the model", () => {
    expect(parseAutopilotVerdict('{"fit":90,"decision":"pursue","why":"x","missing":[]}', bid, no)?.decision).toBe("partner");
    expect(parseAutopilotVerdict('{"fit":30,"decision":"pursue","why":"x"}', bid, yes)?.decision).toBe("pass");
    expect(parseAutopilotVerdict('{"fit":250,"decision":"pursue"}', bid, yes)?.fit).toBe(100);
  });
  test("junk is rejected, missing items are capped", () => {
    expect(parseAutopilotVerdict("not json", bid, yes)).toBeNull();
    expect(parseAutopilotVerdict('{"fit":"lots"}', bid, yes)).toBeNull();
    const v = parseAutopilotVerdict('Sure: {"fit":75,"decision":"maybe","missing":["a","b","c","d","e"]}', bid, yes)!;
    expect(v.decision).toBe("pursue");
    expect(v.missing).toHaveLength(4);
  });
});

test("strong picks: pursue first, best fit first, passes dropped", () => {
  const v = (bid_id: number, fit: number, decision: AutopilotVerdict["decision"]): AutopilotVerdict => ({ bid_id, fit, decision, eligible: "yes", eligibilityReason: "", missing: [], why: "" });
  const picks = strongPicks([v(1, 95, "partner"), v(2, 72, "pursue"), v(3, 88, "pursue"), v(4, 99, "pass"), v(5, 60, "pursue")]);
  expect(picks.map((p) => p.bid_id)).toEqual([3, 2, 1]);
});

test("email block escapes text and is empty with no picks", () => {
  expect(autopilotEmailHtml([])).toBe("");
  const html = autopilotEmailHtml([{ verdict: { bid_id: 1, fit: 80, decision: "pursue", eligible: "yes", eligibilityReason: "Open competition.", missing: ["Bonding"], why: "<b>Good</b> fit" }, title: "A & B", url: "https://www.contrax.company/bid/1" }]);
  expect(html).toContain("PURSUE");
  expect(html).toContain("A &amp; B");
  expect(html).toContain("&lt;b&gt;Good&lt;/b&gt;");
  expect(html).toContain("You may need:</strong> Bonding");
});
