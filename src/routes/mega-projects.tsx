import { createFileRoute } from "@tanstack/react-router";
import { SeoLanding, seoHead } from "~/lib/seo-landing";
import { MegaProjectIndexView } from "~/lib/mega-project-landing";

// /mega-projects — big private builds (plants, data centers) whose subcontract
// work never posts as a public bid (src/lib/mega-projects.ts).
export const Route = createFileRoute("/mega-projects")({
  head: () =>
    seoHead({
      title: "Mega-Project Leads for Small Contractors | Contrax",
      description:
        "Big private construction projects — plants, data centers — with who is building them, how small contractors get on the job, and the public bids around each site.",
      canonical: "https://www.contrax.company/mega-projects",
    }),
  component: MegaProjects,
});

function MegaProjects() {
  return (
    <SeoLanding
      eyebrow="Mega-project leads"
      headline="Big private projects, and how to get work on them"
      subhead="Billion-dollar plants and data centers buy their trade work through a general contractor, so it never shows up as a public bid. We track the big ones, who is building them, and the public work they bring nearby."
      radarHref="/radar"
      radarLabel="Search every public bid with Contract Radar"
      signupSource="local_page"
      honesty={<>Every project fact links to its public source. Fields we couldn't confirm, like an unannounced general contractor, say so.</>}
    >
      <MegaProjectIndexView />
    </SeoLanding>
  );
}
