import { expect, test } from "bun:test";
import { recompetesClicksQuery, recompetesCounts, RECOMPETES_PATHS } from "./recompetes-funnel";

test("Contracts Ending Soon funnel combines page cohort and click counts", () => {
  const at = "2026-10-13T10:00:00Z";
  const later = "2026-10-13T11:00:00Z";
  expect(
    recompetesCounts(
      [
        { visitor_id: "a", story_at: at, signup_at: later, active_user_id: "7" },
        { visitor_id: "b", story_at: at },
      ],
      [
        { event_name: "recompetes_home_click", visitors: 4 },
        { event_name: "recompetes_signup_click", visitors: 2 },
      ],
    ),
  ).toEqual({ homeClicks: 4, visitors: 2, signupClicks: 2, upgradeClicks: 0, signup: 1, activated: 0, subscriptions: 1 });
  expect(RECOMPETES_PATHS).toContain("/recompetes");
});

test("click query filters traffic and takes events as a parameter", () => {
  const q = recompetesClicksQuery("HUMAN_FILTER");
  expect(q).toContain("HUMAN_FILTER");
  expect(q).toContain("event_name = ANY($3)");
  expect(q).toContain("COUNT(DISTINCT visitor_id)");
});
