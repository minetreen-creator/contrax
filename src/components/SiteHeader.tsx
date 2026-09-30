import { useEffect, useState } from "react";
import { getCurrentUser } from "~/lib/auth";

type HeaderUser = { id: number; email: string; is_admin?: boolean } | null;

/**
 * Shared public-site header (the homepage header, reused on the marketing and
 * funnel pages so no page is a dead end). Always white so the white-background
 * logo blends in.
 *
 * `user`: pass it when the route loader already resolved the session (the
 * homepage does). Leave it undefined and the header resolves the viewer
 * client-side after mount; until then it renders the signed-out links, so SSR
 * and hydration agree.
 */
export function SiteHeader({ user: userProp }: { user?: HeaderUser }) {
  const [resolved, setResolved] = useState<HeaderUser>(null);
  useEffect(() => {
    if (userProp !== undefined) return;
    let alive = true;
    getCurrentUser()
      .then((u) => { if (alive) setResolved(u ?? null); })
      .catch(() => {});
    return () => { alive = false; };
  }, [userProp]);
  const user = userProp !== undefined ? userProp : resolved;

  const link = "text-[#56647a] no-underline hover:text-[#0f1f38]";
  return (
    <header className="border-b border-[#dde3ec] bg-white text-[#0f1f38]">
      <div className="mx-auto flex h-[68px] max-w-[1120px] items-center justify-between gap-4 px-4 sm:px-6">
        <a href="/" className="block shrink-0" aria-label="Contrax home">
          <img src="/logo.png" alt="Contrax" height={36} className="block h-11 w-auto" />
        </a>
        <nav className="flex items-center gap-4 text-sm sm:gap-[26px] sm:text-[15px]">
          <a href="/radar" className={link}>Contracts</a>
          {/* Admins get an extra link; drop Pricing on phones so the row still fits. */}
          <a href="/pricing" className={user?.is_admin ? `${link} hidden sm:inline` : link}>Pricing</a>
          {user?.is_admin && (
            <a href="/admin" className="rounded-md bg-amber-50 px-2.5 py-1 font-semibold text-amber-600 no-underline hover:text-amber-500">
              Admin
            </a>
          )}
          {user ? (
            <a href="/dashboard" className="rounded-md border border-[#dde3ec] px-4 py-2 text-[#0f1f38] no-underline">
              Dashboard
            </a>
          ) : (
            <a href="/login" className="rounded-md border border-[#dde3ec] px-4 py-2 text-[#0f1f38] no-underline">
              Sign in
            </a>
          )}
        </nav>
      </div>
    </header>
  );
}
