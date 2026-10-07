import { describe, expect, test } from "bun:test";
import { ASK_FALLBACK, COURSE_MINUTES, LESSONS, askSystemPrompt, courseText, parseProgress, validateCompletion } from "./course-construction";

describe("construction course content (owner 2026-10-07)", () => {
  test("five lessons, unique ids, about 15 minutes", () => {
    expect(LESSONS.length).toBe(5);
    expect(new Set(LESSONS.map((l) => l.id)).size).toBe(5);
    expect(COURSE_MINUTES).toBe(15);
  });

  test("every quiz answer points at a real option and every lesson cites an https source", () => {
    for (const l of LESSONS) {
      expect(l.quiz.length).toBeGreaterThanOrEqual(2);
      for (const q of l.quiz) {
        expect(q.answer).toBeGreaterThanOrEqual(0);
        expect(q.answer).toBeLessThan(q.options.length);
        expect(q.why.length).toBeGreaterThan(10);
      }
      expect(l.sources.length).toBeGreaterThan(0);
      for (const s of l.sources) expect(s.url.startsWith("https://")).toBe(true);
    }
  });

  test("the AI helper is confined to the course text and has a fixed fallback", () => {
    const p = askSystemPrompt();
    for (const l of LESSONS) expect(courseText()).toContain(l.title);
    expect(p).toContain("ONLY the course text");
    expect(p).toContain(ASK_FALLBACK);
  });

  test("completion form validation", () => {
    expect(validateCompletion({ name: "  Pat   Lee ", email: "Pat@Example.com", state: "ri" })).toEqual({
      ok: true,
      value: { name: "Pat Lee", email: "pat@example.com", state: "RI" },
    });
    expect(validateCompletion({ name: "P", email: "pat@example.com" }).ok).toBe(false);
    expect(validateCompletion({ name: "Pat", email: "nope" }).ok).toBe(false);
    expect(validateCompletion({ name: "Pat", email: "pat@example.com", state: "Rhode Island" }).ok).toBe(false);
  });

  test("stored progress is read defensively", () => {
    expect(parseProgress(null)).toEqual([]);
    expect(parseProgress("not json")).toEqual([]);
    expect(parseProgress(JSON.stringify(["where", "bogus", "where", 5, "set-asides"]))).toEqual(["where", "set-asides"]);
  });
});
