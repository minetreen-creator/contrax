/**
 * Spots line (owner 2026-10-04): "10 of 10 spots left" told visitors nobody
 * had bought yet, so the count only shows once a spot is taken.
 */
export function foundingSpotsLine(remaining: number, limit: number): string {
  if (remaining >= limit) return `Limited to the first ${limit} customers`;
  return `Only ${remaining} of ${limit} spots left`;
}

export function FoundingOffer({
  source: _source,
}: {
  source: "pricing" | "upgrade" | "home";
}) {
  return (
    <section
      aria-label="Founding Business offer"
      className="mx-auto mt-10 max-w-3xl rounded-2xl border border-blue-200 bg-[#0c1c36] p-7 text-white shadow-sm sm:p-8"
    >
      <p className="text-xs font-bold uppercase tracking-widest text-amber-200">
        Founding Business launch · limited to 10 businesses
      </p>
      <h2 className="mt-2 text-2xl font-bold">
        Find opportunities. Get your business featured.
      </h2>
      <p className="mt-3 text-sm leading-relaxed text-slate-300">
        A year of Starter, a 12-month company showcase and one Facebook
        spotlight.
      </p>
      <p className="mt-3 text-sm text-slate-300">
        $99 today for your first year. Renews at $190/year unless canceled. Your
        feature runs 12 months from publication after approval.
      </p>
      <a
        href="/founding-businesses#join"
        className="mt-5 inline-block rounded-xl bg-amber-300 px-5 py-3 font-bold text-slate-950 hover:bg-amber-200"
      >
        Claim a founding spot →
      </a>
      <a
        href="/founding-businesses"
        className="ml-5 mt-4 inline-block text-sm font-semibold text-blue-200 underline"
      >
        Meet our founding businesses
      </a>
    </section>
  );
}
