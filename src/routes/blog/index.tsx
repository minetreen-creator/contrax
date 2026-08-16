import { createFileRoute } from "@tanstack/react-router";
import { BLOG_POSTS, formatBlogDate } from "~/lib/blog";

const PROD_URL = "https://www.contrax.company";
const TITLE = "Contrax Blog — Government Contracting Insights";
const DESC =
  "Practical guides and insights on government contracting for 8(a), SDVOSB, WOSB, and HUBZone-certified small businesses — finding set-aside contracts, certification, and proposal writing.";

export const Route = createFileRoute("/blog/")({
  head: () => ({
    meta: [
      { title: TITLE },
      { name: "description", content: DESC },
      { name: "robots", content: "index, follow" },
      // Open Graph
      { property: "og:type", content: "website" },
      { property: "og:url", content: `${PROD_URL}/blog` },
      { property: "og:title", content: TITLE },
      { property: "og:description", content: DESC },
      { property: "og:image", content: `${PROD_URL}/logo-square.png` },
      { property: "og:image:type", content: "image/png" },
      { property: "og:image:width", content: "1200" },
      { property: "og:image:height", content: "630" },
      { property: "og:site_name", content: "Contrax" },
      // Twitter Card
      { name: "twitter:card", content: "summary_large_image" },
      { name: "twitter:title", content: TITLE },
      { name: "twitter:description", content: DESC },
      { name: "twitter:image", content: `${PROD_URL}/logo-square.png` },
    ],
    links: [{ rel: "canonical", href: `${PROD_URL}/blog` }],
  }),
  component: BlogIndexPage,
});

function BlogIndexPage() {
  return (
    <div className="min-h-screen bg-slate-50">
      <header className="border-b border-slate-800 bg-slate-900">
        <div className="mx-auto flex max-w-7xl items-center justify-between px-6 py-5">
          <a href="/">
            <img src="/logo.png" alt="Contrax" className="h-9 w-auto" />
          </a>
          <nav className="flex items-center gap-5 text-sm">
            <a href="/" className="text-gray-400 transition-colors hover:text-white">Home</a>
            <a href="/learn" className="text-gray-400 transition-colors hover:text-white">Guides</a>
            <a href="/pricing" className="text-gray-400 transition-colors hover:text-white">Pricing</a>
            <a
              href="/signup"
              className="rounded-lg bg-amber-500 px-4 py-2 font-semibold text-white transition-colors hover:bg-amber-400"
            >
              Start Free Trial
            </a>
          </nav>
        </div>
      </header>

      <section className="bg-slate-900 pb-16 pt-14 sm:pt-20">
        <div className="mx-auto max-w-7xl px-6">
          <div className="mx-auto max-w-3xl text-center">
            <p className="text-sm font-semibold uppercase tracking-widest text-amber-400">The Contrax Blog</p>
            <h1 className="mt-3 text-3xl font-bold tracking-tight text-white sm:text-5xl">
              Government Contracting Insights
            </h1>
            <p className="mt-4 text-lg text-blue-100/70">
              Practical advice for 8(a), SDVOSB, WOSB, and HUBZone-certified small businesses — finding the right
              opportunities, earning certification, and writing proposals that win.
            </p>
          </div>
        </div>
      </section>

      <main className="mx-auto max-w-7xl px-6 py-14 sm:py-20">
        <div className="grid gap-8 md:grid-cols-2 lg:grid-cols-3">
          {BLOG_POSTS.map((post) => (
            <article
              key={post.slug}
              className="flex flex-col rounded-2xl border border-slate-200 bg-white p-6 shadow-sm transition-all hover:-translate-y-1 hover:border-blue-200 hover:shadow-lg"
            >
              <p className="text-sm text-slate-500">
                {formatBlogDate(post.date)} · {post.readMinutes} min read
              </p>
              <h2 className="mt-3 text-xl font-bold leading-snug text-slate-900">
                <a href={`/blog/${post.slug}`} className="transition-colors hover:text-blue-600">
                  {post.title}
                </a>
              </h2>
              <p className="mt-3 flex-1 text-sm leading-relaxed text-slate-600">{post.excerpt}</p>
              {post.tags.length > 0 && (
                <div className="mt-4 flex flex-wrap gap-2">
                  {post.tags.map((tag) => (
                    <span
                      key={tag}
                      className="rounded-full bg-blue-50 px-2.5 py-1 text-xs font-medium text-blue-700"
                    >
                      {tag}
                    </span>
                  ))}
                </div>
              )}
              <a
                href={`/blog/${post.slug}`}
                className="mt-5 inline-flex items-center gap-1 text-sm font-semibold text-blue-600 transition-colors hover:text-blue-500"
              >
                Read more
                <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M13 7l5 5m0 0l-5 5m5-5H6" />
                </svg>
              </a>
            </article>
          ))}
        </div>
      </main>

      <footer className="border-t border-gray-800 bg-slate-900 py-10">
        <div className="mx-auto flex max-w-7xl flex-col items-center justify-between gap-4 px-6 sm:flex-row">
          <div className="flex items-center gap-2">
            <img src="/logo.png" alt="Contrax" className="h-7 w-auto" />
          </div>
          <p className="text-sm text-gray-400">&copy; {new Date().getFullYear()} Contrax. All rights reserved.</p>
          <div className="flex items-center gap-5">
            <a href="/" className="text-sm text-gray-400 transition-colors hover:text-white">Home</a>
            <a href="/blog" className="text-sm text-gray-400 transition-colors hover:text-white">Blog</a>
            <a href="/clauses" className="text-sm text-gray-400 transition-colors hover:text-white">FAR Clause Library</a>
            <a href="/privacy" className="text-sm text-gray-400 transition-colors hover:text-white">Privacy Policy</a>
            <a href="/terms" className="text-sm text-gray-400 transition-colors hover:text-white">Terms of Service</a>
            <a href="mailto:hello@contrax.company" className="text-sm text-gray-400 transition-colors hover:text-white">
              hello@contrax.company
            </a>
          </div>
        </div>
      </footer>
    </div>
  );
}
