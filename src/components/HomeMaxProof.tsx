import { useState } from "react";
import { MAX_PROOF, maxProofBidOpen, maxProofBullets } from "~/lib/max-proof";
import { trackEvent } from "~/lib/track";

/**
 * Homepage before/after (owner 2026-11-08): a real construction bid's notice text next to Max's
 * real answer about it, English or Spanish. All text is verbatim (see ~/lib/max-proof).
 */
export function HomeMaxProof() {
  const [lang, setLang] = useState<"en" | "es">("en");
  const bullets = maxProofBullets(MAX_PROOF.max[lang]);
  const open = maxProofBidOpen();
  const asked = new Date(`${MAX_PROOF.askedOn}T12:00:00Z`).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" });
  return (
    <section aria-labelledby="home-max-proof-title" className="mx-auto max-w-[1120px] px-4 pt-12 sm:px-6">
      <p className="text-xs font-bold uppercase tracking-wider text-amber-700 dark:text-amber-300">🤖 Max reads the fine print</p>
      <h2 id="home-max-proof-title" className="mt-1 text-[clamp(24px,3vw,30px)] font-bold leading-[1.15]">
        A wall of bid text, in plain English
      </h2>
      <p className="mt-1 text-sm text-slate-600 dark:text-slate-300">
        A real construction bid from {MAX_PROOF.agency}, and what Max said when asked about it.
      </p>

      <div className="mt-5 grid gap-4 md:grid-cols-2">
        <div className="rounded-2xl border border-slate-200 bg-white p-5 dark:border-slate-700 dark:bg-slate-900">
          <p className="text-xs font-bold uppercase tracking-wide text-slate-500">Before: the notice</p>
          <p className="mt-1 text-sm font-semibold text-slate-900 dark:text-slate-100">{MAX_PROOF.title}</p>
          <p className="mt-3 max-h-64 overflow-hidden text-[13px] leading-relaxed text-slate-600 [mask-image:linear-gradient(to_bottom,black_70%,transparent)] dark:text-slate-400">
            {MAX_PROOF.notice}
          </p>
          <p className="mt-2 text-xs text-slate-500">
            …{MAX_PROOF.noticeChars.toLocaleString("en-US")} characters in the notice, plus the attached documents.
          </p>
        </div>

        <div className="rounded-2xl border-2 border-amber-300 bg-amber-50 p-5 dark:border-amber-500/50 dark:bg-amber-500/10">
          <div className="flex items-center justify-between gap-2">
            <p className="text-xs font-bold uppercase tracking-wide text-amber-800 dark:text-amber-300">After: Max&apos;s answer</p>
            <div role="group" aria-label="Language" className="inline-flex rounded-full border border-amber-300 bg-white p-0.5 text-xs font-semibold dark:bg-slate-900">
              {(["en", "es"] as const).map((l) => (
                <button
                  key={l}
                  type="button"
                  aria-pressed={lang === l}
                  onClick={() => {
                    setLang(l);
                    trackEvent("home_max_proof_lang", l);
                  }}
                  className={`rounded-full px-3 py-1 ${lang === l ? "bg-amber-500 text-slate-950" : "text-slate-600 dark:text-slate-300"}`}
                >
                  {l === "en" ? "English" : "Español"}
                </button>
              ))}
            </div>
          </div>
          <ul className="mt-3 space-y-2 text-[15px] leading-snug text-slate-900 dark:text-slate-100" lang={lang}>
            {bullets.map((b) => (
              <li key={b} className="flex gap-2">
                <span aria-hidden="true" className="mt-0.5 text-amber-600">✓</span>
                <span>{b}</span>
              </li>
            ))}
          </ul>
          <p className="mt-3 text-xs text-slate-500 dark:text-slate-400">Max&apos;s answer word for word, asked on {asked}.</p>
          <div className="mt-4 flex flex-wrap gap-3">
            {open ? (
              <a
                href={`/bid/${MAX_PROOF.bidId}?source=home_max_proof`}
                onClick={() => trackEvent("home_max_proof_click", "bid")}
                className="rounded-xl bg-amber-500 px-4 py-2 text-sm font-bold text-slate-950 hover:bg-amber-400"
              >
                Open this bid and ask Max yourself →
              </a>
            ) : null}
            <a
              href="/radar?source=home_max_proof"
              onClick={() => trackEvent("home_max_proof_click", "radar")}
              className="rounded-xl border border-amber-400 px-4 py-2 text-sm font-semibold text-amber-900 hover:bg-amber-100 dark:text-amber-200"
            >
              Find bids in your trade
            </a>
          </div>
        </div>
      </div>
    </section>
  );
}
