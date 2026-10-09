import { learnBusinessSearch } from "~/lib/learn-radar";
import { createFileRoute } from "@tanstack/react-router";
import { SelfPacedCoursePage } from "~/components/SelfPacedCourse";
import { INTERMEDIATE_COURSE, INTERMEDIATE_TITLE } from "~/lib/course-intermediate";

const url = "https://www.contrax.company/learn/intermediate-government-contracting";
const description = "Free intermediate government contracting course for all trades: bid decisions, compliance checklists, pricing, proposal evidence, submission, and follow-up. Includes quizzes, a bid-plan worksheet, and a completion certificate.";
export const Route = createFileRoute("/learn/intermediate-government-contracting")({
  component: CoursePage,
  validateSearch: learnBusinessSearch,
  head: () => ({ meta: [{ title: `${INTERMEDIATE_TITLE} — Free Intermediate Course | Contrax` },
    { name: "description", content: description }, { property: "og:title", content: INTERMEDIATE_TITLE },
    { property: "og:description", content: description }, { property: "og:type", content: "article" },
    { property: "og:url", content: url }, { property: "og:image", content: "https://www.contrax.company/logo-square.png" }],
    links: [{ rel: "canonical", href: url }] }),
});

function CoursePage() { return <SelfPacedCoursePage course={INTERMEDIATE_COURSE} business={Route.useSearch()} />; }
