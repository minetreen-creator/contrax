import {
  HeadContent,
  Outlet,
  Scripts,
  createRootRoute,
  useLocation,
} from "@tanstack/react-router";
import { useEffect, useRef, type ReactNode } from "react";

import { ChatWidget } from "~/components/ChatWidget";
import {
  ATTR_COOKIE_NAME,
  attributionCookieSetHeader,
  resolveAttribution,
} from "~/lib/attribution";
import { trackingIds, getOrCreateVisitorId } from "~/lib/visitor";
import { getTrackingUser, resolveTrackingUser } from "~/lib/identity";
import appCss from "~/styles/app.css?url";

const PROD_URL = "https://www.contrax.company";
const SITE_TITLE = "Contrax — Government RFPs Matched to Your Set-Aside Certifications";
const SITE_DESCRIPTION =
  "Find and win government contracts reserved for businesses like yours. Contrax matches your 8(a), SDVOSB, WOSB, or HUBZone certification to live SAM.gov and city procurement opportunities — with 5-year incumbent pricing data so you know what to bid before you write a word.";

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
// Self-hosted traffic tracking. Fires a fire-and-forget POST to
// /api/track-visitor (kind="page") on the initial load and on every route
// change — the same single intake endpoint trackEvent() uses (kind="event").
// Same-path hits are deduped to once per 5 minutes (per browser session).
// Never blocks rendering and never surfaces errors to the user — the endpoint
// itself swallows failures too. /api/page-view stays as a thin forwarder for
// legacy beacons.
const PAGE_VIEW_DEDUPE_MS = 5 * 60 * 1000;

function recordPageView(path: string) {
  if (typeof window === "undefined") return;
  if (path.startsWith("/admin")) return; // don't track admin views
  // Persistent per-visitor + per-session identity (first-party, self-hosted).
  // getOrCreateVisitorId() sets the `contrax_vid` cookie on first call so it is
  // in place before the first page view; the id also rides in the body.
  const ids = trackingIds();
  const payload: Record<string, string | undefined> = {
    path,
    kind: "page",
    referrer: document.referrer || undefined,
    visitor_id: ids.visitor_id,
    visit_id: ids.visit_id,
  };
  // When the viewer is a logged-in user, carry their identity so the post-login
  // lifecycle stays tied to the account. Anonymous visitors simply omit these.
  const user = getTrackingUser();
  if (user) {
    payload.user_id = user.id;
    payload.user_email = user.email;
  }
  try {
    fetch("/api/track-visitor", {
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
  const firstRef = useRef(true);

  useEffect(() => {
    const path = location.pathname;
    if (!path) return;
    const now = Date.now();
    const lastSent = lastSentRef.current.get(path) ?? 0;
    if (now - lastSent < PAGE_VIEW_DEDUPE_MS) return;
    lastSentRef.current.set(path, now);
    if (firstRef.current) {
      firstRef.current = false;
      // Resolve the logged-in identity BEFORE the first page view so a
      // returning/active user's very first view is already stamped with their
      // user_id/user_email. Cache is then warm for every subsequent view/event.
      // resolveTrackingUser() never throws, so anonymous visitors send
      // immediately with no user fields.
      resolveTrackingUser().finally(() => recordPageView(path));
      return;
    }
    recordPageView(path);
  }, [location.pathname]);

  return null;
}

// ── First-Touch Acquisition Attribution ─────────────────────────────────────
// Sets the `contrax_attr` cookie ONCE on the visitor's first arrival (only when
// it is not already present, so the first-touch source is preserved for 30 days
// even as they navigate /signup, /pricing, /api/*). The cookie carries the
// source/medium/campaign/click_id resolved from the URL query (utm_* / fbclid /
// gclid) or the referring site. SameSite=Lax + Path=/ means it survives the
// Facebook/LinkedIn cross-site click into the app and is sent on every
// first-party request. Placed BEFORE PageViewTracker so the cookie is set before
// the first /api/page-view POST fires, letting the server stamp the same hit.
function AttributionCookie() {
  useEffect(() => {
    try {
      if (typeof window === "undefined") return;
      // Ensure the persistent per-visitor id cookie exists on first arrival so
      // it is already in place before the first page-view/event POST fires.
      getOrCreateVisitorId();
      // Already set — never clobber the first-touch attribution.
      if (
        document.cookie
          .split(";")
          .some((part) => part.trim().startsWith(ATTR_COOKIE_NAME + "="))
      ) {
        return;
      }
      const attr = resolveAttribution({
        cookie: document.cookie,
        search: window.location.search,
        referer: document.referrer || null,
      });
      document.cookie = attributionCookieSetHeader(attr);
    } catch {
      // attribution must never break rendering
    }
  }, []);
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
      <AttributionCookie />
      <PageViewTracker />
      <ChatWidget />
    </RootDocument>
  );
}
