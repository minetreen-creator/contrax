import { FunnelStrip } from "~/components/FunnelStrip";
import type { RecompetesCounts } from "~/lib/recompetes-funnel";

const labels: [keyof RecompetesCounts, string][] = [
  ["homeClicks", "Clicked it on the homepage"],
  ["visitors", "Visited /recompetes"],
  ["signupClicks", "Clicked create account"],
  ["upgradeClicks", "Clicked upgrade"],
  ["signup", "Signup after visit"],
  ["activated", "Activated after visit"],
  ["subscriptions", "Active subscriptions"],
];

export function RecompetesFunnel({ days = 30 }: { days?: number }) {
  return (
    <FunnelStrip
      id="recompetes-funnel-title"
      title="Contracts Ending Soon funnel"
      subtitle={`homepage section → /recompetes → signup (${days} days)`}
      url={`/api/admin/recompetes-funnel?days=${days}`}
      labels={labels}
      note={<>Clicks count distinct visitors per button. Signup, activation and subscriptions must follow a /recompetes visit in this period; they show association, not proof the page caused them. Signups made through the page's button also carry signup source "recompetes" on the Signups tab. QA/admin/bot/test traffic excluded. Tracking began 2026-10-13.</>}
    />
  );
}
