import { expect, test } from "bun:test";
import { lessonProgressEvents } from "~/lib/self-paced-course";

const set = (...ids: string[]) => new Set(ids);

test("restored progress is the baseline and records nothing", () => {
  expect(lessonProgressEvents(null, set("a", "b"), 3)).toEqual({ lessons: [], finishedAll: false });
});

test("a newly passed lesson is recorded once", () => {
  expect(lessonProgressEvents(set(), set("a"), 3)).toEqual({ lessons: ["a"], finishedAll: false });
  expect(lessonProgressEvents(set("a"), set("a"), 3)).toEqual({ lessons: [], finishedAll: false });
});

test("passing the last lesson records the lesson and finishing the course", () => {
  expect(lessonProgressEvents(set("a", "b"), set("a", "b", "c"), 3)).toEqual({ lessons: ["c"], finishedAll: true });
});

test("a course already finished before this visit never re-fires", () => {
  expect(lessonProgressEvents(set("a", "b", "c"), set("a", "b", "c"), 3)).toEqual({ lessons: [], finishedAll: false });
});

test("changing an answer so a lesson un-passes records nothing", () => {
  expect(lessonProgressEvents(set("a", "b"), set("a"), 3)).toEqual({ lessons: [], finishedAll: false });
});
