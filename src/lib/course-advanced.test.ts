import { describe, expect, test } from "bun:test";
import { ADVANCED_COURSE, ADVANCED_ID, ADVANCED_TITLE, advancedPassed } from "./course-advanced";
import { INTERMEDIATE_COURSE, INTERMEDIATE_ID } from "./course-intermediate";
import { COURSE_ID, COURSE_TITLE } from "./course-construction";
import { completionCourse, courseTitle } from "./course-catalog";
import { coursePassed, readCourseProgress, courseWorksheet } from "./self-paced-course";
const correct = Object.fromEntries(ADVANCED_COURSE.lessons.map(l => [l.id, l.quiz.map(q => q.answer)]));
describe("advanced course progression", () => {
  test("requires every advanced answer and preserves certificate identities", () => {
    expect(advancedPassed(correct)).toBe(true);
    expect(completionCourse({ course: ADVANCED_ID, answers: correct })).toEqual({ ok: true, id: ADVANCED_ID });
    expect(courseTitle(ADVANCED_ID)).toBe(ADVANCED_TITLE);
    expect(courseTitle(COURSE_ID)).toBe(COURSE_TITLE);
    expect(courseTitle(INTERMEDIATE_ID)).toBe(INTERMEDIATE_COURSE.title);
    for (const l of ADVANCED_COURSE.lessons) {
      expect(advancedPassed({ ...correct, [l.id]: [] })).toBe(false);
      expect(advancedPassed({ ...correct, [l.id]: l.quiz.map(q => (q.answer + 1) % q.options.length) })).toBe(false);
      for (const q of l.quiz) expect(q.options[q.answer]).toBeTruthy();
    }
    for (const value of [null, [], {}, "invalid", correct.capture]) expect(advancedPassed(value)).toBe(false);
    expect(completionCourse({ course: ADVANCED_ID }).ok).toBe(false);
    expect(coursePassed(INTERMEDIATE_COURSE, correct)).toBe(false);
  });
  test("isolates progress and defensively reads saved notes", () => {
    expect(ADVANCED_COURSE.key).not.toBe(INTERMEDIATE_COURSE.key);
    const saved = readCourseProgress(ADVANCED_COURSE, JSON.stringify({ answers: { ...correct, capture: [99, -1], unknown: [0] }, notes: { capture: "x".repeat(5000), unknown: "ignore" } }));
    expect(saved.answers.capture).toEqual([null, null]);
    expect(saved.answers.unknown).toBeUndefined();
    expect(saved.notes.capture.length).toBe(4000);
    expect(saved.notes.unknown).toBeUndefined();
    expect(readCourseProgress(ADVANCED_COURSE, "{bad")).toEqual({ answers: {}, notes: {} });
  });
  test("exports the learner's capstone notes and all section prompts", () => {
    const worksheet = courseWorksheet(ADVANCED_COURSE, { capture: "My pursuit gates" });
    expect(worksheet).toContain(ADVANCED_TITLE);
    expect(worksheet).toContain("My pursuit gates");
    for (const l of ADVANCED_COURSE.lessons) {
      expect(worksheet).toContain(l.title);
      expect(worksheet).toContain(l.worksheet);
      expect(l.sources.every(s => s.url.startsWith("https://"))).toBe(true);
    }
  });
});
