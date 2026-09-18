import { useCallback, useEffect, useState } from "react";
import { getExampleBrief, type ExampleBrief as ExampleBriefData } from "~/lib/example-brief";
import { ExampleBriefView } from "~/components/ExampleBriefView";
import { trackEvent } from "~/lib/track";

/**
 * Reusable loader wrapper for the REAL cached example AI Executive Brief.
 *
 * ONE source of truth for BOTH surfaces:
 *   - variant="page"  → the standalone /example-brief route (dark slate page).
 *   - variant="embed" → the homepage section just under the hero (light band,
 *                        dark evidence card — harmonises with the US map below).
 *
 * It loads the brief client-side on mount via the shared `getExampleBrief`
 * server fn (never the paid analyze endpoint) and hands it to
 * src/components/ExampleBriefView.tsx, which owns every labeling/rendering rule
 * (including the owner's 2026-09-18 rule that the HOMEPAGE section renders
 * NOTHING when no currently-valid example exists — see that file).
 *
 * Honesty contract (non-negotiable):
 *   - The content is REAL cached `ai_summary` — nothing is fabricated.
 *   - It is always labeled an EXAMPLE so it is never mistaken for a live notice
 *     or a claim it was generated live for this visitor.
 *   - The loader only ever returns a fresh, currently-open, internally
 *     consistent solicitation (due date in the future, no passed pre-bid date,
 *     cached submission deadline matching the record's due date).
 *   - If nothing qualifies, the embed hides the whole section and the standalone
 *     page shows an honest fallback (never fake data, never a broken layout).
 */
export function ExampleBrief({
  variant = "page",
}: {
  variant?: "page" | "embed";
}) {
  const [brief, setBrief] = useState<ExampleBriefData | null | undefined>(
    undefined,
  );
  useEffect(() => {
    let active = true;
    getExampleBrief().then((b) => {
      if (!active) return;
      setBrief(b);
      // Funnel signal — fire-and-forget, additive event name. Only the embed
      // (homepage) reports view + CTA; the standalone page stays event-free.
      if (variant === "embed" && b) trackEvent("example_brief_view");
    });
    return () => {
      active = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [variant]);

  const handleRadarClick = useCallback(() => {
    trackEvent("example_brief_click", "radar");
  }, []);

  return (
    <ExampleBriefView
      brief={brief}
      variant={variant}
      onRadarClick={handleRadarClick}
    />
  );
}

export default ExampleBrief;
