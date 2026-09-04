/**
 * LiveOpportunities — "Live set-aside opportunities" strip for the homepage.
 *
 * Renders 3–5 REAL, currently-active set-aside solicitations from the `bids`
 * table (server-rendered via the loader; see src/lib/live-opportunities.ts).
 * Every field on a card is a real `bids` column — nothing fabricated. When the
 * loader returns fewer than 3 rows (or none), the section renders exactly what
 * exists and hides itself entirely on an empty list — it never pads or invents.
 *
 * Each card carries an "Analyze this opportunity" button wired to the existing
 * AI Executive Brief flow (`POST /api/bids/<id>/analyze`). That endpoint is
 * authenticated, so for a signed-out visitor the button routes through the SAME
 * contextual signup pattern the product already uses everywhere else
 * (RfpSummaryCard.tsx → `/signup?title=…&value=…&plan=basic&next=/bid/<id>`):
 * they land on /signup with the bid context pre-filled, and after signup the
 * `next` param returns them to the per-bid page where the brief generates.
 * No new auth system, no allowance bypass — the existing analyze endpoint owns
 * all gating (tiered monthly allowance, trial logic, rate limits, cache).
 *
 * Design language: light band matching OpportunityMap/ClosingSoon
 * (max-w-7xl, white rounded-2xl cards, amber accents, set-aside badge), and
 * the amber button matches the radar "Get the AI Executive Brief" treatment.
 */
import { trackEvent } from "~/lib/track";
import type { LiveOpportunity } from "~/lib/live-opportunities";

/** Normalize a raw SAM.gov set-aside label to the app's badge name (if known). */
function setAsideLabel(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const lower = raw.trim().toLowerCase();
  const map: Record<string, string> = {
    "8(a)": "8(a)",
    "8a": "8(a)",
    sba: "8(a)",
    sdvosb: "SDVOSB",
    sdvosbc: "SDVOSB",
    vosb: "VOSB",
    vosbc: "VOSB",
    wosb: "WOSB",
    edwosb: "EDWOSB",
    hubzone: "HUBZone",
    hzc: "HUBZone",
  };
  return map[lower] ?? null;
}

/**
 * Build the contextual /signup URL for an anonymous "Analyze" click — mirrors
 * RfpSummaryCard.tsx's aiBriefSignupHref exactly (same params, same flow).
 */
function analyzeSignupHref(bid: LiveOpportunity): string {
  const p = new URLSearchParams();
  if (bid.title && bid.title.trim()) p.set("title", bid.title.trim().slice(0, 300));
  p.set("plan", "basic");
  p.set("next", `/bid/${bid.id}`);
  return `/signup?${p.toString()}`;
}

/** Calendar-date formatting — same approach as fmtClosingDue (toISODate base). */
function fmtDue(raw: string | null): string | null {
  if (!raw) return null;
  const d = new Date(raw);
  if (Number.isNaN(d.getTime())) return null;
  const iso = d.toISOString().slice(0, 10);
  const parts = iso.split("-").map(Number);
  if (parts.length < 3 || parts.some((n) => !Number.isFinite(n))) return null;
  const date = new Date(parts[0], parts[1] - 1, parts[2]);
  if (Number.isNaN(date.getTime())) return null;
  const sameYear = date.getFullYear() === new Date().getFullYear();
  return date.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    ...(sameYear ? {} : { year: "numeric" }),
  });
}

export function LiveOpportunities({ bids }: { bids: LiveOpportunity[] | null | undefined }) {
  // Honest empty/insufficient state: vanish entirely when there are zero open
  // bids — including a successful-but-empty result (no empty grid, no shell).
  // Undefined-safe: loader hiccups that resolve to null/undefined also hide.
  if (!bids || bids.length === 0) return null;
  return (
    <section
      id="live-opportunities"
      className="border-b border-gray-100 bg-white py-12 sm:py-16"
      aria-label="Live set-aside opportunities you can analyze now"
    >
      <div className="mx-auto max-w-7xl px-6">
        <div className="mx-auto max-w-3xl text-center">
          <p className="text-xs font-semibold uppercase tracking-widest text-amber-600">
            ✦ Live set-aside opportunities
          </p>
          <h2 className="mt-2 text-2xl font-extrabold text-slate-900 sm:text-3xl">
            Real federal set-asides, on the table right now.
          </h2>
          <p className="mt-3 text-sm text-slate-500">
            Fresh 8(a), SDVOSB, WOSB, and HUBZone solicitations synced from
            SAM.gov — pick one and see what the RFP actually requires.
          </p>
        </div>
        <div className="mt-8 grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
          {bids.map((bid) => {
            const badge = setAsideLabel(bid.set_aside);
            const due = fmtDue(bid.due_date);
            return (
              <article
                key={bid.id}
                className="flex flex-col overflow-hidden rounded-2xl border border-gray-200 bg-white shadow-sm transition-all duration-300 hover:-translate-y-1 hover:border-amber-300 hover:shadow-xl hover:shadow-slate-900/10"
              >
                <div className="flex flex-1 flex-col p-5">
                  <div className="flex flex-wrap items-center gap-2">
                    {badge ? (
                      <span className="inline-flex items-center rounded-full border border-purple-200 bg-purple-50 px-2.5 py-0.5 text-xs font-semibold text-purple-700">
                        {badge}
                      </span>
                    ) : (
                      <span className="inline-flex items-center rounded-full border border-amber-200 bg-amber-50 px-2.5 py-0.5 text-xs font-semibold text-amber-700">
                        Set-aside
                      </span>
                    )}
                    {bid.category && (
                      <span className="inline-flex items-center rounded-full border border-gray-200 bg-gray-50 px-2.5 py-0.5 text-xs font-semibold text-gray-600">
                        {bid.category}
                      </span>
                    )}
                  </div>
                  <h3 className="mt-3 line-clamp-2 text-sm font-bold leading-snug text-slate-900">
                    {bid.title}
                  </h3>
                  <p className="mt-1 text-xs font-medium text-gray-500">
                    {bid.agency}
                  </p>
                  <div className="mt-3 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-gray-500">
                    {bid.location && (
                      <>
                        <span aria-hidden="true">📍</span>
                        <span>{bid.location}</span>
                      </>
                    )}
                    {due && (
                      <>
                        {bid.location && <span aria-hidden="true">·</span>}
                        <span className="font-semibold text-slate-700">
                          Due {due}
                        </span>
                      </>
                    )}
                  </div>
                </div>
                <div className="border-t border-gray-100 p-4">
                  <a
                    href={analyzeSignupHref(bid)}
                    onClick={() => trackEvent("home_live_opp_analyze", String(bid.id))}
                    className="inline-flex w-full items-center justify-center gap-1 rounded-xl bg-amber-500 px-4 py-2.5 text-sm font-bold text-white shadow-sm transition-all hover:bg-amber-400 active:scale-[0.98]"
                  >
                    ✦ Analyze this opportunity <span aria-hidden="true">→</span>
                  </a>
                </div>
              </article>
            );
          })}
        </div>
        <p className="mt-5 text-center text-xs text-gray-500">
          Source: synced from SAM.gov and state &amp; city solicitations ·
          updated every 4 hours · your free account includes AI Executive Briefs
        </p>
      </div>
    </section>
  );
}