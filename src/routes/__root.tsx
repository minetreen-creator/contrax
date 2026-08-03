import {
  HeadContent,
  Outlet,
  Scripts,
  createRootRoute,
} from "@tanstack/react-router";
import type { ReactNode } from "react";

import appCss from "~/styles/app.css?url";

const PROD_URL = "https://contrax.company";
const SITE_TITLE = "Contrax — AI Government Contracting for Set-Aside Businesses";
const SITE_DESCRIPTION =
  "Contrax monitors government procurement sites, summarizes bid documents, and drafts proposals with AI so small businesses find and win more contracts.";

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
      { property: "og:site_name", content: "Contrax" },

      // Twitter Card
      { name: "twitter:card", content: "summary_large_image" },
      { name: "twitter:title", content: SITE_TITLE },
      { name: "twitter:description", content: SITE_DESCRIPTION },
    ],
    links: [{ rel: "stylesheet", href: appCss }],
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

// ── Root Document ──────────────────────────────────────────────────────────────
function RootDocument({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <head>
        <HeadContent />
      </head>
      <body className="antialiased">
        {children}
        <Scripts />
      </body>
    </html>
  );
}

function RootComponent() {
  return (
    <RootDocument>
      <Outlet />
    </RootDocument>
  );
}
