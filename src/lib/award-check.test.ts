import { describe, expect, test } from "bun:test";
import {
  awardOutcome,
  awardSearchUrl,
  displayCompanyName,
  formatAwardAmount,
  isOwnAward,
  normalizeSolicitationNumber,
  parseAwardDetail,
  pickAwardNotice,
} from "./award-check";
import { awardResultsHtml, awardResultsSubject, type AwardEmailItem } from "./email";

// Shape taken from the SAM.gov opportunity detail fixture (fixtures/sam-trades/detail-r602.json).
const detail = {
  data2: {
    award: {
      date: "2026-09-17",
      amount: "7267320.00",
      number: "36C24426D0113",
      awardee: { name: "TRANSMEDICS, INC.", ueiSAM: "D3U8WASW7CB8" },
    },
  },
};

describe("pickAwardNotice", () => {
  const items = [
    { _id: "sol1", type: { value: "Solicitation" }, solicitationNumber: "W912C3-26-B-A003" },
    { _id: "old", type: { value: "Award Notice" }, solicitationNumber: "w912c326ba003", publishDate: "2026-08-01" },
    { _id: "new", type: { value: "Award Notice" }, solicitationNumber: "W912C326BA003", publishDate: "2026-09-01" },
    { _id: "other", type: { value: "Award Notice" }, solicitationNumber: "W912C326BA0039" },
  ];

  test("picks the newest award notice with the same solicitation number", () => {
    expect(pickAwardNotice(items, "W912C3-26-B-A003")).toEqual({ noticeId: "new" });
  });

  test("ignores solicitations, other numbers and empty input", () => {
    expect(pickAwardNotice(items.slice(0, 1), "W912C326BA003")).toBeNull();
    expect(pickAwardNotice(items.slice(3), "W912C326BA003")).toBeNull();
    expect(pickAwardNotice(items, "")).toBeNull();
  });

  test("normalizes case, dashes and spaces", () => {
    expect(normalizeSolicitationNumber(" W912-C3 26.b_a003 ")).toBe("w912c326ba003");
  });
});

describe("parseAwardDetail", () => {
  test("reads winner, UEI, amount, date and contract number", () => {
    expect(parseAwardDetail(detail, "n1")).toEqual({
      noticeId: "n1",
      awardeeName: "TRANSMEDICS, INC.",
      awardeeUei: "D3U8WASW7CB8",
      amount: 7267320,
      awardDate: "2026-09-17",
      contractNumber: "36C24426D0113",
    });
  });

  test("no winner name means no award; missing amount stays null", () => {
    expect(parseAwardDetail({ data2: { award: { awardee: { name: null } } } }, "n")).toBeNull();
    expect(parseAwardDetail({}, "n")).toBeNull();
    const noAmount = parseAwardDetail({ data2: { award: { awardee: { name: "ACME" }, amount: "" } } }, "n");
    expect(noAmount?.amount).toBeNull();
    expect(noAmount?.awardDate).toBeNull();
  });
});

describe("helpers", () => {
  test("isOwnAward compares UEIs case-insensitively and never matches blanks", () => {
    expect(isOwnAward("D3U8WASW7CB8", " d3u8wasw7cb8 ")).toBe(true);
    expect(isOwnAward("D3U8WASW7CB8", "OTHER")).toBe(false);
    expect(isOwnAward(null, null)).toBe(false);
    expect(isOwnAward("", "")).toBe(false);
  });

  test("awardOutcome", () => {
    expect(awardOutcome({ ownAward: true, memberUeiKnown: true, pursuitStatus: "evaluating" })).toBe("won");
    expect(awardOutcome({ ownAward: false, memberUeiKnown: true, pursuitStatus: "submitted" })).toBe("lost");
    expect(awardOutcome({ ownAward: false, memberUeiKnown: true, pursuitStatus: "lost" })).toBe("lost");
    expect(awardOutcome({ ownAward: false, memberUeiKnown: false, pursuitStatus: "submitted" })).toBe("submitted");
    expect(awardOutcome({ ownAward: false, memberUeiKnown: true, pursuitStatus: "evaluating" })).toBe("saved");
  });

  test("formatting", () => {
    expect(formatAwardAmount(7267320)).toBe("$7,267,320");
    expect(formatAwardAmount(null)).toBeNull();
    expect(formatAwardAmount(0)).toBeNull();
    expect(displayCompanyName("ACME CLEANING SERVICES, LLC")).toBe("Acme Cleaning Services, LLC");
    expect(displayCompanyName("Acme Cleaning")).toBe("Acme Cleaning");
  });

  test("search URL looks up past notices by solicitation number", () => {
    const url = awardSearchUrl(" W912C326BA003 ");
    expect(url).toContain("q=W912C326BA003");
    expect(url).toContain("is_active=false");
  });
});

describe("award results email", () => {
  const base: AwardEmailItem = {
    bidId: 1,
    title: "Janitorial Services <Fort Bragg>",
    agency: "Army",
    awardeeName: "ACME CLEANING, LLC",
    amount: 412000,
    awardDate: "2026-09-17",
    outcome: "saved",
  };

  test("saved: names the winner and amount, escapes the title", () => {
    const html = awardResultsHtml([base]);
    expect(html).toContain("Acme Cleaning, LLC");
    expect(html).toContain("$412,000");
    expect(html).toContain("Sep 17, 2026");
    expect(html).toContain("Janitorial Services &lt;Fort Bragg&gt;");
    expect(html).not.toContain("You won.");
    expect(awardResultsSubject([base])).toBe("Award posted: Janitorial Services <Fort Bragg>");
  });

  test("lost: benchmark and debrief link", () => {
    const html = awardResultsHtml([{ ...base, outcome: "lost" }]);
    expect(html).toContain("Not this time.");
    expect(html).toContain("/losses");
  });

  test("submitted without a UEI on file never claims a loss", () => {
    const html = awardResultsHtml([{ ...base, outcome: "submitted" }]);
    expect(html).not.toContain("Not this time.");
    expect(html).toContain("If that&#039;s you");
    expect(html).toContain("/losses");
  });

  test("won: congratulations and subject", () => {
    const items = [{ ...base, outcome: "won" as const }, base];
    expect(awardResultsHtml(items)).toContain("You won.");
    expect(awardResultsSubject(items)).toContain("You won a government contract");
    expect(awardResultsSubject([base, base])).toBe("2 bids in your pipeline were awarded — Contrax");
  });
});
