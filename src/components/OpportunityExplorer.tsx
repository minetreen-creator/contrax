import { lazy, Suspense, useState } from "react";
import { WinCalculator } from "~/components/WinCalculator";
const LocalAwards = lazy(() =>
  import("~/components/LocalAwards").then((m) => ({ default: m.LocalAwards })),
);
export function OpportunityExplorer() {
  const [tab, setTab] = useState<"calculator" | "local">("calculator");
  return (
    <section
      aria-label="Explore government contracting"
      className="mx-auto mt-10 max-w-[1120px] px-4 sm:px-6"
    >
      <div
        role="tablist"
        aria-label="Government contracting figures"
        className="mb-3 flex flex-wrap gap-2"
      >
        {(
          [
            ["calculator", "What could you win?"],
            ["local", "Federal work near you"],
          ] as const
        ).map(([key, label]) => (
          <button
            type="button"
            role="tab"
            id={`explorer-tab-${key}`}
            aria-selected={tab === key}
            aria-controls={`explorer-panel-${key}`}
            tabIndex={tab === key ? 0 : -1}
            onKeyDown={(e) => {
              if (["ArrowLeft", "ArrowRight", "Home", "End"].includes(e.key)) {
                e.preventDefault();
                const next =
                  e.key === "Home"
                    ? "calculator"
                    : e.key === "End"
                      ? "local"
                      : tab === "calculator"
                        ? "local"
                        : "calculator";
                setTab(next);
                requestAnimationFrame(() =>
                  document.getElementById(`explorer-tab-${next}`)?.focus(),
                );
              }
            }}
            key={key}
            onClick={() => setTab(key)}
            className={`rounded-xl px-5 py-3 text-sm font-bold ${tab === key ? "bg-[#14213d] text-white" : "border border-slate-300 bg-white text-slate-700 hover:bg-slate-100"}`}
          >
            {label}
          </button>
        ))}
      </div>
      <div
        role="tabpanel"
        id={`explorer-panel-${tab}`}
        aria-labelledby={`explorer-tab-${tab}`}
      >
        {tab === "calculator" ? (
          <WinCalculator embedded />
        ) : (
          <Suspense
            fallback={
              <p
                role="status"
                className="rounded-3xl bg-[#14213d] p-10 text-white"
              >
                Loading local awards…
              </p>
            }
          >
            <LocalAwards />
          </Suspense>
        )}
      </div>
    </section>
  );
}
