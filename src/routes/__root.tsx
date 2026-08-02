import {
  HeadContent,
  Outlet,
  Scripts,
  createRootRoute,
  Link,
} from "@tanstack/react-router";
import { useState, useEffect, useRef, useCallback, type ReactNode } from "react";

import appCss from "~/styles/app.css?url";
import {
  getNotifications,
  markRead,
  markAllRead,
  type Notification,
} from "~/lib/notifications";

const PROD_URL = "https://contrax.company";
const SITE_TITLE = "Contrax — AI Government Contract Bidding for Small Businesses";
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
          to="/compare"
          className="rounded-lg px-4 py-2 text-sm font-medium text-slate-300 transition-colors hover:text-white hover:bg-slate-800 [&.active]:bg-slate-800 [&.active]:text-white"
          activeProps={{ className: "bg-slate-800 text-white" }}
          inactiveProps={{ className: "text-slate-300" }}
        >
          ⚖️ Compare
        </Link>
        <Link
          to="/score"
          className="rounded-lg px-4 py-2 text-sm font-medium text-slate-300 transition-colors hover:text-white hover:bg-slate-800 [&.active]:bg-slate-800 [&.active]:text-white"
          activeProps={{ className: "bg-slate-800 text-white" }}
          inactiveProps={{ className: "text-slate-300" }}
        >
          🎯 Score
        </Link>
        <Link
          to="/copilot"
          className="rounded-lg px-4 py-2 text-sm font-medium text-slate-300 transition-colors hover:text-white hover:bg-slate-800 [&.active]:bg-slate-800 [&.active]:text-white"
          activeProps={{ className: "bg-slate-800 text-white" }}
          inactiveProps={{ className: "text-slate-300" }}
        >
          ✨ Copilot
        </Link>
        <Link
          to="/learn"
          className="rounded-lg px-4 py-2 text-sm font-medium text-slate-300 transition-colors hover:text-white hover:bg-slate-800 [&.active]:bg-slate-800 [&.active]:text-white"
          activeProps={{ className: "bg-slate-800 text-white" }}
          inactiveProps={{ className: "text-slate-300" }}
        >
          📖 Resources
        </Link>
        <Link
          to="/settings"
          className="rounded-lg px-4 py-2 text-sm font-medium text-slate-300 transition-colors hover:text-white hover:bg-slate-800 [&.active]:bg-slate-800 [&.active]:text-white"
          activeProps={{ className: "bg-slate-800 text-white" }}
          inactiveProps={{ className: "text-slate-300" }}
        >
          ⚙️ Settings
        </Link>

        {/* Spacer pushes bell to the right */}
        <div className="flex-1" />

        <NotificationsBell />
      </div>
    </div>
  );
}

// ── Notification Type Icon ─────────────────────────────────────────────────────

function notifIcon(type: string): string {
  if (type === "deadline_alert") return "⏰";
  if (type === "new_bid_match") return "📋";
  if (type === "team_activity") return "👥";
  return "🔔";
}

function relativeTime(dateStr: string): string {
  const diffMs = Date.now() - new Date(dateStr).getTime();
  const diffSec = Math.round(diffMs / 1000);
  const diffMin = Math.round(diffSec / 60);
  const diffHr = Math.round(diffMin / 60);
  const diffDays = Math.round(diffHr / 24);

  if (diffSec < 60) return "just now";
  if (diffMin < 60) return `${diffMin}m ago`;
  if (diffHr < 24) return `${diffHr}h ago`;
  if (diffDays === 1) return "yesterday";
  if (diffDays < 7) return `${diffDays}d ago`;
  return new Date(dateStr).toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

// ── Notifications Bell ─────────────────────────────────────────────────────────

function NotificationsBell() {
  const [open, setOpen] = useState(false);
  const [count, setCount] = useState(0);
  const [notifications, setNotifications] = useState<Notification[]>([]);
  const [loading, setLoading] = useState(false);
  const panelRef = useRef<HTMLDivElement>(null);
  const bellRef = useRef<HTMLButtonElement>(null);

  const fetchNotifications = useCallback(async () => {
    try {
      const res = await getNotifications();
      setCount(res.count);
      setNotifications(res.notifications);
    } catch {
      // User likely not logged in — silently ignore
    } finally {
      setLoading(false);
    }
  }, []);

  // Fetch on mount
  useEffect(() => {
    setLoading(true);
    fetchNotifications();
  }, [fetchNotifications]);

  // Poll every 60s when the bell is visible
  useEffect(() => {
    const interval = setInterval(fetchNotifications, 60000);
    return () => clearInterval(interval);
  }, [fetchNotifications]);

  // Close dropdown on outside click
  useEffect(() => {
    if (!open) return;
    const handleClick = (e: MouseEvent) => {
      if (
        panelRef.current &&
        !panelRef.current.contains(e.target as Node) &&
        bellRef.current &&
        !bellRef.current.contains(e.target as Node)
      ) {
        setOpen(false);
      }
    };
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, [open]);

  const handleMarkRead = useCallback(async (id: number) => {
    try {
      await markRead({ data: { id } });
      setNotifications((prev) =>
        prev.map((n) => (n.id === id ? { ...n, read: true } : n)),
      );
      setCount((prev) => Math.max(0, prev - 1));
    } catch {
      // ignore
    }
  }, []);

  const handleMarkAllRead = useCallback(async () => {
    try {
      await markAllRead();
      setNotifications((prev) => prev.map((n) => ({ ...n, read: true })));
      setCount(0);
    } catch {
      // ignore
    }
  }, []);

  return (
    <div className="relative">
      <button
        ref={bellRef}
        type="button"
        onClick={() => setOpen((prev) => !prev)}
        className="relative rounded-lg px-3 py-2 text-lg transition-colors hover:bg-slate-800"
        aria-label="Notifications"
      >
        🔔
        {count > 0 && (
          <span className="absolute -top-0.5 -right-0.5 flex h-5 min-w-[20px] items-center justify-center rounded-full bg-red-500 px-1 text-[10px] font-bold text-white shadow-sm ring-2 ring-slate-900">
            {count > 99 ? "99+" : count}
          </span>
        )}
      </button>

      {open && (
        <div
          ref={panelRef}
          className="absolute right-0 top-full mt-2 w-80 rounded-xl bg-white shadow-lg ring-1 ring-black/5 z-50 overflow-hidden"
        >
          {/* Header */}
          <div className="flex items-center justify-between border-b border-slate-100 px-4 py-3">
            <h3 className="text-sm font-semibold text-slate-900">
              Notifications
            </h3>
            {count > 0 && (
              <button
                type="button"
                onClick={handleMarkAllRead}
                className="text-xs font-medium text-blue-600 hover:text-blue-800 transition-colors"
              >
                Mark all read
              </button>
            )}
          </div>

          {/* Feed */}
          <div className="max-h-96 overflow-y-auto">
            {notifications.length === 0 ? (
              <div className="flex flex-col items-center justify-center px-4 py-10 text-center">
                <span className="text-3xl mb-2">🔔</span>
                <p className="text-sm text-slate-500">No notifications yet</p>
                <p className="text-xs text-slate-400 mt-1">
                  We'll let you know when bids are due, new matches appear, or your team takes action.
                </p>
              </div>
            ) : (
              notifications.map((n) => (
                <button
                  key={n.id}
                  type="button"
                  onClick={() => {
                    if (!n.read) handleMarkRead(n.id);
                  }}
                  className={`flex w-full items-start gap-3 px-4 py-3 text-left transition-colors hover:bg-slate-50 border-b border-slate-50 last:border-b-0 ${
                    !n.read ? "bg-blue-50/40" : ""
                  }`}
                >
                  <span className="mt-0.5 shrink-0 text-lg">
                    {notifIcon(n.type)}
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-medium text-slate-900 leading-snug">
                      {n.title}
                    </p>
                    <p className="mt-0.5 text-xs text-slate-500 line-clamp-2">
                      {n.message}
                    </p>
                    <p className="mt-1 text-[10px] text-slate-400">
                      {relativeTime(n.created_at)}
                    </p>
                  </div>
                  {!n.read && (
                    <span className="mt-2 shrink-0 h-2 w-2 rounded-full bg-blue-500" />
                  )}
                </button>
              ))
            )}
          </div>

          {/* Footer */}
          {notifications.length > 0 && (
            <div className="border-t border-slate-100 px-4 py-2.5 text-center">
              <span className="text-xs text-slate-400">
                Showing last {notifications.length} notifications
              </span>
            </div>
          )}
        </div>
      )}
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
