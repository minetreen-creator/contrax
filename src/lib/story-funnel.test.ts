import { expect, test } from "bun:test";
import { storyCounts, storyQuery, STORY_PATHS } from "./story-funnel";

const story_at = "2026-10-11T01:00:00Z";
const before = "2026-10-10T23:00:00Z";
const after = "2026-10-11T02:00:00Z";

test("story audience only counts later activity and subscriptions after signup", () => {
  expect(storyCounts([
    { visitor_id: "a", story_at, radar_at: before, signup_at: before, active_user_id: "1" },
    { visitor_id: "b", story_at, radar_at: after, activated_at: after },
  ])).toEqual({ visitors: 2, radar: 1, signup: 0, activated: 1, subscriptions: 0 });
});
test("repeat visits and devices do not multiply subscription accounts", () => {
  const row = { visitor_id: "a", story_at, signup_at: after, active_user_id: "1" };
  expect(storyCounts([row, row, { ...row, visitor_id: "b" }])).toEqual({
    visitors: 2, radar: 0, signup: 2, activated: 0, subscriptions: 1,
  });
});
test("empty and invalid visitors produce zero counts", () => {
  expect(storyCounts([{ visitor_id: "", story_at }, { visitor_id: "bad", story_at: "invalid" }])).toEqual(storyCounts([]));
});
test("query limits the story cohort, filters traffic, and requires later events", () => {
  const query = storyQuery("HUMAN_FILTER", "QA_USER_FILTER");
  expect(query.split("HUMAN_FILTER").length - 1).toBe(2);
  expect(query).toContain("e.created_at > s.story_at");
  expect(query).toContain("= ANY($3)");
  expect(query).toContain("u.subscription_status = 'active'");
  expect(query).toContain("QA_USER_FILTER");
  expect(query).not.toContain("plan =");
  expect(STORY_PATHS).toEqual(["/our-story", "/our-story/"]);
});
