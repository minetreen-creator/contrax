import { describe, expect, test } from "bun:test";
import { COURSE_ID, COURSE_TITLE } from "./course-construction";
import { completionCourse, courseTitle } from "./course-catalog";
import { INTERMEDIATE_ID, INTERMEDIATE_TITLE, INTERMEDIATE_LESSONS, INTERMEDIATE_MINUTES, intermediatePassed, readIntermediateProgress, bidPlanText } from "./course-intermediate";
const correct = () => Object.fromEntries(INTERMEDIATE_LESSONS.map(l => [l.id, l.quiz.map(q => q.answer)]));
describe("Intermediate course completion and separate identity", () => {
  test("all questions required, wrong and partial answers refused", () => {
    expect(intermediatePassed(correct())).toBe(true);
    for (const invalid of [null, [], {}, { decision: [1, 2] }]) expect(intermediatePassed(invalid)).toBe(false);
    for (const l of INTERMEDIATE_LESSONS) {
      const answers = correct(); answers[l.id][0] = (answers[l.id][0] + 1) % l.quiz[0].options.length;
      expect(intermediatePassed(answers)).toBe(false);
    }
  });
  test("legacy submissions and titles preserved; intermediate certificates distinct", () => {
    expect(completionCourse({})).toEqual({ ok: true, id: COURSE_ID });
    expect(completionCourse({ course: INTERMEDIATE_ID })).toMatchObject({ ok: false });
    expect(completionCourse({ course: INTERMEDIATE_ID, answers: correct() })).toEqual({ ok: true, id: INTERMEDIATE_ID });
    expect(completionCourse({ course: "arbitrary" })).toMatchObject({ ok: false });
    expect(courseTitle(COURSE_ID)).toBe(COURSE_TITLE);
    expect(courseTitle(INTERMEDIATE_ID)).toBe(INTERMEDIATE_TITLE);
    expect(courseTitle("arbitrary")).toBeNull();
  });
  test("defensive storage prevents foreign progress and malformed values", () => {
    expect(readIntermediateProgress("invalid")).toEqual({ answers: {}, notes: {} });
    const value = readIntermediateProgress(JSON.stringify({ answers: { decision: [999, "2"], where: [1, 0] }, notes: { decision: "x".repeat(5000), where: "intro notes" } }));
    expect(value.answers).toEqual({ decision: [null, null] });
    expect(value.notes.decision.length).toBe(4000);
    expect(value.notes.where).toBeUndefined();
    expect(intermediatePassed(readIntermediateProgress(JSON.stringify({ answers: correct() })).answers)).toBe(true);
  });
  test("worksheet retains learner work, blank prompts and distinct lessons", () => {
    const worksheet = bidPlanText({ decision: "Conditional bid: resolve insurance" });
    expect(worksheet).toContain("Conditional bid: resolve insurance");
    expect(worksheet).toContain("[Add your notes]");
    expect(new Set(INTERMEDIATE_LESSONS.map(l => l.id)).size).toBe(6);
    expect(INTERMEDIATE_MINUTES).toBe(45);
  });
});
