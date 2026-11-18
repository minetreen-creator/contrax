import { createFileRoute } from "@tanstack/react-router";
import { SiteHeader } from "~/components/SiteHeader";
import { PostProjectForm } from "~/components/PostProjectForm";
import { POST_PROJECT_HEADING, POST_PROJECT_INTRO, POST_PROJECT_PATH, POST_PROJECT_STEPS } from "~/lib/private-bid-post";

/** /private-bids/post — a business posts work it needs done; reviewed before listing (see ~/lib/private-bid-post). */
const PROD_URL = "https://www.contrax.company";
const TITLE = "Post Your Project Free and Get Bids From Contractors | Contrax";
const DESC = "Need work done at your business? Post the job free. We review it, list it where contractors look for work, and bids come straight to you.";

export const Route = createFileRoute("/private-bids/post")({
  head: () => ({
    meta: [{ title: TITLE }, { name: "description", content: DESC }],
    links: [{ rel: "canonical", href: `${PROD_URL}${POST_PROJECT_PATH}` }],
  }),
  component: PostProjectPage,
});

function PostProjectPage() {
  return (
    <>
      <SiteHeader />
      <main className="bg-white px-4 py-12">
        <div className="mx-auto max-w-2xl">
          <h1 className="text-3xl font-extrabold text-slate-900">{POST_PROJECT_HEADING}</h1>
          <p className="mt-3 text-slate-700">{POST_PROJECT_INTRO}</p>
          <ol className="mt-6 list-decimal space-y-2 pl-5 text-sm text-slate-700">
            {POST_PROJECT_STEPS.map((s) => (
              <li key={s}>{s}</li>
            ))}
          </ol>
          <div className="mt-8">
            <PostProjectForm />
          </div>
          <p className="mt-6 text-sm text-slate-700">
            <a href="/private-bids" className="font-semibold text-blue-700 underline underline-offset-4">See the requests listed now →</a>
          </p>
        </div>
      </main>
    </>
  );
}
