import { LESSONS, parseProgress } from "~/lib/course-construction";
import { INTERMEDIATE_COURSE } from "~/lib/course-intermediate";
import { ADVANCED_COURSE } from "~/lib/course-advanced";
import {
  readCourseProgress,
  courseLessonPassed,
} from "~/lib/self-paced-course";

export function launchpadLearning(get: (key: string) => string | null) {
  const beginnerDone = parseProgress(get("contrax_course_construction_v1"));
  return [
    {
      id: "beginner",
      title: "Getting Started with Government Contracting",
      level: "Beginner",
      href: "/learn/government-contracting",
      total: LESSONS.length,
      done: LESSONS.filter((lesson) => beginnerDone.includes(lesson.id)).length,
    },
    ...[INTERMEDIATE_COURSE, ADVANCED_COURSE].map((course) => {
      const progress = readCourseProgress(course, get(course.key));
      return {
        id: course.id,
        title: course.title,
        level: course.level,
        href:
          course === INTERMEDIATE_COURSE
            ? "/learn/intermediate-government-contracting"
            : "/learn/advanced-government-contracting",
        total: course.lessons.length,
        done: course.lessons.filter((lesson) =>
          courseLessonPassed(course, lesson.id, progress.answers),
        ).length,
      };
    }),
  ];
}
