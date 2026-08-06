import { createFileRoute, notFound } from "@tanstack/react-router";
import { getBlogPost, formatBlogDate, type BlogPost } from "~/lib/blog";

const PROD_URL = "https://contrax.company";

export const Route = createFileRoute("/blog/$slug")({
  loader: ({ params }) => {
    const post = getBlogPost(params.slug);
    if (!post) throw notFound();
    return post;
  },
  head: ({ loaderData }) => {
    const post = loaderData;
    const title = `${post.title} — Contrax Blog`;
    const url = `${PROD_URL}/blog/${post.slug}`;
    return {
      meta: [
        { title },
        { name: "description", content: post.excerpt },
        { name: "robots", content: "index, follow" },
        // Open Graph
        { property: "og:type", content: "article" },
        { property: "og:url", content: url },
        { property: "og:title", content: title },
        { property: "og:description", content: post.excerpt },
        { property: "og:image", content: `${PROD_URL}/logo-square.png` },
        { property: "og:image:type", content: "image/png" },
        { property: "og:image:width", content: "1200" },
        { property: "og:image:height", content: "630" },
        { property: "og:site_name", content: "Contrax" },
        { property: "article:published_time", content: `${post.date}T00:00:00Z` },
        // Twitter Card
        { name: "twitter:card", content: "summary_large_image" },
        { name: "twitter:title", content: title },
        { name: "twitter:description", content: post.excerpt },
        { name: "twitter:image", content: `${PROD_URL}/logo-square.png` },
      ],
      links: [{ rel: "canonical", href: url }],
    };
  },
  component: BlogPostPage,
});

function BlogPostPage() {
  const post = Route.useLoaderData() as BlogPost;
  const url = `${PROD_URL}/blog/${post.slug}`;
  const jsonLd = {
    "@context": "https://schema.org",
    "@graph": [
      {
        "@type": "Article",
        headline: post.title,
        description: post.excerpt,
        datePublished: `${post.date}T00:00:00Z`,
        dateModified: `${post.date}T00:00:00Z`,
        mainEntityOfPage: url,
        url,
        author: {
          "@type": "Organization",
          name: "Contrax",
          url: PROD_URL,
        },
        publisher: {
          "@type": "Organization",
          name: "Contrax",
          url: PROD_URL,
          logo: {
            "@type": "ImageObject",
            url: `${PROD_URL}/logo-square.png`,
          },
        },
      },
      {
        "@type": "BreadcrumbList",
        itemListElement: [
          { "@type": "ListItem", position: 1, name: "Home", item: PROD_URL },
          { "@type": "ListItem", position: 2, name: "Blog", item: `${PROD_URL}/blog` },
          { "@type": "ListItem", position: 3, name: post.title, item: url },
        ],
      },
    ],
  };
  return (
    <div className="min-h-screen bg-white">
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }} />
      <header className="border-b border-slate-800 bg-slate-900">
        <div className="mx-auto flex max-w-7xl items-center justify-between px-6 py-5">
          <a href="/">
            <img src="/logo.png" alt="Contrax" className="h-9 w-auto" />
          </a>
          <nav className="flex items-center gap-5 text-sm">
            <a href="/" className="text-gray-400 transition-colors hover:text-white">Home</a>
            <a href="/blog" className="text-gray-400 transition-colors hover:text-white">Blog</a>
            <a
              href="/signup"
              className="rounded-lg bg-amber-500 px-4 py-2 font-semibold text-white transition-colors hover:bg-amber-400"
            >
              Start Free Trial
            </a>
          </nav>
        </div>
      </header>

      <main className="mx-auto max-w-3xl px-6 py-12 sm:py-16">
        <a
          href="/blog"
          className="inline-flex items-center gap-1.5 text-sm font-semibold text-blue-600 transition-colors hover:text-blue-500"
        >
          <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M11 17l-5-5m0 0l5-5m-5 5h12" />
          </svg>
          Back to blog
        </a>

        <article className="mt-8">
          <header>
            <h1 className="text-3xl font-bold leading-tight tracking-tight text-slate-900 sm:text-4xl">
              {post.title}
            </h1>
            <p className="mt-4 text-sm text-slate-500">
              {formatBlogDate(post.date)} · {post.readMinutes} min read
            </p>
            {post.tags.length > 0 && (
              <div className="mt-4 flex flex-wrap gap-2">
                {post.tags.map((tag) => (
                  <span key={tag} className="rounded-full bg-blue-50 px-2.5 py-1 text-xs font-medium text-blue-700">
                    {tag}
                  </span>
                ))}
              </div>
            )}
          </header>
          <div
            className="prose-blog mt-8 border-t border-slate-200 pt-8 text-[1.05rem] leading-relaxed text-slate-700"
            dangerouslySetInnerHTML={{ __html: post.html }}
          />
        </article>

        <div className="mt-12 rounded-2xl border border-slate-200 bg-slate-50 p-6 sm:p-8">
          <h2 className="text-lg font-bold text-slate-900">Turn this insight into wins</h2>
          <p className="mt-2 text-sm text-slate-600">
            Contrax finds set-aside opportunities you qualify for, summarizes the bid documents, and drafts compliant
            proposals — so certified small businesses spend less time sorting and more time winning.
          </p>
          <div className="mt-5 flex flex-wrap gap-3">
            <a
              href="/signup"
              className="inline-flex items-center rounded-lg bg-amber-500 px-5 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-amber-400"
            >
              Start Free Trial
            </a>
            <a
              href="/blog"
              className="inline-flex items-center rounded-lg border border-slate-300 bg-white px-5 py-2.5 text-sm font-semibold text-slate-700 transition-colors hover:border-slate-400"
            >
              Read More Articles
            </a>
          </div>
        </div>

        <p className="mt-10 text-center">
          <a
            href="/blog"
            className="inline-flex items-center gap-1.5 text-sm font-semibold text-blue-600 transition-colors hover:text-blue-500"
          >
            <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M11 17l-5-5m0 0l5-5m-5 5h12" />
            </svg>
            Back to all articles
          </a>
        </p>
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
