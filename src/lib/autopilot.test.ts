import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
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

import { autopilotProfileKey, profileList } from "./autopilot";
import { autopilotForMember, newAutopilotBudget } from "./autopilot.server";

test("profile lists and the profile key", () => {
  expect(profileList(["8a", " ", "hubzone"])).toEqual(["8a", "hubzone"]);
  expect(profileList('["sdvosb"]')).toEqual(["sdvosb"]);
  expect(profileList(null)).toEqual([]);
  const p = { industry: "Paving", locations: ["VA"] };
  expect(autopilotProfileKey(p)).toBe(autopilotProfileKey({ ...p }));
  expect(autopilotProfileKey(p)).not.toBe(autopilotProfileKey({ ...p, locations: ["MD"] }));
  // Certifications are not in the key: eligibility is worked out fresh every morning.
  expect(autopilotProfileKey(p)).toBe(autopilotProfileKey({ ...p, certifications: ["8a"] }));
});

describe("scoring a member's bids", () => {
  const fakeDb = (cache: Record<number, string>, writes: unknown[][]) =>
    (() => async (strings: TemplateStringsArray, ...values: unknown[]) => {
      const text = strings.join("?");
      if (text.includes("SELECT bid_id, raw")) {
        const ids = values[2] as number[];
        return ids.filter((id) => cache[id]).map((id) => ({ bid_id: id, raw: cache[id] }));
      }
      if (text.includes("INSERT INTO autopilot_verdicts")) writes.push(values);
      return [];
    }) as never;
  const bids = [
    { bid_id: 1, title: "Paving", set_aside: "HUBZone" },
    { bid_id: 2, title: "Striping" },
    { bid_id: 3, title: "Snow removal" },
  ];

  test("cached answers are reused, the rest scored and stored, rules applied on read", async () => {
    const writes: unknown[][] = [];
    let calls = 0;
    const budget = newAutopilotBudget(10);
    const out = await autopilotForMember(7, { industry: "Paving" }, bids, budget, {
      db: fakeDb({ 1: '{"fit":90,"decision":"pursue","why":"Paving job."}' }, writes),
      ai: async () => { calls++; return '{"fit":80,"decision":"pursue","why":"Good.","missing":[]}'; },
    });
    expect(calls).toBe(2);
    expect(writes).toHaveLength(2);
    expect(out.map((v) => v.bid_id)).toEqual([1, 2, 3]);
    // Cached "pursue" on a HUBZone bid without the certification becomes "partner".
    expect(out[0].decision).toBe("partner");
    expect(budget.calls).toBe(2);
  });

  test("the morning budget stops AI calls; failures are left out; preview stores nothing", async () => {
    const writes: unknown[][] = [];
    const budget = newAutopilotBudget(1);
    const out = await autopilotForMember(7, {}, bids, budget, { store: false, db: fakeDb({}, writes), ai: async () => "nope" });
    expect(out).toEqual([]);
    expect(budget.calls).toBe(1);
    expect(budget.failures).toBe(1);
    expect(writes).toHaveLength(0);
  });
});

test("the morning email leads with Auto-Pilot and names the picks in the subject", () => {
  const job = readFileSync(new URL("../jobs/send-bid-digest.ts", import.meta.url), "utf8");
  expect(job).toContain("autopilotForMember(");
  expect(job).toContain("...(autopilotHtml ? { autopilotHtml, autopilotPicks } : {}),");
  const email = readFileSync(new URL("./email.ts", import.meta.url), "utf8");
  expect(email.indexOf('${daily?.autopilotHtml ?? ""}')).toBeLessThan(email.indexOf("<!-- Bid List -->"));
  expect(email).toContain("strong fit${e.options.autopilotPicks === 1");
  const wf = readFileSync(new URL("../../.github/workflows/daily-emails.yml", import.meta.url), "utf8");
  expect(wf).toContain("OPENAI_API_KEY: ${{ secrets.OPENAI_API_KEY || secrets.OPEN_AI_KEY }}");
  const preview = readFileSync(new URL("../../.github/workflows/autopilot-preview.yml", import.meta.url), "utf8");
  expect(preview).toContain("OPENAI_API_KEY: ${{ secrets.OPENAI_API_KEY || secrets.OPEN_AI_KEY }}");
});
