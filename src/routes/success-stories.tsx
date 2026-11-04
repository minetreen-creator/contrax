import { createFileRoute, notFound } from "@tanstack/react-router";
import { createServerFn } from "@tanstack/react-start";
import { SiteHeader } from "~/components/SiteHeader";
import { outcomeLabel, storiesPageIsLive, storyByline, type PublishedStory } from "~/lib/success-stories";

/**
 * /success-stories (owner 2026-11-04). Approved stories from real customers,
 * named the way each person chose. Hidden (404) until STORIES_TO_PUBLISH
 * approved stories exist, so the page is never empty or padded.
 */
const getStories = createServerFn({ method: "GET" }).handler(async (): Promise<PublishedStory[]> => {
  const { listPublishedStories } = await import("~/lib/success-stories.server");
  try {
    return await listPublishedStories();
  } catch (e) {
    console.error("[success-stories] read failed:", e);
    return [];
  }
});

export const Route = createFileRoute("/success-stories")({
  loader: async () => {
    const stories = await getStories();
    if (!storiesPageIsLive(stories.length)) throw notFound();
    return { stories };
  },
  component: SuccessStoriesPage,
  head: () => ({
    meta: [
      { title: "Success Stories | Contrax" },
      { name: "description", content: "Contractors who found, bid on and won government work with Contrax, in their own words." },
    ],
    links: [{ rel: "canonical", href: "https://www.contrax.company/success-stories" }],
  }),
});

function SuccessStoriesPage() {
  const { stories } = Route.useLoaderData();
  return (
    <div className="min-h-screen bg-slate-50 text-slate-900 dark:bg-slate-950 dark:text-white">
      <SiteHeader />
      <main className="mx-auto max-w-3xl px-4 py-10 sm:py-14">
        <h1 className="text-3xl font-bold">Success stories</h1>
        <p className="mt-3 text-slate-600 dark:text-slate-300">Contractors who found government work through Contrax, in their own words.</p>
        <div className="mt-8 space-y-5">
          {stories.map((s) => (
            <article key={s.id} className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm dark:border-slate-800 dark:bg-slate-900">
              <p className="text-xs font-semibold uppercase tracking-wide text-blue-700 dark:text-blue-300">{outcomeLabel(s.outcome)}</p>
              <p className="mt-2 whitespace-pre-line text-slate-800 dark:text-slate-100">"{s.story}"</p>
              <p className="mt-3 text-sm font-medium text-slate-600 dark:text-slate-400">{storyByline(s)}</p>
            </article>
          ))}
        </div>
        <p className="mt-10 text-center text-sm text-slate-600 dark:text-slate-400">
          Found work through Contrax? <a href="/share-your-story" className="font-semibold text-blue-700 underline dark:text-blue-300">Share your story</a>
        </p>
      </main>
    </div>
  );
}
