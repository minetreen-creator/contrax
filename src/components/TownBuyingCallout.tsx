import { TownZipForm } from "~/components/TownZipForm";

/**
 * Homepage band for "What's Your Town Buying?" (owner 2026-10-23: "shouldn't
 * this be on the main page?"). Same ZIP box as /town.
 */
export function TownBuyingCallout() {
  return (
    <section aria-labelledby="town-buying-title" className="mx-auto mt-12 max-w-[1120px] px-4 sm:px-6">
      <div className="rounded-3xl bg-gradient-to-br from-[#0a1f44] to-[#1d4f99] px-6 py-10 text-center text-white shadow-xl sm:px-10">
        <p className="text-xs font-bold uppercase tracking-[0.2em] text-amber-400">New · Free · No signup</p>
        <h2 id="town-buying-title" className="mt-3 text-3xl font-extrabold tracking-tight sm:text-4xl">
          What&apos;s your town <span className="text-amber-400">buying?</span> 👀
        </h2>
        <p className="mx-auto mt-3 max-w-xl text-blue-100">
          Type your ZIP and see every government contract open in your town and the towns around you, then share it with a local business owner.
        </p>
        <div className="mt-6">
          <TownZipForm size="sm" />
        </div>
      </div>
    </section>
  );
}
