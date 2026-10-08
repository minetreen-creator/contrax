export const LEARN_PATHS = ["/learn", "/learn/government-contracting", "/learn/intermediate-government-contracting", "/learn/advanced-government-contracting"];
export interface LearnVisitor {
  visitor_id: string; learn_at: string; opened_at?: string | null; completed_at?: string | null;
  radar_at?: string | null; signup_at?: string | null; activated_at?: string | null; active_user_id?: string | null;
}
export function learningCounts(rows: LearnVisitor[]) {
  const visitors = new Set<string>(); const opened = new Set<string>(); const completed = new Set<string>();
  const radar = new Set<string>(); const signup = new Set<string>(); const activated = new Set<string>(); const subscriptions = new Set<string>();
  for (const row of rows) {
    const since = Date.parse(row.learn_at);
    if (!row.visitor_id || !Number.isFinite(since)) continue;
    visitors.add(row.visitor_id);
    const after = (value?: string | null) => !!value && Date.parse(value) >= since;
    if (after(row.opened_at)) opened.add(row.visitor_id);
    if (after(row.completed_at)) completed.add(row.visitor_id);
    if (after(row.radar_at)) radar.add(row.visitor_id);
    if (after(row.signup_at)) {
      signup.add(row.visitor_id);
      if (row.active_user_id) subscriptions.add(row.active_user_id);
    }
    if (after(row.activated_at)) activated.add(row.visitor_id);
  }
  return { visitors: visitors.size, opened: opened.size, completed: completed.size, radar: radar.size, signup: signup.size, activated: activated.size, subscriptions: subscriptions.size };
}
export type LearningCounts = ReturnType<typeof learningCounts>;
