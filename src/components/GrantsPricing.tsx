const SERIF = "[font-family:Charter,'Iowan_Old_Style',Georgia,serif]";

const GRANTS_REPORT_PAYMENT_LINK = "https://buy.stripe.com/8x26oJcpV9fCcos7eEf7i0b";

// FAIL-SAFE label (owner directive rev 327, 2026-09-23) — the exact words /grants
// already shows when the upgrade signal is unavailable. Owner copy: do not alter.
const GRANTS_COMING_SOON_LABEL = "Coming soon";

type GrantsTier = {
  name: string;
  price: string;
  period: string;
  bestFor: string;
  included: string;
  ctaLabel: string;
  ctaHref: string;
  external?: boolean;
  /**
   * FAIL-SAFE (owner directive rev 327): this tier's CTA is only live while the
   * subscription-upgrade signal is available. When it is not, the CTA renders as
   * plain non-interactive text — never a payment link and never a button that
   * could break. Everything else about the row (name, price, copy) is unchanged.
   */
  gatedByUpgradeSignal?: boolean;
  /** Only the $49 report carries the required not-guaranteed / no-submission line. */
  disclaimer?: string;
};

const GRANTS_TIERS: GrantsTier[] = [
  {
    name: "Nonprofit Free",
    price: "$0",
    period: "forever",
    bestFor: "Verified 501(c)(3) organizations",
    included:
      "Basic grant search, standard filters, grant previews and official application links. No credit card, trial, or expiration.",
    ctaLabel: "Search grants →",
    ctaHref: "/grants",
  },
  {
    name: "Grants Plus",
    price: "$19",
    period: "/month",
    bestFor: "Businesses and nonprofits wanting ongoing tools",
    included:
      "Unlimited searches and full grant details, advanced filters, saved opportunities, deadline tracking, weekly matching alerts, and enhanced summaries.",
    ctaLabel: "Get Grants Plus →",
    ctaHref: "/grants",
    gatedByUpgradeSignal: true,
  },
  {
    name: "Personalized Grant Opportunity Report",
    price: "$49",
    period: "one-time",
    bestFor: "Organizations wanting hands-on research",
    included:
      "Founder-researched report identifying the strongest opportunities, eligibility observations, deadlines, official links, reasons each grant may fit, and recommended next steps. Delivered within three business days.",
    ctaLabel: "Get the $49 Report →",
    ctaHref: GRANTS_REPORT_PAYMENT_LINK,
    external: true,
    disclaimer:
      "Optional — free grant search remains available to verified nonprofits. Matches and funding are not guaranteed, and this report does not include writing or submitting the grant application.",
  },
];

/**
 * The homepage Contrax Grants tier table (owner order 2026-09-16; three-tier
 * table + copy owner-locked 2026-09-23).
 *
 * FAIL-SAFE (owner directive rev 327, 2026-09-23): `grantsUpgradeEnabled` is the
 * loader's server-side read of the SAME upgrade signal /grants gates on. When it
 * is false/absent the gated tier ("Grants Plus") renders its CTA as plain,
 * non-interactive text — never a payment link, never a button — so an
 * unavailable Stripe configuration or subscription signal can never surface a
 * broken payment affordance. When it is true the row renders exactly as it did
 * before this directive (byte-identical markup; the <a> below keeps its original
 * indentation so a diff shows it as untouched context). The other two rows are
 * never gated. Optional with a FAIL-CLOSED default: a caller that forgets the
 * prop gets the "Coming soon" fallback, never a live payment CTA.
 */
export function GrantsPricing({
  grantsUpgradeEnabled = false,
}: {
  grantsUpgradeEnabled?: boolean;
}) {
  return (
    <section id="grants" aria-label="Contrax Grants plans" className="scroll-mt-24 bg-[#f5f7fa] py-16 text-slate-900">
      <div className="mx-auto max-w-[1120px] px-4 sm:px-6">
        <div className="max-w-3xl">
          <p className="text-sm font-semibold uppercase tracking-widest text-[#8a6a1d]">
            Contrax Grants
          </p>
          <h2 className={`${SERIF} mt-3 text-[clamp(26px,3.4vw,34px)] leading-[1.15] font-bold text-[#0f1f38]`}>
            Find grants your organization actually qualifies for.
          </h2>
          <p className="mt-4 max-w-2xl text-lg leading-relaxed text-[#56647a]">
            Contrax Grants searches federal grant opportunities on Grants.gov by keyword,
            applicant type, funding category, agency, and status — source-verbatim details,
            nothing invented. Basic grant search is free for verified nonprofits, and it stays
            free.
          </p>
        </div>

        <div className="mt-9 grid gap-5 lg:grid-cols-3">
        {GRANTS_TIERS.map((tier) => {
          // FAIL-SAFE (owner directive rev 327): an unavailable upgrade signal
          // turns the gated tier's CTA into plain non-interactive text. No href,
          // no button, no payment link — nothing that can break.
          const ctaGated =
            tier.gatedByUpgradeSignal === true && !grantsUpgradeEnabled;
          return (
          <div
            key={tier.name}
            className="flex flex-col rounded-2xl border border-gray-200 bg-white p-6 shadow-sm transition-all hover:shadow-md"
          >
            <h3 className="text-xl font-bold text-slate-900">{tier.name}</h3>
            <p className="mt-1 text-sm text-gray-500">{tier.bestFor}</p>
            <p className="mt-5">
              <span className="text-4xl font-extrabold text-slate-900">{tier.price}</span>{" "}
              <span className="text-gray-500">{tier.period}</span>
            </p>
            <p className="mt-5 flex-1 text-sm leading-relaxed text-gray-700">
              <span className="font-semibold text-slate-900">Included: </span>
              {tier.included}
            </p>
            {tier.disclaimer ? (
              <p className="mt-4 rounded-xl bg-slate-50 px-3 py-2.5 text-xs leading-relaxed text-gray-600">
                {tier.disclaimer}
              </p>
            ) : null}
            {/* FAIL-SAFE (owner directive rev 327, 2026-09-23): with the upgrade
                signal unavailable the gated CTA becomes plain, non-interactive
                text — text-only, so there is no href, no button and no payment
                link to break. The <a> below is the pre-directive markup verbatim
                at its original indentation, so when the signal IS available the
                row renders byte-identically to the launched page. */}
            {ctaGated ? (
              <p
                data-grants-cta="coming-soon"
                className="mt-6 block w-full rounded-xl px-6 py-3 text-center text-sm font-semibold text-gray-500"
              >
                {GRANTS_COMING_SOON_LABEL}
              </p>
            ) : (
            <a
              href={tier.ctaHref}
              target={tier.external ? "_blank" : undefined}
              rel={tier.external ? "noopener noreferrer" : undefined}
              className={`mt-6 block w-full rounded-xl px-6 py-3 text-center text-sm font-semibold transition-all active:scale-[0.98] ${
                tier.external
                  ? "bg-amber-500 text-white hover:bg-amber-400"
                  : "border-2 border-slate-900 text-slate-900 hover:bg-slate-900 hover:text-white"
              }`}
            >
              {tier.ctaLabel}
            </a>
            )}
          </div>
          );
        })}
        </div>

        <p className="mt-6 text-xs text-gray-500">
          Prices in US dollars. Verified nonprofits keep free grant search with no credit card, no
          trial, and no expiration.
        </p>
      </div>
    </section>
  );
}
