import { COURSE_ID, COURSE_TITLE } from "./course-construction";
import { INTERMEDIATE_ID, INTERMEDIATE_TITLE, intermediatePassed } from "./course-intermediate";
import { ADVANCED_ID, ADVANCED_TITLE, advancedPassed } from "./course-advanced";
export function courseTitle(id: string): string | null {
  if (id === COURSE_ID) return COURSE_TITLE;
  if (id === INTERMEDIATE_ID) return INTERMEDIATE_TITLE;
  if (id === ADVANCED_ID) return ADVANCED_TITLE;
  return null;
}
export function completionCourse(body: Record<string, unknown>): { ok: true; id: string } | { ok: false; error: string } {
  const id = body.course === undefined ? COURSE_ID : body.course;
  if (id !== COURSE_ID && id !== INTERMEDIATE_ID && id !== ADVANCED_ID) return { ok: false, error: "Unknown course." };
  if (id === INTERMEDIATE_ID && !intermediatePassed(body.answers)) return { ok: false, error: "Complete all intermediate course quizzes correctly first." };
  if (id === ADVANCED_ID && !advancedPassed(body.answers)) return { ok: false, error: "Complete all advanced course quizzes correctly first." };
  return { ok: true, id };
}
