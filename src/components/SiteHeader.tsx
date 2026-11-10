import { useEffect, useRef, useState } from "react";
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
const WIN_WORK_LINKS = [
  { href: "/pathway", label: "The Contrax Pathway", note: "How the five steps fit together" },
  { href: "/gap-map", label: "Opportunity gap map", note: "Where your trade's federal money is" },
  { href: "/roadmap", label: "Your roadmap", note: "Your plan and next 3 actions" },
  { href: "/prime-finder", label: "Prime contractor finder", note: "Primes that must subcontract" },
  { href: "/co-op-contracts", label: "Co-op contracts", note: "Get on contracts agencies buy from without a bid" },
  { href: "/sub-finder", label: "Sub Finder", note: "Find subs and collect quotes for your bid" },
  { href: "/sub-finder/join", label: "Get listed (subs)", note: "Get quote requests from primes" },
];

/** "Win work ▾": the Pathway tools. A <details> menu, so it works before hydration; closes on an outside click or Escape. */
function WinWorkMenu({ linkClass }: { linkClass: string }) {
  const ref = useRef<HTMLDetailsElement>(null);
  useEffect(() => {
    const close = (e: Event) => {
      const el = ref.current;
      if (!el || !el.open) return;
      if (e instanceof KeyboardEvent ? e.key === "Escape" : !el.contains(e.target as Node)) el.open = false;
    };
    document.addEventListener("click", close);
    document.addEventListener("keydown", close);
    return () => {
      document.removeEventListener("click", close);
      document.removeEventListener("keydown", close);
    };
  }, []);
  return (
    <details ref={ref} className="relative hidden sm:block">
      <summary className={`${linkClass} cursor-pointer list-none select-none [&::-webkit-details-marker]:hidden`}>
        Win work <span aria-hidden="true" className="text-xs">▾</span>
      </summary>
      <div className="absolute right-0 z-50 mt-3 w-72 rounded-xl border border-[#dde3ec] bg-white p-2 shadow-lg">
        {WIN_WORK_LINKS.map((l) => (
          <a key={l.href} href={l.href} className="block rounded-lg px-3 py-2 no-underline hover:bg-slate-50">
            <span className="block text-sm font-semibold text-[#0f1f38]">{l.label}</span>
            <span className="block text-xs text-[#56647a]">{l.note}</span>
          </a>
        ))}
      </div>
    </details>
  );
}

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
        {/* Owner 2026-10-26: the stacked logo (mark, name, tagline, URL) shrank to
            an unreadable 44px; the header shows the mark beside the name instead. */}
        <a href="/" className="flex shrink-0 items-center gap-2 no-underline" aria-label="Contrax home">
          <img src="/logo-mark.png" alt="" height={32} width={51} className="block h-8 w-auto" />
          <span className="hidden text-xl font-extrabold tracking-[0.12em] text-[#0f1f38] min-[420px]:inline">
            CONTRA<span className="text-[#1677ff]">X</span>
            {/* Owner 2026-11-06: claim the name (™ needs no registration; the registered-mark symbol would). */}
            <sup className="ml-0.5 align-super text-[10px] font-semibold tracking-normal text-[#56647a]">™</sup>
          </span>
        </a>
        <nav className="flex items-center gap-4 text-sm sm:gap-[26px] sm:text-[15px]">
          {/* Owner 2026-11-09: the top bar is Find work (bid search) vs Win work (the Contrax
              Pathway tools in one dropdown). Win work is hidden on phones so the row still fits;
              phones reach the same tools from the homepage Pathway section and the footer. */}
          <a href="/radar" className={link}>Find work</a>
          <WinWorkMenu linkClass={link} />
          {/* Admins get an extra link; drop Pricing on phones so the row still fits. */}
          <a href="/pricing" className={user?.is_admin ? `${link} hidden sm:inline` : link}>Pricing</a>
          {user?.is_admin && (
            <a href="/admin/command" className="rounded-md bg-amber-50 px-2.5 py-1 font-semibold text-amber-600 no-underline hover:text-amber-500">
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
