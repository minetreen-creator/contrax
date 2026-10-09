import { learnBusinessSearch } from "~/lib/learn-radar";
import { createFileRoute } from "@tanstack/react-router";
import { SelfPacedCoursePage } from "~/components/SelfPacedCourse";
import { ADVANCED_COURSE, ADVANCED_TITLE } from "~/lib/course-advanced";

const url = "https://www.contrax.company/learn/advanced-government-contracting";
const description = "Free advanced government contracting course: pursuit strategy, evaluated value, teaming, pricing risk, performance management, and improvement. Includes quizzes, a strategy worksheet, and a completion certificate.";
export const Route = createFileRoute("/learn/advanced-government-contracting")({
  component: CoursePage,
  validateSearch: learnBusinessSearch,
  head: () => ({ meta: [{ title: `${ADVANCED_TITLE} — Free Advanced Course | Contrax` },
    { name: "description", content: description }, { property: "og:title", content: ADVANCED_TITLE },
    { property: "og:description", content: description }, { property: "og:type", content: "article" },
    { property: "og:url", content: url }, { property: "og:image", content: "https://www.contrax.company/logo-square.png" }],
    links: [{ rel: "canonical", href: url }] }),
});

function CoursePage() { return <SelfPacedCoursePage course={ADVANCED_COURSE} business={Route.useSearch()} />; }
