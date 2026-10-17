import { useEffect, useState } from "react";
import { Rocket } from "lucide-react";
import { LAUNCHPAD_KEY, launchpadSteps, parseLaunchpad, type LaunchpadData } from "~/lib/launchpad";
import { pickLaunchpad, sanitizeWorkspace } from "~/lib/launchpad-sync";

/**
 * Dashboard card for Contrax Launchpad (owner 2026-10-17): the signed-in
 * user's progress through the six Launchpad steps, read from their account
 * copy (or this browser's, whichever is newer), with the next step and a link.
 */
export function LaunchpadDashboardCard() {
  const [state, setState] = useState<{ data: LaunchpadData; beginnerDone: boolean } | null>(null);

  useEffect(() => {
    let alive = true;
    (async () => {
      let local: LaunchpadData | null = null;
      try { local = parseLaunchpad(localStorage.getItem(LAUNCHPAD_KEY)); } catch {}
      let remote: LaunchpadData | null = null;
      try {
        const response = await fetch("/api/launchpad/workspace", { credentials: "same-origin" });
        if (response.ok) remote = sanitizeWorkspace(((await response.json()) as { data?: unknown }).data);
      } catch {}
      let beginnerDone = false;
      try {
        const { launchpadLearning } = await import("~/lib/launchpad-learning");
        const first = launchpadLearning((key) => localStorage.getItem(key))[0];
        beginnerDone = !!first && first.done === first.total;
      } catch {}
      const base = local ?? parseLaunchpad(null);
      if (alive) setState({ data: pickLaunchpad(base, remote).use, beginnerDone });
    })();
    return () => { alive = false; };
  }, []);

  const steps = state ? launchpadSteps(state.data, state.beginnerDone) : [];
  const done = steps.filter((s) => s.done).length;
  const next = steps.find((s) => !s.done);

  return (
    <a
      href="/launchpad"
      className="mb-4 block rounded-2xl border border-blue-200 bg-gradient-to-r from-[#0b1f45] to-[#12357a] p-5 text-white shadow-sm transition hover:brightness-110"
    >
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div className="flex items-start gap-3">
          <Rocket className="mt-0.5 h-5 w-5 shrink-0 text-amber-300" aria-hidden="true" />
          <div>
            <h2 className="font-bold">Contrax Launchpad</h2>
            <p className="mt-1 text-sm text-slate-200">
              {!state
                ? "Loading your progress…"
                : done === 0
                  ? "Build your capability statement, registration plan and first bid plan."
                  : next
                    ? `${done} of ${steps.length} steps done · Next: ${next.title}`
                    : `All ${steps.length} steps done. Revisit your plan as new bids appear.`}
            </p>
            {state && (
              <div className="mt-3 h-2 w-56 max-w-full overflow-hidden rounded-full bg-white/20" role="progressbar" aria-label="Launchpad progress" aria-valuemin={0} aria-valuemax={steps.length} aria-valuenow={done}>
                <div className="h-full bg-amber-400" style={{ width: `${(done / steps.length) * 100}%` }} />
              </div>
            )}
          </div>
        </div>
        <span className="shrink-0 text-sm font-semibold text-amber-300">Open Launchpad →</span>
      </div>
    </a>
  );
}
