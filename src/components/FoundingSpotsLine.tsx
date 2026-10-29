import { useEffect, useState } from "react";
import { trackEvent } from "~/lib/track";

/**
 * "Founding Business: $99 for the whole first year — N of 10 spots left."
 * Live count from /api/founding-spots; renders nothing when no spot is open
 * or the count can't be read (never a made-up number).
 */
export function FoundingSpotsLine({ className = "", where }: { className?: string; where: string }) {
  const [remaining, setRemaining] = useState<number | null>(null);
  const [limit, setLimit] = useState<number | null>(null);
  useEffect(() => {
    fetch("/api/founding-spots")
      .then((r) => (r.ok ? r.json() : null))
      .then((d: { remaining: number | null; limit?: number } | null) => {
        setRemaining(typeof d?.remaining === "number" ? d.remaining : null);
        setLimit(typeof d?.limit === "number" ? d.limit : null);
      })
      .catch(() => setRemaining(null));
  }, []);
  if (!remaining || remaining <= 0 || !limit) return null;
  return (
    <a
      href="/founding-businesses"
      onClick={() => trackEvent("founding_offer_click", where)}
      className={className}
    >
      Or become a Founding Business: $99 for the whole first year, {remaining} of {limit} spots left →
    </a>
  );
}
