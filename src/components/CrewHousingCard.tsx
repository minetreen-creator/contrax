import { CASA, CASA_PRICE_NOTE, TAMPA_HEADLINE, TAMPA_PATH } from "~/lib/tampa";
import { trackEvent } from "~/lib/track";

/**
 * Casa Blue Collar, Contrax's Tampa Bay housing referral partner, shown where a contractor is
 * looking at Tampa Bay work (owner 2026-11-12). Every figure is Casa's own, labeled as theirs
 * (src/lib/tampa.ts). Clicks count under the same event as the Tampa page, with the placement as
 * the label, so the partner click report includes them.
 */
export function CrewHousingCard({ where, tone = "light", heading }: { where: "bid_page" | "state_page"; tone?: "light" | "dark"; heading?: string }) {
  const dark = tone === "dark";
  const box = dark ? "border-sky-500/40 bg-slate-900 text-slate-200" : "border-slate-900 bg-white text-slate-700";
  const strong = dark ? "text-white" : "text-slate-900";
  const muted = dark ? "text-slate-400" : "text-slate-500";
  const link = dark ? "text-sky-300" : "text-blue-700";
  return (
    <section aria-label="Crew housing in Tampa Bay" className={`mt-6 rounded-2xl border-2 p-5 ${box}`}>
      <p className={`text-xs font-semibold uppercase tracking-wide ${dark ? "text-sky-300" : "text-sky-700"}`}>Housing referral partner · Tampa Bay</p>
      <h2 className={`mt-1 text-lg font-bold ${strong}`}>{heading ?? "Bringing a crew to Tampa Bay for this job?"}</h2>
      <p className={`mt-1 text-base font-semibold ${strong}`}>
        {CASA.name}: {CASA.tagline.charAt(0).toLowerCase() + CASA.tagline.slice(1)}, {TAMPA_HEADLINE.saving}.*
      </p>
      <p className="mt-1 text-sm">{CASA.pitch} {CASA.proof}</p>
      <ul className="mt-3 grid grid-cols-2 gap-x-4 gap-y-1 text-sm sm:grid-cols-4">
        {CASA.amenities.map((a) => (
          <li key={a}>✓ {a}</li>
        ))}
      </ul>
      <p className={`mt-3 text-sm font-semibold ${strong}`}>{CASA.ask}</p>
      <div className="mt-2 flex flex-wrap items-center gap-3">
        <a
          href={CASA.url}
          target="_blank"
          rel="sponsored noopener"
          onClick={() => trackEvent("tampa_housing_referral_click", `${where}_site`)}
          className={`inline-block rounded-lg px-4 py-2.5 font-semibold ${dark ? "bg-amber-500 text-slate-950" : "bg-slate-900 text-white"}`}
        >
          Get crew housing from {CASA.name} →
        </a>
        <a href={`tel:${CASA.tel}`} onClick={() => trackEvent("tampa_housing_referral_click", `${where}_phone`)} className={`text-sm font-semibold ${link}`}>
          Or call {CASA.phone}
        </a>
        <span className="text-sm">{CASA.spanish}</span>
      </div>
      <p className={`mt-3 text-xs ${muted}`}>
        *{CASA_PRICE_NOTE} {CASA.name} is an independent company and Contrax's housing referral partner. Bookings and rates are between you and them.{" "}
        <a href={`${TAMPA_PATH}?source=${where}`} className={`font-semibold ${link}`}>More for contractors working in Tampa →</a>
      </p>
    </section>
  );
}
