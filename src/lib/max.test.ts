import { describe, expect, test } from "bun:test";
import {
  KONAMI,
  MAX_TOOLS,
  certEligible,
  fitCerts,
  maxEasterEgg,
  maxPrompt,
  parseBidRef,
  parseMaxReply,
  rankFit,
  reminderAt,
  sanitizeMaxHistory,
  scoreFit,
  setAsideProgram,
  stateCode,
} from "./max";

describe("Max replies", () => {
  test("parses the JSON reply and keeps only known CTAs and states", () => {
    expect(parseMaxReply(JSON.stringify({ say: "Found 3.", cta: "email", trade: "janitorial", state: "ut" }))).toEqual({ say: "Found 3.", cta: "email", trade: "janitorial", state: "UT", remindBid: null, lang: "en" });
    expect(parseMaxReply(JSON.stringify({ say: "Hi", cta: "buy now", state: "ZZ" }))).toEqual({ say: "Hi", cta: null, trade: null, state: null, remindBid: null, lang: "en" });
    expect(parseMaxReply("plain text").say).toBe("plain text");
    expect(parseMaxReply("").say).toMatch(/lost my train/);
  });
  test("history keeps only user/assistant text, last 8", () => {
    const h = Array.from({ length: 12 }, (_, i) => ({ role: i % 2 ? "assistant" : "user", content: `m${i}` }));
    expect(sanitizeMaxHistory([...h, { role: "system", content: "x" }, null])).toHaveLength(8);
    expect(sanitizeMaxHistory("nope")).toEqual([]);
  });
  test("states", () => {
    expect(stateCode("va")).toBe("VA");
    expect(stateCode("Virginia")).toBeNull();
  });
});

describe("Max's tools and prompt", () => {
  test("seven read-only lookups", () => {
    expect(MAX_TOOLS.map((t) => t.function.name)).toEqual(["search_open_bids", "bid_details", "state_overview", "recent_winners", "contracts_ending_soon", "industry_days", "best_fit_bids", "explain_bid", "prime_contractors"]);
  });
  test("the prompt forbids invented facts and requires lookups", () => {
    const p = maxPrompt("Sunday, October 25, 2026");
    expect(p).toContain("never invent a bid");
    expect(p).toContain("Always look things up with the tools");
  });
});

describe("Easter eggs", () => {
  test("secret phrases, any punctuation or case", () => {
    expect(maxEasterEgg("Show me the MONEY!")?.effect).toBe("money");
    expect(maxEasterEgg("do a barrel roll")?.effect).toBe("barrel");
    expect(maxEasterEgg("I am Ironman")?.effect).toBe("ironman");
    expect(maxEasterEgg("RED ALERT")?.effect).toBe("redalert");
    expect(maxEasterEgg("beam me up, Max")?.effect).toBe("beam");
    expect(maxEasterEgg("who made you?")?.say).toMatch(/Virginia/);
    expect(maxEasterEgg("tell me a joke", 0)?.say).toMatch(/ladder/);
  });
  test("ordinary questions go to the AI", () => {
    expect(maxEasterEgg("any cleaning contracts in Virginia?")).toBeNull();
    expect(maxEasterEgg("show me the bids in Ohio")).toBeNull();
  });
  test("konami code", () => {
    expect(KONAMI).toHaveLength(10);
  });
});

describe("Max: remind and Spanish replies", () => {
  test("a remind CTA needs a bid id, else it falls back to the email offer", () => {
    expect(parseMaxReply(JSON.stringify({ say: "Sure", cta: "remind", remind_bid: 42 }))).toMatchObject({ cta: "remind", remindBid: 42 });
    expect(parseMaxReply(JSON.stringify({ say: "Sure", cta: "remind" }))).toMatchObject({ cta: "email", remindBid: null });
    expect(parseMaxReply(JSON.stringify({ say: "Sure", cta: "remind", remind_bid: "42" })).remindBid).toBeNull();
  });
  test("lang comes from the reply, else the page's choice", () => {
    expect(parseMaxReply(JSON.stringify({ say: "Hola", lang: "es" })).lang).toBe("es");
    expect(parseMaxReply(JSON.stringify({ say: "Hola" }), "es").lang).toBe("es");
    expect(parseMaxReply("", "es").say).toMatch(/Perdón/);
  });
  test("the prompt covers Spanish, fit and the explainer", () => {
    const p = maxPrompt("Sunday");
    expect(p).toMatch(/Spanish/);
    expect(p).toMatch(/best_fit_bids/);
    expect(p).toMatch(/explain_bid/);
    expect(p).toMatch(/never claim a company won this exact contract/);
  });
  test("Spanish easter eggs", () => {
    expect(maxEasterEgg("¡Muéstrame el dinero!")?.effect).toBe("money");
    expect(maxEasterEgg("alerta roja")?.effect).toBe("redalert");
    expect(maxEasterEgg("cuéntame un chiste", 0)?.say).toMatch(/escalera/);
  });
});

describe("Max: best fit", () => {
  const now = Date.parse("2026-10-25T12:00:00Z");
  const day = (n: number) => new Date(now + n * 86_400_000).toISOString();
  test("reads set-aside text", () => {
    expect(setAsideProgram(null)).toBe("open");
    expect(setAsideProgram("N/A")).toBe("open");
    expect(setAsideProgram("8(a) Set-Aside")).toBe("8a");
    expect(setAsideProgram("SDVOSB")).toBe("sdvosb");
    expect(setAsideProgram("Women-Owned Small Business (WOSB) Program Set-Aside")).toBe("wosb");
    expect(setAsideProgram("EDWOSB")).toBe("edwosb");
    expect(setAsideProgram("HUBZone set-aside")).toBe("hubzone");
    expect(setAsideProgram("Total Small Business Set-Aside (FAR 19.5)")).toBe("small");
    expect(setAsideProgram("Local vendor preference")).toBe("other");
  });
  test("eligibility", () => {
    expect(certEligible("8a", [])).toBe(false);
    expect(certEligible("8a", ["8a"])).toBe(true);
    expect(certEligible("vosb", ["sdvosb"])).toBe(true);
    expect(certEligible("wosb", ["edwosb"])).toBe(true);
    expect(certEligible("edwosb", ["wosb"])).toBe(false);
    expect(certEligible("small", [])).toBe(true);
    expect(certEligible("other", [])).toBe(true);
  });
  test("a set-aside they hold ranks first; ones they lack are left out; tight deadlines rank lower", () => {
    const bids = [
      { id: 1, due_date: day(20), set_aside: null, estimated_value: null },
      { id: 2, due_date: day(20), set_aside: "WOSB", estimated_value: null },
      { id: 3, due_date: day(20), set_aside: "8(a)", estimated_value: null },
      { id: 4, due_date: day(1), set_aside: "WOSB", estimated_value: null },
      { id: 5, due_date: day(30), set_aside: "Total Small Business", estimated_value: "$250,000" },
    ];
    const r = rankFit(bids, ["wosb"], now);
    expect(r).toMatchObject({ total: 5, eligible: 4, notEligible: 1 });
    expect(r.top.map((x) => x.bid.id)).toEqual([2, 5, 1]);
    expect(r.top[0].reasons[0]).toMatch(/woman-owned/);
    expect(scoreFit(bids[3], ["wosb"], now).reasons.join(" ")).toMatch(/very tight/);
    expect(scoreFit(bids[2], ["wosb"], now)).toMatchObject({ eligible: false });
  });
  test("certifications from the model are whitelisted", () => {
    expect(fitCerts(["wosb", "bogus", "wosb", "8a"])).toEqual(["wosb", "8a"]);
    expect(fitCerts("wosb")).toEqual([]);
  });
});

describe("Max: bid explainer refs", () => {
  test("parses links and numbers", () => {
    expect(parseBidRef("https://www.contrax.company/bid/12345")).toEqual({ kind: "id", id: 12345 });
    expect(parseBidRef("#987")).toEqual({ kind: "id", id: 987 });
    expect(parseBidRef("https://sam.gov/opp/0123456789abcdef0123456789ABCDEF/view")).toEqual({ kind: "sam", noticeId: "0123456789abcdef0123456789abcdef" });
    expect(parseBidRef("Solicitation W9124G26CBARRACKS")).toEqual({ kind: "solicitation", number: "W9124G26CBARRACKS" });
    expect(parseBidRef("RFP: 36C24726Q0001")).toEqual({ kind: "solicitation", number: "36C24726Q0001" });
    expect(parseBidRef("")).toBeNull();
    expect(parseBidRef("what's this one about?")).toBeNull();
  });
});

describe("Max: reminder timing", () => {
  const now = Date.parse("2026-10-25T12:00:00Z");
  test("3 days before, now if closer, never in the last day", () => {
    expect(reminderAt("2026-11-10T21:00:00Z", now)?.toISOString()).toBe("2026-11-07T21:00:00.000Z");
    expect(reminderAt("2026-10-27T12:00:00Z", now)?.getTime()).toBe(now);
    expect(reminderAt("2026-10-26T06:00:00Z", now)).toBeNull();
    expect(reminderAt(null, now)).toBeNull();
  });
});
