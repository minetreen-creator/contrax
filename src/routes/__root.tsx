import {
  HeadContent,
  Outlet,
  Scripts,
  createRootRoute,
  Link,
} from "@tanstack/react-router";
import type { ReactNode } from "react";

import appCss from "~/styles/app.css?url";

const PROD_URL = "https://pricedoctor.net";
const SITE_TITLE = "Contrax — AI-Powered Government Contract Bidding for Small Businesses";
const SITE_DESCRIPTION =
  "Contrax monitors government procurement sites, summarizes complex bid documents, and drafts proposals with AI — so small businesses can find and win more public-sector contracts.";

export const Route = createRootRoute({
  head: () => ({
    meta: [
      { charSet: "utf-8" },
      { name: "viewport", content: "width=device-width, initial-scale=1" },
      { title: SITE_TITLE },
      { name: "description", content: SITE_DESCRIPTION },
      { name: "robots", content: "index, follow" },

      // Open Graph
      { property: "og:type", content: "website" },
      { property: "og:url", content: PROD_URL },
      { property: "og:title", content: SITE_TITLE },
      { property: "og:description", content: SITE_DESCRIPTION },
      { property: "og:image", content: `${PROD_URL}/og-image.svg` },
      { property: "og:image:type", content: "image/svg+xml" },
      { property: "og:image:alt", content: "Contrax — AI-powered government contract bidding platform" },
      { property: "og:image:width", content: "1200" },
      { property: "og:image:height", content: "630" },
      { property: "og:site_name", content: "Contrax" },

      // Twitter Card
      { name: "twitter:card", content: "summary_large_image" },
      { name: "twitter:title", content: SITE_TITLE },
      { name: "twitter:description", content: SITE_DESCRIPTION },
      { name: "twitter:image", content: `${PROD_URL}/og-image.svg` },
      { name: "twitter:image:alt", content: "Contrax — AI-powered government contract bidding platform" },
    ],
    links: [
      { rel: "stylesheet", href: appCss },
      { rel: "canonical", href: PROD_URL },
      { rel: "icon", type: "image/svg+xml", href: "/favicon.svg" },
    ],
  }),
  notFoundComponent: () => (
    <div className="flex min-h-screen items-center justify-center bg-gray-50">
      <div className="text-center">
        <h1 className="text-4xl font-bold text-slate-900">404</h1>
        <p className="mt-2 text-gray-500">Page not found</p>
        <a
          href="/"
          className="mt-4 inline-block text-sm font-medium text-blue-600 hover:text-blue-500"
        >
          &larr; Back to home
        </a>
      </div>
    </div>
  ),
  component: RootComponent,
});

function RootComponent() {
  return (
    <RootDocument>
      <SectionSwitcher />
      <Outlet />
    </RootDocument>
  );
}

// ── Section Switcher ───────────────────────────────────────────────────────────

function SectionSwitcher() {
  return (
    <div className="sticky top-0 z-50 bg-slate-900 border-b border-slate-700">
      <div className="mx-auto flex max-w-7xl items-center gap-1 px-6 py-2">
        <Link
          to="/"
          className="rounded-lg px-4 py-2 text-sm font-medium text-slate-300 transition-colors hover:text-white hover:bg-slate-800 [&.active]:bg-slate-800 [&.active]:text-white"
          activeProps={{ className: "bg-slate-800 text-white" }}
          inactiveProps={{ className: "text-slate-300" }}
        >
          📄 Contracts
        </Link>
        <Link
          to="/savings"
          className="rounded-lg px-4 py-2 text-sm font-medium text-slate-300 transition-colors hover:text-white hover:bg-slate-800 [&.active]:bg-slate-800 [&.active]:text-white"
          activeProps={{ className: "bg-slate-800 text-white" }}
          inactiveProps={{ className: "text-slate-300" }}
        >
          💰 Savings
        </Link>
      </div>
    </div>
  );
}

// ── Root Document ──────────────────────────────────────────────────────────────

function RootDocument({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <head>
        <HeadContent />
      </head>
      <body className="antialiased">
        {children}
        <footer className="border-t border-slate-200 bg-slate-50 mt-16">
          <div className="mx-auto max-w-7xl px-6 py-8 flex flex-col sm:flex-row items-center justify-between gap-4">
            <p className="text-sm text-slate-500">© 2026 Contrax. All rights reserved.</p>
            <div className="flex items-center gap-6">
              <a href="/privacy" className="text-sm text-slate-500 hover:text-slate-700 transition-colors">Privacy Policy</a>
              <a href="/terms" className="text-sm text-slate-500 hover:text-slate-700 transition-colors">Terms of Service</a>
              <a href="mailto:hello@contrax.app" className="text-sm text-slate-500 hover:text-slate-700 transition-colors">Contact</a>
            </div>
          </div>
        </footer>
        <Scripts />
        {/* Lightweight analytics — no external deps, no cookies, no PII */}
        <script
          dangerouslySetInnerHTML={{
            __html: `(function(){try{var p=location.pathname+location.search;var r=document.referrer||"";fetch("/api/analytics",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({path:p,referrer:r})})}catch(e){}})();`,
          }}
        />
      </body>
    </html>
  );
}
