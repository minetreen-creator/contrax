import { describe, expect, test } from "bun:test";
import partTitles from "../data/far-part-titles.json";
import {
  clampToBudget,
  makeBlogTitle,
  makeClauseTitle,
  makeNaicsTitle,
  makePartTitle,
} from "./seo-titles";

const inRange = (s: string) => s.length >= 30 && s.length <= 60;

describe("seo-titles (c_title finding: every rendered title in 30-60 chars)", () => {
  test("clampToBudget leaves short text untouched", () => {
    expect(clampToBudget("Short title", 46, "t")).toBe("Short title");
  });

  test("clampToBudget trims at word boundaries and flags with an ellipsis", () => {
    const out = clampToBudget("Iron and Steel Pipe and Tube Manufacturing", 36, "t");
    expect(out.endsWith("…")).toBe(true);
    expect(out.length).toBeLessThanOrEqual(36);
  });

  test("NAICS route titles stay in 30-60 rendered chars (audit sample + extras)", () => {
    const cases: Array<[string, string]> = [
      ["8(a)", "Commercial Building Construction"], // 236220
      ["8(a)", "All Other Rubber Product Manufacturing"], // 326299
      ["8(a)", "Iron and Steel Pipe and Tube Manufacturing"], // 331210
      ["8(a)", "Rolled Steel Shape Manufacturing"], // 331221
      ["8(a)", "Saw Blade and Handtool Manufacturing"], // 332216
      ["SDVOSB", "Commercial Building Construction"],
      ["WOSB", "Rolled Steel Shape Manufacturing"],
      ["HUBZone", "Iron and Steel Pipe and Tube Manufacturing"],
    ];
    for (const [setAside, industry] of cases) {
      const t = makeNaicsTitle(setAside, industry);
      expect(inRange(t), `${setAside} / ${industry}: "${t}" (${t.length})`).toBe(true);
    }
  });

  test("clause titles stay in range even for long FAR part titles", () => {
    expect(inRange(makeClauseTitle("FAR Part 1", "Federal Acquisition Regulations System", "c1"))).toBe(true);
    const long = makeClauseTitle(
      "FAR Part 3",
      "Improper Business Practices and Personal Conflicts of Interest",
      "c3",
    );
    expect(inRange(long), `"${long}" (${long.length})`).toBe(true);
    expect(long.includes("…")).toBe(true);
  });

  // /clauses/{part} part pages (FAR Part 3 was served at 85 rendered chars).
  // Real acquisition.gov part names from src/data/far-part-titles.json.
  test("clause PART titles are pinned and stay ≤60 rendered chars", () => {
    const pinned: Array<[string, string, string]> = [
      // [label, part, expected rendered title]
      ["FAR", "1", "FAR Part 1 — Federal Acquisition Regulations… | Contrax"], // was 61 chars
      ["FAR", "3", "FAR Part 3 — Improper Business Practices and… | Contrax"], // was 85 chars
      ["FAR", "4", "FAR Part 4 — Administrative and Information… | Contrax"], // was 61 chars
      ["FAR", "5", "FAR Part 5 — Publicizing Contract Actions | Contrax"], // short name, no clamp
      ["DFARS", "203", "DFARS Part 203 — Improper Business Practices and… | Contrax"],
      ["DFARS", "252", "DFARS Part 252 — Solicitation Provisions and… | Contrax"],
    ];
    for (const [label, part, expected] of pinned) {
      const title = makePartTitle(label, part, (partTitles as Record<string, string>)[part] ?? null);
      expect(title, `part ${part}`).toBe(expected);
      expect(title.length, `part ${part}: "${title}"`).toBeLessThanOrEqual(60);
    }
  });

  test("part titles with no acquisition.gov name fall back to the short heading", () => {
    for (const [label, part] of [
      ["FAR", "20"], // curated name is "Reserved"
      ["DFARS", "220"], // curated name is "Reserved"
      ["FAR", "999"], // no curated name at all
    ] as Array<[string, string]>) {
      for (const name of [null, "Reserved"]) {
        const title = makePartTitle(label, part, name);
        expect(title).toBe(`${label} Part ${part} | Contrax`);
        expect(title.length).toBeLessThanOrEqual(60);
      }
    }
  });

  test("every curated part title renders ≤60 chars (all 107 acquisition.gov parts)", () => {
    const titles = partTitles as Record<string, string>;
    const parts = Object.keys(titles);
    expect(parts.length).toBeGreaterThan(100);
    for (const part of parts) {
      // Same regulation split as partLabel(): DFARS parts are numbered 200+.
      const label = Number(part) >= 200 ? "DFARS" : "FAR";
      const title = makePartTitle(label, part, titles[part]);
      expect(title.length, `part ${part}: "${title}" (${title.length})`).toBeLessThanOrEqual(60);
    }
  });

  test("blog titles stay in range even for long post titles", () => {
    expect(
      inRange(makeBlogTitle("8(a) Certification: A Step-by-Step Guide for Small Businesses", "8a-certification-guide")),
    ).toBe(true);
    const long = makeBlogTitle(
      "SDVOSB Government Contracts: A Practical Guide to Service-Disabled Veteran Opportunities",
      "sdvosb-government-contracts",
    );
    expect(inRange(long), `"${long}" (${long.length})`).toBe(true);
    expect(long.includes("…")).toBe(true);
  });

  test("short inputs pass through unchanged", () => {
    expect(makeBlogTitle("5 Proposal Writing Tips", "proposal-writing-tips")).toBe(
      "5 Proposal Writing Tips — Contrax Blog",
    );
    expect(makeClauseTitle("FAR Part 4", "Administrative and Information Matters", "c4")).toBe(
      "FAR Part 4 — Administrative and Information… | Contrax",
    );
  });
});