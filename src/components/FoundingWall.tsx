import { useEffect, useState } from "react";
import { trackEvent } from "~/lib/track";

type Listing = { slot: number; company: string; services: string; serviceArea: string; website: string; logoUrl: string };

/**
 * "Local businesses using Contrax" (owner 2026-10-29): the published Founding
 * Businesses, the same public profiles /founding-businesses shows, as part of
 * their year-long featured listing. Renders nothing until the first one is
 * published, so the homepage never shows an empty or made-up wall.
 */
export function FoundingWall() {
  const [listings, setListings] = useState<Listing[]>([]);
  useEffect(() => {
    fetch("/api/founding-spots")
      .then((r) => (r.ok ? r.json() : null))
      .then((d: { listings?: Listing[] } | null) => setListings(Array.isArray(d?.listings) ? d!.listings! : []))
      .catch(() => setListings([]));
  }, []);
  if (listings.length === 0) return null;
  return (
    <section aria-labelledby="founding-wall-title" className="mx-auto max-w-6xl px-5 py-12 sm:px-8">
      <p className="text-xs font-bold uppercase tracking-widest text-amber-600">Founding Businesses</p>
      <h2 id="founding-wall-title" className="mt-2 text-2xl font-bold tracking-tight">
        Local businesses using Contrax
      </h2>
      <ul className="mt-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {listings.map((l) => (
          <li key={l.slot} className="flex items-start gap-4 rounded-2xl border border-slate-200 bg-white p-5 shadow-sm dark:border-slate-700 dark:bg-slate-900">
            {l.logoUrl ? (
              <img src={l.logoUrl} alt="" loading="lazy" className="h-12 w-12 shrink-0 rounded-lg object-contain" />
            ) : (
              <span aria-hidden="true" className="flex h-12 w-12 shrink-0 items-center justify-center rounded-lg bg-amber-100 text-lg font-bold text-amber-800">
                {l.company.charAt(0).toUpperCase()}
              </span>
            )}
            <div className="min-w-0">
              <p className="font-semibold text-slate-900 dark:text-white">{l.company}</p>
              {l.services && <p className="mt-0.5 text-sm text-slate-600 dark:text-slate-300">{l.services}</p>}
              {l.serviceArea && <p className="mt-0.5 text-xs text-slate-500">{l.serviceArea}</p>}
              {l.website && /^https?:\/\//i.test(l.website) && (
                <a
                  href={l.website}
                  target="_blank"
                  rel="noopener noreferrer"
                  onClick={() => trackEvent("founding_wall_click", String(l.slot))}
                  className="mt-1 inline-block text-xs font-semibold text-blue-700 hover:underline dark:text-blue-300"
                >
                  Visit website ↗
                </a>
              )}
            </div>
          </li>
        ))}
      </ul>
      <p className="mt-6 text-sm">
        <a href="/founding-businesses" className="font-semibold text-amber-700 hover:text-amber-600">
          Become a Founding Business: $99 for the whole first year →
        </a>
      </p>
    </section>
  );
}
