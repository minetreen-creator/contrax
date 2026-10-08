import { expect, test } from "bun:test";
import { learningCounts } from "./learn-funnel";
const before = "2026-10-07T10:00:00Z", start = "2026-10-08T10:00:00Z", after = "2026-10-08T11:00:00Z";
test("learning cohorts count later activity, not prior signups or certificates as revenue", () => {
  expect(learningCounts([{ visitor_id: "a", learn_at: start, signup_at: before, completed_at: after, active_user_id: "1" }, { visitor_id: "b", learn_at: start, radar_at: after, opened_at: start }])).toEqual({ visitors: 2, opened: 1, completed: 1, radar: 1, signup: 0, activated: 0, subscriptions: 0 });
});
test("repeat visits and multiple devices don't multiply subscriptions", () => {
  const row = { visitor_id: "a", learn_at: start, signup_at: after, active_user_id: "1" };
  expect(learningCounts([row, row, { ...row, visitor_id: "b" }])).toEqual({ visitors: 2, opened: 0, completed: 0, radar: 0, signup: 2, activated: 0, subscriptions: 1 });
});
test("invalid data and no activity produce honest zeros", () => {
  expect(learningCounts([{ visitor_id: "", learn_at: start }, { visitor_id: "bad", learn_at: "invalid" }])).toEqual(learningCounts([]));
});
