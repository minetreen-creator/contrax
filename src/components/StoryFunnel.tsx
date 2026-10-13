import { FunnelStrip } from "~/components/FunnelStrip";
import type { StoryCounts } from "~/lib/story-funnel";

const labels: [keyof StoryCounts, string][] = [
  ["visitors", "Story visitors"],
  ["radar", "Radar after Story"],
  ["signup", "Signup after Story"],
  ["activated", "Activated after Story"],
  ["subscriptions", "Active subscriptions"],
];

export function StoryFunnel({ days = 30 }: { days?: number }) {
  return (
    <FunnelStrip
      id="story-funnel-title"
      title="Story funnel"
      subtitle={`The Story Behind Contrax → later business activity (${days} days)`}
      url={`/api/admin/story-funnel?days=${days}`}
      labels={labels}
      emptyKey="visitors"
      emptyText={`no visits to /our-story in the last ${days} days. The panel appears once someone visits.`}
      note={<>Each count uses the same story audience. QA/admin/bot/test traffic excluded. Visits to /our-story count once per tracked visitor. Actions must occur after a story visit and within the selected period; these counts show association, not proof that the story caused conversion. Active subscriptions count distinct accounts that signed up afterward and currently have an active subscription. Selected plans do not count as payments.</>}
    />
  );
}
