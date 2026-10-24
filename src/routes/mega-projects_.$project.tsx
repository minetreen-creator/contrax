import { createFileRoute } from "@tanstack/react-router";
import { SeoLanding, seoHead } from "~/lib/seo-landing";
import { MegaProjectView, getMegaProjectData } from "~/lib/mega-project-landing";

// /mega-projects/{slug} — one big private build: sourced facts, how to get on
// the job, and live public bids from the buyers around the site.
export const Route = createFileRoute("/mega-projects_/$project")({
  loader: ({ params }) => getMegaProjectData({ data: { slug: params.project } }),
  head: ({ loaderData }) => {
    const p = loaderData?.project;
    const head = seoHead({
      title: p ? `${p.name}: Subcontracting and Nearby Bids | Contrax` : "Mega-Project Leads | Contrax",
      description: p
        ? `${p.owner}'s ${p.place}, ${p.stateCode} project: who is building it, how small contractors get on the job, and open public bids from the buyers around the site.`
        : "Big private construction projects and how small contractors get work on them.",
      canonical: p ? `https://www.contrax.company/mega-projects/${p.slug}` : "https://www.contrax.company/mega-projects",
    });
    if (!p) {
      head.meta = head.meta.map((m) => ("name" in m && m.name === "robots" ? { name: "robots", content: "noindex, follow" } : m));
    }
    return head;
  },
  component: MegaProjectPage,
});

function MegaProjectPage() {
  const data = Route.useLoaderData();
  const p = data.project;
  return (
    <SeoLanding
      eyebrow={p ? `Mega-project · ${p.place}, ${p.stateCode}` : "Mega-project"}
      headline={p?.name ?? "Project not found"}
      subhead={p?.summary ?? "We don't track that project. See the full list of mega-projects."}
      radarHref={p ? `/radar?state=${p.stateCode}` : "/radar"}
      radarLabel={p ? `Search all bids in ${p.stateCode} with Contract Radar` : "Search every bid with Contract Radar"}
      signupSource="local_page"
      signupState={p?.stateCode}
      honesty={
        <>
          This is a private project: its trade work is bought by the owner's contractors, not posted as a public bid. Project facts come from the
          linked public sources; the nearby bids are a live query of open public solicitations. Always confirm details on the official notice.
        </>
      }
    >
      <MegaProjectView data={data} />
    </SeoLanding>
  );
}
