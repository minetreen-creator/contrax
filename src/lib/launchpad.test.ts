import { launchpadLearning } from "./launchpad-learning";
import { LESSONS } from "./course-construction";
import { INTERMEDIATE_COURSE } from "./course-intermediate";
import { ADVANCED_COURSE } from "./course-advanced";
import { test } from "bun:test";
import assert from "node:assert/strict";
import {
  emptyLaunchpad,
  parseLaunchpad,
  capabilityReady,
  launchpadSteps,
  launchpadRadarHref,
  launchpadCourseHref,
  safeOpportunityUrl,
  capabilityPrintHtml,
  capabilityText,
} from "./launchpad";
test("Launchpad restores safe drafts, computes preparation steps and exports only supplied facts", () => {
  const d = emptyLaunchpad();
  assert.equal(launchpadSteps(d, false).filter((x) => x.done).length, 0);
  assert.throws(() => parseLaunchpad("{bad"));
  assert.throws(() => parseLaunchpad('{"version":9}'));
  assert.deepEqual(parseLaunchpad(null), d);
  const restored = parseLaunchpad(
    JSON.stringify({
      version: 1,
      profile: { company: "Acme", state: "xx" },
      registrations: ["buyers", "bogus", "buyers"],
      bid: { scope: "true", decision: "approved" },
    }),
  );
  assert.equal(restored.profile.company, "Acme");
  assert.equal(restored.profile.state, "");
  assert.deepEqual(restored.registrations, ["buyers"]);
  assert.equal(restored.bid.scope, false);
  assert.equal(restored.bid.decision, "");
  assert.equal(safeOpportunityUrl("javascript:alert(1)"), null);
  assert.equal(safeOpportunityUrl("https://user:password@example.com"), null);
  assert.equal(
    safeOpportunityUrl("https://example.com/bid"),
    "https://example.com/bid",
  );
  d.profile = {
    ...d.profile,
    company: "Acme <script>alert(1)</script>",
    trade: "cleaning",
    state: "VA",
    contact: "Owner",
    email: "owner@example.com",
    summary: "We clean offices.",
    competencies: "Janitorial",
    differentiators: "Local team",
  };
  assert(capabilityReady(d.profile));
  assert(!capabilityReady({ ...d.profile, email: "wrong" }));
  const print = capabilityPrintHtml(d.profile);
  assert(!print.includes("<script>"));
  assert(print.includes("&lt;script&gt;"));
  assert(!capabilityText(d.profile).includes("UEI:"));
  assert(capabilityText(d.profile).includes("Company overview"));
  const href = new URL(launchpadRadarHref(d.profile), "https://example.com");
  assert.equal(href.searchParams.get("trade"), "cleaning");
  assert.equal(href.searchParams.get("state"), "VA");
  assert.equal(href.searchParams.get("source"), "learn");
  d.registrations = ["buyers", "records", "requirements", "dates"];
  d.bid = {
    title: "Office cleaning",
    url: "https://example.com/bid",
    decision: "pass",
    notes: "Not enough staff",
    scope: true,
    eligibility: false,
    timing: true,
    action: "Find a smaller bid",
    date: "2026-10-20",
  };
  assert.equal(launchpadSteps(d, true).filter((x) => x.done).length, 6);
  assert.deepEqual(parseLaunchpad(JSON.stringify(d)), d);
  console.log(
    "PASS: 22 Launchpad domain assertions (draft parsing, unsafe links, progress decisions, statement readiness, print escaping, Radar criteria, save round-trip).",
  );
});

test("Course links keep the chosen state and only pass supported business criteria", () => {
  const profile = {
    ...emptyLaunchpad().profile,
    state: "VA",
    trade: "janitorial",
  };
  assert.equal(
    launchpadCourseHref("/learn/government-contracting", profile, false),
    "/learn/government-contracting?state=VA",
  );
  assert.equal(
    launchpadCourseHref("/learn/intermediate-government-contracting", profile),
    "/learn/intermediate-government-contracting?state=VA&trade=janitorial",
  );
});

test("Launchpad uses actual course quiz progress, not page views or unknown lesson IDs", () => {
  const stored = new Map<string, string>();
  const get = (key: string) => stored.get(key) ?? null;
  assert(launchpadLearning(get).every((course) => course.done === 0));
  stored.set(
    "contrax_course_construction_v1",
    JSON.stringify([...LESSONS.map((lesson) => lesson.id), "unknown"]),
  );
  for (const course of [INTERMEDIATE_COURSE, ADVANCED_COURSE])
    stored.set(
      course.key,
      JSON.stringify({
        answers: Object.fromEntries(
          course.lessons.map((lesson) => [
            lesson.id,
            lesson.quiz.map((question) => question.answer),
          ]),
        ),
      }),
    );
  assert(
    launchpadLearning(get).every((course) => course.done === course.total),
  );
  const course = INTERMEDIATE_COURSE;
  stored.set(
    course.key,
    JSON.stringify({
      answers: {
        [course.lessons[0].id]: course.lessons[0].quiz.map(
          (question) => (question.answer + 1) % question.options.length,
        ),
      },
    }),
  );
  assert.equal(launchpadLearning(get)[1].done, 0);
});
