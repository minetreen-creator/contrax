/**
 * FUNNEL UX — the rendered Radar card (owner rework 2026-09-26, PR-A).
 *
 * The unit rules live in src/lib/funnel-ux.test.ts. THIS suite renders the real
 * components with `react-dom/server` and pins what a visitor actually sees:
 *
 *   C. the "✦ Best match" badge appears on the flagged card and on no other, and
 *      the badge is OPT-IN — an unflagged card renders byte-identically to the
 *      markup this component produced before the badge existed.
 *   E. the owner-verbatim post-save prompt ("We'll track this opportunity for
 *      you.") renders with its dismiss control.
 *   D. an ANONYMOUS card (no `user`) keeps exactly the one action it has today:
 *      the full-width amber "✦ Get the AI Executive Brief" link — no save UI.
 *
 * Deterministic, network-free, database-free: every input is a literal, and the
 * components are rendered in-process (the same technique as
 * tests/homepage-grants-failsafe.test.tsx). No mock.module anywhere — this file
 * needs no module substitution at all (skill: contrax-bun-mock-module-leak).
 */
import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { renderToStaticMarkup } from "react-dom/server";

import { RadarCard, SaveTrackingPrompt, type RadarMatch } from "~/routes/radar";
import { BEST_MATCH_BADGE, SAVE_TRACKING_PROMPT } from "~/lib/funnel-ux";

const REPO_SRC = join(import.meta.dir, "..", "src");

function match(overrides: Partial<RadarMatch> = {}): RadarMatch {
  return {
    id: 4242,
    title: "Janitorial Services for the Federal Building",
    agency: "General Services Administration",
    category: "Janitorial",
    location: "Richmond, Virginia",
    set_aside: "SDVOSB",
    set_aside_label: "SDVOSB",
    naics_code: "561720",
    source_url: "https://sam.gov/opp/abc",
    estimated_value: "$250,000",
    estimated_value_num: 250000,
    due_date: "2026-12-01",
    days_remaining: 40,
    score: 88,
    score_label: "Strong Match",
    trade_provenance: null,
    reasons: ["NAICS matches your trade"],
    qualifications: ["Your SDVOSB certification qualifies"],
    requirements: ["See the original solicitation"],
    next_action: "Review the solicitation and prepare your bid.",
    incumbent: null,
    learned: null,
    ...overrides,
  };
}

const card = (props: Partial<Parameters<typeof RadarCard>[0]> = {}) =>
  renderToStaticMarkup(
    <RadarCard
      match={match()}
      certLabel="SDVOSB"
      index={1}
      total={5}
      trade="janitorial"
      state="VA"
      cert="sdvosb"
      sizePref="any"
      {...props}
    />,
  );

describe("RadarCard — the best-match treatment (item 3)", () => {
  test("the flagged card carries the badge; the unflagged one does not", () => {
    const best = card({ bestMatch: true });
    expect(best).toContain(BEST_MATCH_BADGE);
    expect(best).toContain("✦ Best match");
    const plain = card();
    expect(plain).not.toContain("Best match");
    expect(card({ bestMatch: false })).not.toContain("Best match");
  });

  test("the badge is OPT-IN: absent === false, byte for byte", () => {
    expect(card()).toBe(card({ bestMatch: false }));
  });

  test("the unflagged card keeps the exact pre-PR markup (class + the score%)", () => {
    const plain = card();
    expect(plain).toContain(
      'class="overflow-hidden rounded-2xl border border-slate-700 bg-slate-900"',
    );
    // The score is still displayed on both variants — the badge never replaces it.
    expect(plain).toContain("88%");
    expect(card({ bestMatch: true })).toContain("88%");
    // The accent is a presentation-only class change on the flagged card.
    expect(card({ bestMatch: true })).toContain("border-amber-400/70");
    expect(plain).not.toContain("border-amber-400/70");
  });

  test("the badge never reorders: the flagged card keeps its own match/index", () => {
    const best = card({ bestMatch: true, index: 1, total: 5 });
    expect(best).toContain("Match 1 of 5");
    expect(best).toContain("Janitorial Services for the Federal Building");
  });
});

describe("RadarCard — the anonymous card is untouched (item D)", () => {
  test("no user ⇒ the one action it has today, full-width amber brief link", () => {
    const plain = card();
    expect(plain).toContain("✦ Get the AI Executive Brief");
    expect(plain).toContain(
      "mt-4 inline-flex w-full items-center justify-center gap-1 rounded-xl border border-amber-500/50 bg-amber-500/10 px-4 py-2.5 text-sm font-semibold text-amber-300 transition-colors hover:bg-amber-500/20",
    );
    expect(plain).toContain('href="/bid/4242"');
    // No save surface at all on an anonymous card.
    expect(plain).not.toContain("Save Opportunity");
    expect(plain).not.toContain("Save to My Pipeline");
    expect(plain).not.toContain("save");
    expect(plain).not.toContain(SAVE_TRACKING_PROMPT);
  });
});

describe("SaveTrackingPrompt — the owner-verbatim post-save prompt (item E)", () => {
  test("renders EXACTLY the owner's sentence, dismissible, no extra CTA", () => {
    const html = renderToStaticMarkup(<SaveTrackingPrompt onDismiss={() => {}} />);
    expect(SAVE_TRACKING_PROMPT).toBe("We'll track this opportunity for you.");
    expect(html).toContain("We&#x27;ll track this opportunity for you.");
    expect(html).toContain('aria-label="Dismiss"');
    expect(html).toContain('role="status"');
    // No embellishment: no upsell, no link, no second promise.
    expect(html).not.toContain("Upgrade");
    expect(html).not.toContain("<a ");
    expect(html.split("track this opportunity for you.").length - 1).toBe(1);
  });

  test("the card renders the prompt only after a save (trackedPrompt state)", () => {
    // Rendered cards (no save happened in SSR) never show the prompt…
    expect(card()).not.toContain(SAVE_TRACKING_PROMPT);
    // …and the prompt is wired to the SaveToPipeline success hook.
    const src = readFileSync(join(REPO_SRC, "routes", "radar.tsx"), "utf8");
    expect(src).toContain("onSaved={() => setTrackedPrompt(true)}");
    expect(src).toContain(
      "{trackedPrompt && <SaveTrackingPrompt onDismiss={() => setTrackedPrompt(false)} />}",
    );
  });
});

describe("the Radar screen wires the new UI (no reorder, no gate change)", () => {
  const src = readFileSync(join(REPO_SRC, "routes", "radar.tsx"), "utf8");

  test("the guidance banner renders above the unchanged scan form", () => {
    const guidance = src.indexOf("FIRST_RUN_SENTENCE");
    const form = src.indexOf('{/* Trade / NAICS */}');
    expect(guidance).toBeGreaterThan(-1);
    expect(form).toBeGreaterThan(-1);
    expect(guidance).toBeLessThan(form);
    expect(src).toContain("{FIRST_RUN_EYEBROW}");
    expect(src).toContain("{FIRST_RUN_SENTENCE}");
    expect(src).toContain("{FIRST_RUN_INPUTS.map((input) => (");
    expect(src).toContain("{FIRST_RUN_FREE_NOTE}");
    // Dismissal + the first successful scan both retire it, via the session store.
    expect(src).toContain("saveRadarGuidanceDone();");
  });

  test("the best match is matches[0] — the server's score order — never re-sorted", () => {
    expect(src).toContain(
      'const bestMatchId = scan.status === "done" && scan.matches.length > 0 ? scan.matches[0].id : null;',
    );
    expect(src).toContain("bestMatch={m.id === bestMatchId}");
    expect(src).toContain("bestMatch={scan.matches[revealed].id === bestMatchId}");
    expect(src).not.toContain("matches.sort(");
  });
});
