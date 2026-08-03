import {
  HeadContent,
  Outlet,
  Scripts,
  createRootRoute,
} from "@tanstack/react-router";
import type { ReactNode } from "react";

import appCss from "~/styles/app.css?url";

const PROD_URL = "https://contrax.company";
const SITE_TITLE = "Contrax — Contract Intelligence Platform for Set-Aside Businesses";
const SITE_DESCRIPTION =
  "Contrax monitors government procurement sites, summarizes bid documents, and drafts proposals so small businesses find and win more contracts.";

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
      { property: "og:image", content: `${PROD_URL}/logo-square.png` },
      { property: "og:image:type", content: "image/png" },
      { property: "og:image:alt", content: "Contrax — Contract Intelligence Platform for Set-Aside Businesses" },

      // Twitter Card
      { name: "twitter:card", content: "summary_large_image" },
      { name: "twitter:title", content: SITE_TITLE },
      { name: "twitter:description", content: SITE_DESCRIPTION },
      { name: "twitter:image", content: `${PROD_URL}/logo-square.png` },
      { name: "twitter:image:alt", content: "Contrax — Contract Intelligence Platform for Set-Aside Businesses" },
    ],
    links: [
      { rel: "stylesheet", href: appCss },
      { rel: "icon", type: "image/png", href: "/favicon.png" },
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
