import { useEffect, useState } from "react";
import { COOP_BY_KEY, coopPath } from "~/lib/coop-contracts";
import { trackEvent } from "~/lib/track";

/**
 * Radar note (owner 2026-11-10, co-op contracts): when a co-op category for the searched trade is open
 * for vendors, say so and link to /co-op-contracts. Renders nothing otherwise.
 */
export function CoopCallout({ trade }: { trade: string }) {
  const [d, setD] = useState<{ trade: string | null; count: number; next: { title: string; coop: string; dueAt: string } | null } | null>(null);
  useEffect(() => {
    const q = trade.trim();
    if (!q) return setD(null);
    let live = true;
    fetch(`/api/coop-open?trade=${encodeURIComponent(q)}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((j) => live && setD(j))
      .catch(() => {});
    return () => {
      live = false;
    };
  }, [trade]);
  if (!d?.trade || !d.count || !d.next) return null;
  const due = new Date(d.next.dueAt).toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "America/Chicago" });
  return (
    <a
      href={coopPath(d.trade)}
      onClick={() => trackEvent("radar_coop_callout", d.trade ?? "")}
      className="mt-4 block rounded-xl border border-emerald-500/40 bg-emerald-500/10 px-4 py-3 text-sm text-emerald-100 no-underline hover:border-emerald-400"
    >
      <span className="font-semibold text-white">
        {d.count === 1 ? "A co-op contract is open for your trade" : `${d.count} co-op contracts are open for your trade`}:
      </span>{" "}
      {d.next.title} ({COOP_BY_KEY[d.next.coop]?.name}, due {due}). Win it once and member agencies can buy from you without a bid →
    </a>
  );
}
