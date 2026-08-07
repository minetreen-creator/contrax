import { useState } from "react";

interface GettingStartedProps {
  hasSavedBids: boolean;
  hasDrafts: boolean;
}

export function GettingStarted({ hasSavedBids, hasDrafts }: GettingStartedProps) {
  const [expanded, setExpanded] = useState(true);
  const steps = [
    { icon: "✅", title: "Complete your business profile", description: "Your profile is ready — Contrax can now match opportunities to your business.", done: true, href: "/onboarding", cta: "View profile" },
    { icon: "📋", title: "Browse your bid matches", description: "Explore contracts filtered for your services, location, and certifications.", done: hasSavedBids, href: "/awards", cta: "Browse matches" },
    { icon: "💾", title: "Save your first bid", description: "Track a promising opportunity so it stays easy to find and act on.", done: hasSavedBids, href: "/awards", cta: "Find a bid" },
    { icon: "✏️", title: "Generate a proposal draft", description: "Turn a saved opportunity into a tailored first draft with AI.", done: hasDrafts, href: "/dashboard", cta: "Generate a draft" },
  ];

  if (steps.every((step) => step.done)) return null;

  return (
    <section className="mb-8 rounded-2xl border border-blue-200 bg-blue-50/50 p-6 shadow-sm" aria-labelledby="getting-started-heading">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h2 id="getting-started-heading" className="text-xl font-bold text-slate-900">🚀 Getting Started</h2>
          <p className="mt-1 text-sm text-slate-600">Here&apos;s how to get the most from Contrax</p>
        </div>
        <button type="button" onClick={() => setExpanded((value) => !value)} className="shrink-0 rounded-lg px-2 py-1 text-sm font-semibold text-blue-700 hover:bg-blue-100" aria-expanded={expanded}>
          {expanded ? "Collapse" : "Show steps"}
        </button>
      </div>
      {expanded && (
        <ol className="mt-5 space-y-3">
          {steps.map((step) => (
            <li key={step.title} className="flex items-start gap-3 rounded-xl border border-blue-100 bg-white/80 p-3">
              <span className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-sm ${step.done ? "bg-green-100" : "bg-amber-100"}`} aria-label={step.done ? "Complete" : "Incomplete"}>{step.done ? "✓" : step.icon}</span>
              <div className="min-w-0 flex-1"><p className={`text-sm font-semibold ${step.done ? "text-slate-500 line-through" : "text-slate-900"}`}>{step.title}</p><p className="mt-0.5 text-xs text-slate-500">{step.description}</p></div>
              {!step.done && <a href={step.href} className="shrink-0 text-xs font-bold text-blue-700 hover:text-blue-900">{step.cta} →</a>}
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}
