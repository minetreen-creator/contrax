import {
  HeadContent,
  Outlet,
  Scripts,
  createRootRoute,
  useLocation,
} from "@tanstack/react-router";
import { useEffect, useRef, type ReactNode } from "react";

import { ChatWidget } from "~/components/ChatWidget";
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
      { name: "google-site-verification", content: "14cRTUtBuCR8nXM6pL0FhR8H1TTtm3OpmFZgOYCxNBc" },

      // Open Graph
      { property: "og:type", content: "website" },
      { property: "og:url", content: PROD_URL },
      { property: "og:title", content: SITE_TITLE },
      { property: "og:description", content: SITE_DESCRIPTION },
      { property: "og:site_name", content: "Contrax" },
      { property: "og:image", content: `${PROD_URL}/logo-square.png` },
      { property: "og:image:type", content: "image/png" },
      { property: "og:image:alt", content: "Contrax — Contract Intelligence Platform for Set-Aside Businesses" },
      { property: "og:image:width", content: "1200" },
      { property: "og:image:height", content: "630" },

      // Twitter Card
      { name: "twitter:card", content: "summary_large_image" },
      { name: "twitter:title", content: SITE_TITLE },
      { name: "twitter:description", content: SITE_DESCRIPTION },
      { name: "twitter:image", content: `${PROD_URL}/logo-square.png` },
      { name: "twitter:image:alt", content: "Contrax — Contract Intelligence Platform for Set-Aside Businesses" },
    ],
    links: [
      { rel: "stylesheet", href: appCss },
      { rel: "icon", type: "image/png", href: "/logo.png?v=3" },
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

// ── Page View Analytics ──────────────────────────────────────────────────────
// Self-hosted traffic tracking. Fires a fire-and-forget POST to /api/page-view
// on the initial load and on every route change. Same-path hits are deduped to
// once per 5 minutes (per browser session). Never blocks rendering and never
// surfaces errors to the user — the endpoint itself swallows failures too.
const PAGE_VIEW_DEDUPE_MS = 5 * 60 * 1000;

function recordPageView(path: string) {
  if (typeof window === "undefined") return;
  if (path.startsWith("/admin")) return; // don't track admin views
  const payload = { path, referrer: document.referrer || undefined };
  try {
    fetch("/api/page-view", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
      keepalive: true,
    }).catch(() => {
      /* fire-and-forget — never surface tracking failures */
    });
  } catch {
    /* never let tracking break rendering */
  }
}

function PageViewTracker() {
  const location = useLocation();
  // Module-scoped so the dedupe window survives across route navigations
  // (the root component stays mounted for the whole session).
  const lastSentRef = useRef<Map<string, number>>(new Map());

  useEffect(() => {
    const path = location.pathname;
    if (!path) return;
    const now = Date.now();
    const lastSent = lastSentRef.current.get(path) ?? 0;
    if (now - lastSent < PAGE_VIEW_DEDUPE_MS) return;
    lastSentRef.current.set(path, now);
    recordPageView(path);
  }, [location.pathname]);

  return null;
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
        <Scripts />
      </body>
    </html>
  );
}

function RootComponent() {
  return (
    <RootDocument>
      <Outlet />
      <PageViewTracker />
      <ChatWidget />
    </RootDocument>
  );
}
