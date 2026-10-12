import { createFileRoute } from "@tanstack/react-router";
import { SiteHeader } from "~/components/SiteHeader";

const title = "The Story Behind Contrax | Nathaniel Minetree";
const description = "Why Nathaniel Minetree founded Contrax: helping smaller businesses find government opportunities, understand requirements, and have a fair chance to compete.";
const url = "https://www.contrax.company/our-story";
const portrait = "https://www.contrax.company/images/nathaniel-minetree-portrait.webp";

export const Route = createFileRoute("/our-story")({
  component: OurStoryPage,
  head: () => ({
    meta: [
      { title },
      { name: "description", content: description },
      { property: "og:title", content: title },
      { property: "og:description", content: description },
      { property: "og:url", content: url },
      { property: "og:type", content: "website" },
      { property: "og:image", content: portrait },
      { property: "og:image:alt", content: "Portrait of Nathaniel Minetree, founder and CEO of Contrax LLC" },
      { name: "twitter:card", content: "summary_large_image" },
      { name: "twitter:title", content: title },
      { name: "twitter:description", content: description },
      { name: "twitter:image", content: portrait },
    ],
    links: [{ rel: "canonical", href: url }],
  }),
});

function OurStoryPage() {
  return (
    <div className="min-h-screen bg-slate-50 text-slate-900 dark:bg-slate-950 dark:text-white">
      <SiteHeader />
      <main className="mx-auto max-w-[1120px] px-4 py-10 sm:px-6 sm:py-16">
        <a href="/" className="text-sm text-blue-700 underline dark:text-blue-300">← Back to home</a>
        <div className="mt-8 grid items-start gap-10 lg:grid-cols-[320px_1fr] lg:gap-16">
          <figure>
            <img src="/images/nathaniel-minetree-portrait.webp" alt="Nathaniel Minetree, founder and CEO of Contrax LLC" width={1086} height={1448} fetchPriority="high" className="mx-auto w-full max-w-xs rounded-2xl object-cover shadow-lg" />
            <figcaption className="mt-5 text-center lg:text-left">
              <p className="text-lg font-bold">Nathaniel Minetree</p>
              <p className="mt-1 text-sm text-slate-600 dark:text-slate-300">Founder &amp; CEO, Contrax LLC</p>
            </figcaption>
          </figure>
          <article aria-labelledby="story-title">
            <p className="text-sm font-semibold uppercase tracking-widest text-blue-700 dark:text-blue-300">A note from the founder</p>
            <h1 id="story-title" className="mt-3 font-serif text-4xl font-bold leading-tight sm:text-5xl">The Story Behind Contrax</h1>
            <p className="mt-6 text-xl font-semibold leading-relaxed sm:text-2xl">I started Contrax because I was tired of seeing the “little guy” lose to big companies.</p>
            <div className="mt-6 space-y-5 text-lg leading-relaxed text-slate-700 dark:text-slate-300">
              <p>A small business owner can have the skill, experience, and determination to do excellent work. But competing for government contracts also takes time: finding opportunities, understanding requirements, and deciding which bids are worth pursuing. For someone already handling customers, employees, and bills, that can be a lot to take on.</p>
              <p>I wanted to build something that could help.</p>
              <p>Contrax grew from a simple belief: smaller businesses deserve a fair chance to compete. I want to help owners find opportunities and understand them well enough to make their own informed decisions.</p>
              <p>That mission also shaped our free government contracting courses. All three are free for everyone, and they will stay free. Learning how to get started should be accessible, even when someone isn’t ready to pay for a business tool.</p>
              <p>Contrax is an independent, founder-led company. I set its direction and oversee its development, using AI tools to support research, software development, and operations. I remain responsible for the platform, its promises, and the people we serve.</p>
              <p>I’m still building and improving Contrax. I listen to feedback because I want it to solve practical problems for the business owners who use it.</p>
              <p>I can’t promise anyone a government contract. What I can do is keep working to make opportunities easier to find, requirements easier to understand, and the path forward a little clearer.</p>
              <p className="font-semibold text-slate-900 dark:text-white">I built Contrax for the little guy—because a smaller company deserves a chance to do big things.</p>
            </div>
            <p className="mt-8 font-semibold">Nathaniel Minetree<br /><span className="text-sm font-normal text-slate-600 dark:text-slate-300">Founder &amp; CEO, Contrax LLC</span></p>
            <div className="mt-10 flex flex-wrap gap-4">
              <a href="/radar" className="rounded-xl bg-blue-700 px-5 py-3 font-semibold text-white hover:bg-blue-800">Find opportunities →</a>
              <a href="/learn" className="rounded-xl border border-slate-300 px-5 py-3 font-semibold hover:bg-slate-100 dark:border-slate-700 dark:hover:bg-slate-900">Explore the free courses →</a>
            </div>
          </article>
        </div>
      </main>
      <footer className="mx-auto max-w-[1120px] border-t border-slate-200 px-4 py-6 text-sm dark:border-slate-800 sm:px-6">
        <a href="/" className="hover:underline">Contrax home</a>
        <span className="mx-3">·</span>
        <a href="/from-the-ceo" className="hover:underline">From the CEO</a>
        <span className="mx-3">·</span>
        <a href="/pricing" className="hover:underline">Pricing</a>
      </footer>
    </div>
  );
}
