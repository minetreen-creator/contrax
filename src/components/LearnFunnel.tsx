import { FunnelStrip } from "~/components/FunnelStrip";
import type { LearningCounts } from "~/lib/learn-funnel";

const labels: [keyof LearningCounts, string][] = [["visitors", "Learning visitors"], ["opened", "Visited a course page"], ["started", "Started a lesson"], ["lesson", "Finished 1+ lessons"], ["finished", "Finished all lessons"], ["completed", "Got the certificate"], ["radar", "Radar after Learn"], ["signup", "Signup after Learn"], ["activated", "Activated after Learn"], ["subscriptions", "Active subscriptions"]];

export function LearnFunnel({ days = 30 }: { days?: number }) {
  return (
    <FunnelStrip
      id="learn-funnel-title"
      title="Learn funnel"
      subtitle={`learning visits → course activity → later business activity (${days} days)`}
      url={`/api/admin/learn-funnel?days=${days}`}
      labels={labels}
      note={<>Course completion is optional; each count uses the same learning audience. QA/admin/bot/test traffic excluded. Visits include the Learn hub and all three course pages. Later actions must follow a learning visit in this period. "Started a lesson" means a quiz answer or a finished lesson, not a page load. "Finished all lessons" counts course completions whether or not a certificate was requested; "Got the certificate" means the name-and-email certificate form was submitted. Lesson tracking began 2026-10-12, so earlier visits show only page visits and certificates. Active subscriptions count distinct accounts that signed up afterward and currently have an active subscription; selected plans and certificates do not count as payments.</>}
    />
  );
}
