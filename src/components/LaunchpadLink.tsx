export function LaunchpadLink() {
  return (
    <aside
      aria-label="Contrax Launchpad"
      className="my-6 rounded-2xl border border-blue-200 bg-blue-50 p-5 text-slate-900"
    >
      <p className="text-xs font-bold uppercase tracking-widest text-blue-700">
        Learn it. Put it to work.
      </p>
      <h2 className="mt-2 text-xl font-bold">Your free Contrax Launchpad</h2>
      <p className="mt-2 text-sm leading-relaxed text-slate-700">
        Turn these lessons into a business profile, capability statement and
        first-opportunity plan. Your course progress comes with you on this
        device.
      </p>
      <a
        href="/launchpad"
        className="mt-4 inline-flex rounded-xl bg-blue-700 px-5 py-3 text-sm font-bold text-white hover:bg-blue-800 focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-blue-600"
      >
        Open my Launchpad →
      </a>
    </aside>
  );
}
