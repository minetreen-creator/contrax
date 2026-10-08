import type { Lesson } from "./course-construction";
export type CourseAnswers = Record<string, (number | null)[]>;
export type PracticeLesson = Lesson & { exercise: string; worksheet: string };
export interface SelfPacedCourse {
  id: string; key: string; title: string; level: string; minutes: number;
  lessons: PracticeLesson[]; summary: string; prerequisiteHref: string; prerequisiteLabel: string;
  worksheetLabel: string; worksheetFile: string; nextHref?: string; nextTitle?: string;
}
export function courseLessonPassed(course: SelfPacedCourse, id: string, answers: CourseAnswers): boolean {
  const lesson = course.lessons.find(l => l.id === id);
  return !!lesson && lesson.quiz.every((q, i) => answers[id]?.[i] === q.answer);
}
export function coursePassed(course: SelfPacedCourse, value: unknown): boolean {
  return !!value && typeof value === "object" && !Array.isArray(value) && course.lessons.every(l => courseLessonPassed(course, l.id, value as CourseAnswers));
}
export function readCourseProgress(course: SelfPacedCourse, raw: string | null): { answers: CourseAnswers; notes: Record<string, string> } {
  const result: { answers: CourseAnswers; notes: Record<string, string> } = { answers: {}, notes: {} };
  try {
    const value = JSON.parse(raw || "{}");
    for (const l of course.lessons) {
      const answers = value?.answers?.[l.id];
      if (Array.isArray(answers)) result.answers[l.id] = l.quiz.map((q, i) => Number.isInteger(answers[i]) && answers[i] >= 0 && answers[i] < q.options.length ? answers[i] : null);
      if (typeof value?.notes?.[l.id] === "string") result.notes[l.id] = value.notes[l.id].slice(0, 4000);
    }
  } catch { /* Invalid storage starts fresh. */ }
  return result;
}
export function courseWorksheet(course: SelfPacedCourse, notes: Record<string, string>): string {
  return `${course.title}\nContrax practice worksheet — not a submitted proposal\n\nOpportunity/reference: ____________________\nOfficial source: ____________________\n\n` + course.lessons.map((l, i) => `${i + 1}. ${l.title}\n${l.worksheet}\n${notes[l.id]?.trim() || "[Add your notes]"}`).join("\n\n");
}
