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

import { MatchAlertsCard, RadarCard, RequirementsFallback, SaveTrackingPrompt, type RadarMatch } from "~/routes/radar";
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

// ── The Important-requirements signup CTA is ANONYMOUS-ONLY ──────────────────
// Funnel-QA fix (owner green-lit 2026-09-28): a signed-in visitor on the results
// screen was still told to "sign up free to analyze the complete document". The
// guard is the file's own anonymous detector — the same `!getTrackingUser()`
// signal as the F2 first-run nudge — AND-ed with the card's resolved `user`
// prop. The card's real actions are untouched for everyone.
//
// The signed-in branch is asserted on the extracted `RequirementsFallback`
// component (a full signed-in RadarCard needs a router provider — it renders
// SaveToPipeline — which this harness deliberately does not bring up), plus a
// source proof that the card is wired to the guard.

const SIGNUP_HREF = "/signup?plan=basic&source=radar&trade=janitorial";

describe("RadarCard — the requirements signup CTA is anonymous-only (F2 family)", () => {
  const requirementsSrc = () =>
    readFileSync(join(REPO_SRC, "routes", "radar.tsx"), "utf8");

  test("an ANONYMOUS card with no stated requirements still renders the signup CTA", () => {
    const html = card({ match: match({ requirements: [] }) });
    expect(html).toContain("Full requirements are listed in the original solicitation");
    expect(html).toContain("sign up free to analyze the complete document");
    expect(html).toContain('href="/signup?');
  });

  test("a SIGNED-IN viewer's requirements block renders the pointer with NO create-account CTA", () => {
    const signedIn = renderToStaticMarkup(
      <RequirementsFallback anonymous={false} signupHref={SIGNUP_HREF} bidId={4242} />,
    );
    expect(signedIn).toContain("Full requirements are listed in the original solicitation");
    expect(signedIn).not.toContain("sign up free");
    expect(signedIn).not.toContain('href="/signup');
    expect(signedIn).not.toContain("Create free account");
    expect(signedIn).not.toContain("<a ");
    // The anonymous branch is byte-for-byte the block that shipped before.
    const anon = renderToStaticMarkup(
      <RequirementsFallback anonymous signupHref={SIGNUP_HREF} bidId={4242} />,
    );
    expect(anon).toContain("Full requirements are listed in the original solicitation");
    expect(anon).toContain("sign up free to analyze the complete document");
    expect(anon).toContain('href="/signup?plan=basic&amp;source=radar&amp;trade=janitorial"');
    expect(anon).toContain("<a "); // the CTA really is a link for anonymous viewers
  });

  test("the card wires the guard — the file's own detector AND the resolved viewer", () => {
    const src = requirementsSrc();
    expect(src).toContain("const isAnonymousViewer = !user && !getTrackingUser();");
    expect(src).toContain("anonymous={isAnonymousViewer}");
    expect(src).toContain("signupHref={radarSignupHref({ trade, state, cert, sizePref })}");
    // One CTA, one event: the copy and its tracking call live in the anonymous
    // branch only.
    expect(src.split("sign up free to analyze the complete document").length - 1).toBe(1);
    expect(src.split("radar_requirements_cta").length - 1).toBe(1);
  });

  test("a STATED requirements list renders for everyone, with no CTA either way", () => {
    const html = card({ match: match() });
    expect(html).toContain("See the original solicitation");
    expect(html).not.toContain("sign up free");
    expect(html).not.toContain('href="/signup');
  });
});

// ── Results first + two questions (owner 2026-10-02, funnel fixes #1 and #2) ──
describe("Radar: a search link scans at once; only trade and state are asked", () => {
  const src = readFileSync(join(REPO_SRC, "routes", "radar.tsx"), "utf8");
  const home = readFileSync(join(REPO_SRC, "routes", "index.tsx"), "utf8");

  test("a deep link with a trade runs the scan on mount, once", () => {
    expect(src).toContain('const autoScan = urlTrade !== "";');
    expect(src).toContain("useState<Step>(autoScan ? 2 : 1)");
    expect(src).toContain("if (!autoScan || autoScanRanRef.current) return;");
    expect(src).toContain('trackEvent("radar_auto_scan"');
  });

  test("certification and size default broad and sit in a collapsed Refine panel", () => {
    expect(src).toContain('export const DEFAULT_RADAR_CERT: RadarCert = "sb";');
    expect(src).toContain('export const DEFAULT_RADAR_SIZE: SizeId = "any";');
    expect(src).toContain("useState<RadarCert | null>(urlCert ?? DEFAULT_RADAR_CERT)");
    const details = src.indexOf("<details");
    const cert = src.indexOf("Set-aside certification</p>");
    const size = src.indexOf("Contract size</p>");
    const close = src.indexOf("</details>");
    expect(details).toBeGreaterThan(-1);
    expect(details).toBeLessThan(cert);
    expect(cert).toBeLessThan(size);
    expect(size).toBeLessThan(close);
  });

  test("defaults never overwrite answers saved by an earlier visit", () => {
    expect(src).toContain("if (!didInteract.current) return;\n    saveRadarAnswers(");
  });

  test("the homepage search sends no SDVOSB-only filter", () => {
    expect(home).not.toContain('cert: "sdvosb", size: "any"');
    expect(home).toContain('navigate({ to: "/radar", search: search as never });');
  });
});

// ── Automated browsers send no tracking calls (owner 2026-10-02) ─────────────
describe("headless crawlers are not tracked", () => {
  test("trackEvent and the page-view recorder both bail on navigator.webdriver", () => {
    const track = readFileSync(join(REPO_SRC, "lib", "track.ts"), "utf8");
    const root = readFileSync(join(REPO_SRC, "routes", "__root.tsx"), "utf8");
    expect(track).toContain("navigator.webdriver === true");
    expect(track).toContain("if (isAutomatedBrowser()) return;");
    expect(root).toContain("if (isAutomatedBrowser()) return;");
  });
});

// ── Few-matches alert offer (owner 2026-10-02) ───────────────────────────────
describe("a scan with 1-3 matches leads with the email alert offer", () => {
  const src = readFileSync(join(REPO_SRC, "routes", "radar.tsx"), "utf8");

  test("the few-matches headline names the count, trade and state", () => {
    const html = renderToStaticMarkup(
      <MatchAlertsCard certLabel="Small Business" trade="Laundry services" state="VA" cert="sb" sizePref="any" fewMatches={3} />,
    );
    expect(html).toContain("Only 3 open right now. Get new Laundry services bids in Virginia by email.");
    expect(html).toContain("No account required");
    expect(html).toContain("Email me new matches →");
  });

  test("nationwide reads naturally; the standard card is unchanged", () => {
    const nationwide = renderToStaticMarkup(
      <MatchAlertsCard certLabel="Small Business" trade="Laundry services" state="" cert="sb" sizePref="any" fewMatches={1} />,
    );
    expect(nationwide).toContain("Only 1 open right now. Get new Laundry services bids by email.");
    const standard = renderToStaticMarkup(
      <MatchAlertsCard certLabel="Small Business" trade="janitorial" state="VA" cert="sb" sizePref="any" />,
    );
    expect(standard).toContain("Want new matches by email instead?");
    expect(standard).toContain("Send My Matches →");
  });

  test("placement: above the cards when nothing is locked, below them otherwise", () => {
    const top = src.indexOf("fewMatches={scan.matches.length}");
    const cards = src.indexOf("{scan.matches.slice(0, visibleCount).map((m, i) => (");
    expect(top).toBeGreaterThan(-1);
    expect(top).toBeLessThan(cards);
    expect(src).toContain("{isAnonymous && scan.matches.length > 0 && locked === 0 && (");
    expect(src).toContain("{isAnonymous && scan.matches.length > 0 && locked > 0 && (");
  });
});

// ── Zero-match result (owner 2026-10-05) ─────────────────────────────────────
describe("a scan with zero matches is not a dead end", () => {
  const src = readFileSync(join(REPO_SRC, "routes", "radar.tsx"), "utf8");

  test("the alert card offers an email for the next matching bid", () => {
    const html = renderToStaticMarkup(
      <MatchAlertsCard certLabel="Small Business" trade="security guard" state="UT" cert="sb" sizePref="any" noMatches />,
    );
    expect(html).toContain("Nothing open right now. Get an email when a security guard bid posts in Utah.");
    expect(html).toContain("Email me new matches →");
  });

  test("the empty result renders the alert and a nationwide retry", () => {
    expect(src).toContain('trackEvent("radar_zero_nationwide"');
    expect(src).toMatch(/noMatches\s*\n\s*\/>/);
  });
});
