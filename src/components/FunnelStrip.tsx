import { useEffect, useState, type ReactNode } from "react";

/**
 * Compact admin funnel panel (owner 2026-10-13): one row of small counts, the
 * explanation folded under "How these are counted", and — when `hideWhenEmpty`
 * is set — a single muted line instead of a panel of zeros.
 */
export function FunnelStrip<K extends string>({
  id,
  title,
  subtitle,
  url,
  labels,
  emptyKey,
  emptyText,
  note,
}: {
  id: string;
  title: string;
  subtitle: string;
  url: string;
  labels: [K, string][];
  /** When this count is 0, show `emptyText` instead of the panel. */
  emptyKey?: K;
  emptyText?: string;
  note: ReactNode;
}) {
  const [counts, setCounts] = useState<Record<K, number> | null>(null);
  const [error, setError] = useState("");
  useEffect(() => {
    const controller = new AbortController();
    setCounts(null);
    setError("");
    fetch(url, { signal: controller.signal })
      .then(async (response) => {
        const result = await response.json();
        if (!response.ok) throw new Error(result.error || `Failed to load ${title.toLowerCase()}`);
        if (!controller.signal.aborted) setCounts(result.counts);
      })
      .catch((err) => {
        if (!controller.signal.aborted) setError(err instanceof Error ? err.message : `Failed to load ${title.toLowerCase()}`);
      });
    return () => controller.abort();
  }, [url, title]);

  if (counts && emptyKey && !counts[emptyKey]) {
    return (
      <p className="text-xs text-slate-500">
        <span className="font-semibold text-slate-700">{title}:</span> {emptyText}
      </p>
    );
  }
  return (
    <section aria-labelledby={id}>
      <h2 id={id} className="text-base font-semibold text-slate-900">
        {title} <span className="text-xs font-normal text-slate-400">· {subtitle}</span>
      </h2>
      {error ? (
        <p role="alert" className="mt-2 rounded-xl bg-red-50 p-3 text-sm text-red-700">{error}</p>
      ) : !counts ? (
        <p className="mt-2 rounded-xl bg-white p-3 text-sm text-slate-500">Loading…</p>
      ) : (
        <div className="mt-2 flex flex-wrap gap-2">
          {labels.map(([key, label]) => (
            <div key={key} className="min-w-[7.5rem] flex-1 rounded-lg border border-slate-200 bg-white px-3 py-2">
              <p className="text-[11px] leading-tight text-slate-500">{label}</p>
              <p className="text-lg font-bold text-slate-900">{counts[key]}</p>
            </div>
          ))}
        </div>
      )}
      <details className="mt-1 text-xs text-slate-500">
        <summary className="cursor-pointer select-none">How these are counted</summary>
        <div className="mt-1">{note}</div>
      </details>
    </section>
  );
}
