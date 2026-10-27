import { useRef, useState } from "react";
import { redirectToCheckout } from "~/lib/checkout";
import { STARTER_FIRST_MONTH_PRICE } from "~/lib/starter-offer";
import { trackEvent } from "~/lib/track";
import {
  BID_VALUE_DEFAULTS,
  BID_VALUE_LIMITS,
  STARTER_YEARLY_COST,
  computeBidValue,
  formatDollars,
  formatJobs,
  type BidValueInputs,
} from "~/lib/bid-value-calculator";

/**
 * "What could extra bids be worth?" card on /pricing (owner 2026-10-27).
 * The visitor's own numbers in, a yearly figure next to the Starter price out.
 * It is labelled an estimate and never claims Contrax changes a win rate.
 */
export function BidValueCalculator() {
  // Raw text per box, so clearing a box to retype doesn't snap it to 0.
  const [text, setText] = useState<Record<keyof BidValueInputs, string>>({
    extraBidsPerMonth: String(BID_VALUE_DEFAULTS.extraBidsPerMonth),
    avgJobValue: String(BID_VALUE_DEFAULTS.avgJobValue),
    winRatePct: String(BID_VALUE_DEFAULTS.winRatePct),
  });
  const tracked = useRef(false);
  const inputs: BidValueInputs = {
    extraBidsPerMonth: Number(text.extraBidsPerMonth || 0),
    avgJobValue: Number(text.avgJobValue || 0),
    winRatePct: Number(text.winRatePct || 0),
  };
  const result = computeBidValue(inputs);

  const update = (key: keyof BidValueInputs) => (e: React.ChangeEvent<HTMLInputElement>) => {
    const value = e.target.value;
    setText((prev) => ({ ...prev, [key]: value }));
    if (!tracked.current) {
      tracked.current = true;
      trackEvent("pricing_calculator_used", key);
    }
  };

  const field = (key: keyof BidValueInputs, label: string, prefix?: string, suffix?: string) => (
    <label className="block">
      <span className="text-sm font-medium text-slate-700">{label}</span>
      <div className="mt-1 flex items-center rounded-lg border border-slate-300 bg-white px-3 focus-within:border-amber-500 focus-within:ring-2 focus-within:ring-amber-500/20">
        {prefix && <span className="text-slate-500">{prefix}</span>}
        <input
          type="number"
          inputMode="numeric"
          min={BID_VALUE_LIMITS[key].min}
          max={BID_VALUE_LIMITS[key].max}
          step={key === "avgJobValue" ? 1000 : 1}
          value={text[key]}
          onChange={update(key)}
          className="w-full bg-transparent py-2 text-base text-slate-900 outline-none"
        />
        {suffix && <span className="text-slate-500">{suffix}</span>}
      </div>
    </label>
  );

  return (
    <div className="mx-auto mt-14 max-w-4xl rounded-2xl border border-slate-200 bg-slate-50 p-6 sm:p-8">
      <h3 className="text-xl font-bold text-slate-900">What could a few more bids be worth?</h3>
      <p className="mt-1 text-sm text-gray-600">Put in your own numbers.</p>
      <div className="mt-6 grid gap-6 md:grid-cols-2">
        <div className="space-y-4">
          {field("extraBidsPerMonth", "Extra bids you could send each month")}
          {field("avgJobValue", "Average job value", "$")}
          {field("winRatePct", "How often you win a bid", undefined, "%")}
        </div>
        <div className="flex flex-col justify-center rounded-xl bg-white p-6 text-center shadow-sm">
          <p className="text-sm text-gray-600">
            {result.extraBidsPerYear} more bids a year at your win rate is about {formatJobs(result.extraWinsPerYear)}, or
          </p>
          <p className="mt-2 text-4xl font-extrabold text-emerald-700">{formatDollars(result.extraRevenuePerYear)}</p>
          <p className="text-sm text-gray-600">a year in extra work</p>
          <p className="mt-4 text-sm text-slate-800">
            Starter costs {formatDollars(STARTER_YEARLY_COST)} a year.
            {result.timesStarterCost >= 2 && <> That's {result.timesStarterCost.toLocaleString("en-US")}× its cost.</>}
          </p>
          <button
            type="button"
            onClick={() => {
              trackEvent("pricing_calculator_cta", String(result.extraRevenuePerYear));
              void redirectToCheckout("starter");
            }}
            className="mt-5 w-full rounded-xl bg-amber-500 px-6 py-3 text-sm font-semibold text-white transition-all active:scale-[0.98]"
          >
            Start Starter for ${STARTER_FIRST_MONTH_PRICE}
          </button>
        </div>
      </div>
      <p className="mt-4 text-xs text-gray-500">
        An estimate from the numbers you enter, not a promise. Contrax finds the bids; winning them is up to you.
      </p>
    </div>
  );
}
