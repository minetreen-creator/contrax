import { createFileRoute } from "@tanstack/react-router";
import { SiteHeader } from "~/components/SiteHeader";
import { CEOPosts } from "~/components/CEOPosts";

const title = "From the CEO | Contrax";
const description = "Updates from Nathaniel Minetree, founder and CEO of Contrax: our new 7-day trial, our CRM, free courses, and work with Rhode Island SBA.";
const url = "https://www.contrax.company/from-the-ceo";

export const Route = createFileRoute("/from-the-ceo")({
  component: CEOPage,
  head: () => ({
    meta: [
      { title },
      { name: "description", content: description },
      { property: "og:title", content: title },
      { property: "og:description", content: description },
      { property: "og:url", content: url },
      { property: "og:type", content: "website" },
    ],
    links: [{ rel: "canonical", href: url }],
  }),
});

function CEOPage() {
  return (
    <div className="min-h-screen bg-slate-50 text-slate-900 dark:bg-slate-950 dark:text-white">
      <SiteHeader />
      <main className="pb-12">
        <div className="mx-auto max-w-[1120px] px-4 pt-10 sm:px-6">
          <a href="/" className="text-sm text-blue-700 underline dark:text-blue-300">← Back to home</a>
          <h1 className="mt-5 text-3xl font-bold sm:text-4xl">From the CEO</h1>
          <p className="mt-3 max-w-2xl text-slate-600 dark:text-slate-300">News, milestones, and the reasons behind what we’re building at Contrax.</p>
        </div>
        <div className="mx-auto mt-5 max-w-[1120px] px-4 sm:px-6">
          <a href="/our-story" className="font-semibold text-blue-700 underline underline-offset-4 dark:text-blue-300">Read my story: why I started Contrax →</a>
        </div>
        <CEOPosts />
      </main>
      <footer className="mx-auto max-w-[1120px] border-t border-slate-200 px-4 py-6 text-sm dark:border-slate-800 sm:px-6">
        <a href="/" className="hover:underline">Contrax home</a>
        <span className="mx-3">·</span>
        <a href="/pricing" className="hover:underline">Pricing</a>
        <span className="mx-3">·</span>
        <a href="/learn" className="hover:underline">Free courses</a>
      </footer>
    </div>
  );
}
