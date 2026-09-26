/**
 * PLAN GATES — ATTEMPT-ONLY prompts + the API boundary (owner rule 8).
 *
 * Companion to src/lib/plan-gates.test.ts (which pins the map, the copy and the
 * two server predicates). This suite pins the four things an upgrade prompt must
 * never do, plus the two API gates:
 *
 *   (b) RENDER-LEVEL: the paid prompt is not in the view. A closed
 *       PremiumUpgradeModal renders NOTHING, the logged-in non-Professional
 *       IncumbentCard view renders its teaser ONLY, and the post-results
 *       drafting CTA on /score is an ACTION (a button that attempts), never a
 *       view-rendered signup CTA. The source proofs pin "the only thing that can
 *       set the gate state is the attempt handler, and it always fires the
 *       gated-attempt event with it".
 *   (c) THE CSV EXPORT is RFC-4180-correct, header-only when empty, and scoped
 *       to the CALLER's own saved rows.
 *   (d) THE FIVE EVENT LABELS are registered and are members of NO funnel-stage
 *       set (the subcontracts-analytics contract, copied), and the "gated" label
 *       is only ever attached where a prompt is shown.
 *   (e) THE API BOUNDARY: /api/bids/$bidId/analyze answers an attempted brief
 *       with the `GATE_REQUIRED:radar_pro` sentinel BEFORE any lazy trial start,
 *       and /api/bids-draft answers an attempted draft with 402 + the Bid Scout
 *       sentinel.
 *
 * DETERMINISTIC, zero network, zero database: literals + committed source text
 * on one side, in-process react-dom/server renders on the other. No
 * `mock.module` (bun's mock registry is process-global and leaks across files).
 */
import { describe, expect, test } from "bun:test";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { renderToStaticMarkup } from "react-dom/server";

import { IncumbentCard } from "~/components/IncumbentCard";
import { PremiumUpgradeModal } from "~/components/PremiumUpgradeModal";
import {
  ATTEMPT_EVENT_FOR_ACTION,
  GATE_ATTEMPT_EVENTS,
  GATE_ATTEMPT_LABEL,
  gateErrorCode,
  gateLockedPayload,
  gatePrompt,
  isGateError,
  isGateLockedPayload,
} from "~/lib/plan-gates";
import {
  PIPELINE_CSV_COLUMNS,
  csvCell,
  loadPipelineRows,
  pipelineCsvFilename,
  toPipelineCsv,
  type PipelineExportRow,
  type PipelineExportStore,
} from "~/lib/pipeline-export";

const ROOT = join(import.meta.dir, "..");
const SRC = join(ROOT, "src");
const read = (...parts: string[]) => readFileSync(join(SRC, ...parts), "utf8");
const count = (haystack: string, needle: string): number => haystack.split(needle).length - 1;

/** The intel the incumbent panel needs (verbatim shape of the FPDS lookup). */
const INTEL = {
  incumbent_name: "Hensel Phelps Construction Co.",
  incumbent_uei: "UEI123456789",
  total_obligated: 12_400_000,
  pop_start_date: "2022-03-01",
  pop_end_date: "2026-02-28",
  historical_pricing: [
    { fiscal_year: 2024, total_obligated: 4_100_000, award_count: 2 },
    { fiscal_year: 2023, total_obligated: 3_200_000, award_count: 1 },
  ],
};
const USER = { id: 41, email: "owner@example.com", created_at: "2026-01-01T00:00:00Z", is_admin: false };
const noop = () => {};

// ── (b) render-level: the prompt is an ATTEMPT, never a view ─────────────────

describe("attempt-only prompts: nothing renders on view", () => {
  test("a CLOSED upgrade prompt renders nothing at all", () => {
    const html = renderToStaticMarkup(
      <PremiumUpgradeModal open={false} onClose={noop} title="Radar Pro feature" />,
    );
    expect(html).toBe("");
  });

  test("an OPEN prompt renders the real offer (title, CTA, price, dismiss)", () => {
    const p = gatePrompt("radar_pro");
    const html = renderToStaticMarkup(
      <PremiumUpgradeModal
        open
        onClose={noop}
        title={p.title}
        message={p.body}
        ctaLabel={p.ctaLabel}
        priceNote={p.priceNote}
      />,
    );
    expect(html).toContain('role="dialog"');
    expect(html).toContain("Radar Pro feature");
    expect(html).toContain("Upgrade to Radar Pro →");
    expect(html).toContain("$79/mo · 14-day Professional trial · Cancel anytime");
    expect(html).toContain("Maybe later");
    // The Bid Scout prompt links out (no Stripe tier to redirect to).
    const b = gatePrompt("bid_scout");
    const scout = renderToStaticMarkup(
      <PremiumUpgradeModal open onClose={noop} title={b.title} message={b.body} ctaLabel={b.ctaLabel} priceNote={b.priceNote} ctaHref={b.href} />,
    );
    expect(scout).toContain('href="/bid-scout"');
    expect(scout).not.toContain("Maybe later&#x27;"); // sanity: copy is not escaped twice
  });

  test("the logged-in NON-Professional incumbent view shows the teaser, NOT the prompt", () => {
    const html = renderToStaticMarkup(
      <IncumbentCard intel={INTEL} user={USER} proAccess={false} bidId={1} title="Barracks Renovation" />,
    );
    // The attempt affordance is present...
    expect(html).toContain("Reveal Incumbent &amp; Past Pricing");
    expect(html).toContain("Professional plan feature");
    // ...and the upgrade prompt is NOT: no modal, no dialog, no CTA, no price.
    expect(html).not.toContain('role="dialog"');
    expect(html).not.toContain("Maybe later");
    expect(html).not.toContain("Upgrade to Professional →");
    expect(html).not.toContain("$79/mo");
  });

  test("the mask is not leaked through the teaser, and a Pro user sees no teaser", () => {
    const gated = renderToStaticMarkup(<IncumbentCard intel={INTEL} user={USER} proAccess={false} />);
    expect(gated).not.toContain("Hensel Phelps"); // masked until the reveal attempt
    const pro = renderToStaticMarkup(<IncumbentCard intel={INTEL} user={USER} proAccess />);
    expect(pro).not.toContain("Reveal Incumbent &amp; Past Pricing");
    expect(pro).not.toContain('role="dialog"');
  });
});

// ── (b)/(d) source proofs: only an attempt can open a prompt, and it is logged ─

describe("attempt-only prompts: the attempt handler is the only door", () => {
  test("IncumbentCard: the paywall opens ONLY from the reveal click, with the gated event", () => {
    const src = read("components", "IncumbentCard.tsx");
    expect(count(src, "setShowPaywall(true)")).toBe(1);
    const at = src.indexOf("setShowPaywall(true)");
    const onClick = src.lastIndexOf("onClick=", at);
    expect(onClick).toBeGreaterThan(-1);
    // The attempt event is recorded in the SAME handler as the prompt.
    const handler = src.slice(onClick, at);
    expect(handler).toContain("trackEvent(");
    expect(handler).toContain("ATTEMPT_EVENT_FOR_ACTION.incumbent");
    expect(handler).toContain("GATE_ATTEMPT_LABEL");
  });

  test("SaveToPipeline: the save-limit paywall stays ATTEMPT-based (never a useEffect)", () => {
    const src = read("components", "SaveToPipeline.tsx");
    expect(count(src, "setShowPaywall(true)")).toBe(2);
    for (const hit of [...src.matchAll(/setShowPaywall\(true\)/g)]) {
      const before = src.slice(0, hit.index);
      // Every open is preceded by the save_limit_wall attempt event…
      expect(before.slice(-300)).toContain('trackEvent("save_limit_wall"');
    }
    // …and never by an effect (which would run on view).
    expect(/useEffect\([\s\S]{0,400}setShowPaywall/.test(src)).toBe(false);
  });

  test("score.tsx: the post-results drafting CTA is an ACTION, and gates only on the attempt", () => {
    const src = read("routes", "score.tsx");
    // The view-rendered signup CTA that used to carry the drafting promise is gone.
    expect(count(src, "score_rec=")).toBe(0);
    expect(src).not.toContain('trackEvent("score_cta_click", result.recommendation)');
    // The pasted solicitation is stashed by the ATTEMPT handler only.
    expect(count(src, "storePendingDraft(")).toBe(1);
    // The drafting CTA is the attemptDraft button.
    expect(src).toContain("const attemptDraft = () => {");
    expect(src).toContain("onClick={attemptDraft}");
    // The gate state is opened in exactly the attempt handlers (score attempt +
    // draft attempt) and nowhere else.
    expect(count(src, "setActiveGate(")).toBe(3); // 2 attempt opens + the modal close
    for (const hit of [...src.matchAll(/setActiveGate\(/g)].filter((h) => !src.startsWith("setActiveGate(null", h.index))) {
      const around = src.slice(Math.max(0, hit.index - 800), hit.index + 200);
      expect(around).toContain("GATE_ATTEMPT_LABEL");
    }
    // The prompt itself renders only when a gate was set by an attempt.
    expect(src).toContain("const activePrompt = activeGate ? gatePrompt(activeGate) : null;");
    expect(src).toContain("{activePrompt && (");
    // The FAQ no longer sells "unlimited scoring" on a free account.
    expect(src).not.toContain("unlocks unlimited scoring");
  });

  test("awards.tsx: the trial-cap prompt opens on the blocked CLICK, not on expansion", () => {
    const src = read("routes", "awards.tsx");
    expect(count(src, "setIncumbentGateOpen(true)")).toBe(1);
    const openAt = src.indexOf("setIncumbentGateOpen(true)");
    const guardAt = src.indexOf("if (trial?.active && trialIncumbentLeft === 0)");
    // The guard is the CLICK handler's cap check, and the prompt opens inside it.
    expect(guardAt).toBeGreaterThan(-1);
    expect(openAt).toBeGreaterThan(guardAt);
    // The prompt is driven by that state alone (never rendered `open`).
    expect(src).toContain("open={incumbentGateOpen}");
    const modal = src.slice(src.indexOf("open={incumbentGateOpen}"));
    expect(modal).toContain('checkoutPlan="professional"');
    // The remaining in-panel text is PASSIVE: no upgrade link/CTA survives there.
    const panel = src.slice(src.indexOf("You&rsquo;ve used your 3 trial incumbent looks"));
    const passive = panel.slice(0, panel.indexOf("</div>"));
    expect(passive).not.toContain("<a ");
    expect(passive).not.toContain("href=");
    expect(src).toContain("incumbent_attempted");
  });

  test("pipeline.tsx: the export prompt opens only on the 402 of an EXPORT attempt", () => {
    const src = read("routes", "pipeline.tsx");
    expect(count(src, "setExportGate(true)")).toBe(1);
    const around = src.slice(src.indexOf("setExportGate(true)") - 400, src.indexOf("setExportGate(true)"));
    expect(around).toContain("res.status === 402");
    expect(around).toContain("GATE_ATTEMPT_LABEL");
    expect(src).toContain("open={exportGate}");
  });
});

// ── (d) the five labels: registered standalone, in no funnel-stage set ───────

describe("plan-gate events: standalone labels, isolated from every funnel stage", () => {
  test("the five names ARE registered display labels in tracking-intake", () => {
    const text = read("lib", "tracking-intake.ts");
    for (const name of GATE_ATTEMPT_EVENTS) {
      expect(text).toContain(`${name}:`);
    }
    // …and each carries the product it gates, so an operator can read the row.
    expect(text).toContain("AI Brief attempt gated (Radar Pro)");
    expect(text).toContain("Proposal draft attempt gated (Bid Scout)");
  });

  test("tracking-intake's own funnel-stage sets do NOT contain them", () => {
    const text = read("lib", "tracking-intake.ts");
    const arrayBlock = (source: string, name: string): string | null => {
      const start = source.indexOf(`const ${name}`);
      if (start < 0) return null;
      const open = source.indexOf("[", start);
      const close = source.indexOf("];", open);
      if (open < 0 || close < 0) return null;
      return source.slice(open, close);
    };
    for (const set of ["ACTIVATION_EVENTS", "SIGNUP_VIEWED_EVENTS", "SIGNUP_STARTED_EVENTS"]) {
      const block = arrayBlock(text, set);
      expect(block).not.toBeNull();
      expect(block!.length).toBeGreaterThan(20); // non-vacuous: the array was found
      for (const name of GATE_ATTEMPT_EVENTS) expect(block!.includes(name)).toBe(false);
    }
    // RADAR_COMPLETE_EVENT is a single label, not an array.
    const radarComplete = text.match(/const RADAR_COMPLETE_EVENT = "([^"]+)"/);
    expect(radarComplete).not.toBeNull();
    expect(GATE_ATTEMPT_EVENTS).not.toContain(radarComplete![1]);
  });

  test("no funnel definition anywhere references a gated-attempt event", () => {
    const files = readdirSync(join(SRC, "lib"))
      .filter((name) => /funnel.*\.ts$/.test(name) && !name.endsWith(".test.ts"))
      .map((name) => join(SRC, "lib", name));
    for (const rel of ["routes/api/admin/unified-funnel.ts", "routes/api/admin/journeys.ts"]) {
      if (existsSync(join(SRC, rel))) files.push(join(SRC, rel));
    }
    expect(files.length).toBeGreaterThanOrEqual(3); // non-vacuous
    for (const path of files) {
      const text = readFileSync(path, "utf8");
      for (const name of GATE_ATTEMPT_EVENTS) expect(text.includes(name)).toBe(false);
    }
  });

  test("the ONLY label ever attached to a gated attempt is `gated`", () => {
    expect(GATE_ATTEMPT_LABEL).toBe("gated");
    // Every surface that fires one of the five names pairs it with the label.
    const surfaces = [
      read("components", "IncumbentCard.tsx"),
      read("components", "RfpSummaryCard.tsx"),
      read("routes", "score.tsx"),
      read("routes", "pipeline.tsx"),
      read("routes", "awards.tsx"),
    ].join("\n");
    for (const name of GATE_ATTEMPT_EVENTS) {
      for (const hit of [...surfaces.matchAll(new RegExp(`ATTEMPT_EVENT_FOR_ACTION\\.\\w+`, "g"))]) {
        const near = surfaces.slice(hit.index!, hit.index! + 160);
        // Any fire of a gate event is either the gated prompt or an explicit
        // attempt/allowed/exported outcome label — never a bare stage name.
        expect(/GATE_ATTEMPT_LABEL|"attempt"|"allowed"|"exported"/.test(near)).toBe(true);
      }
      expect(name).toContain("_attempted");
    }
  });
});

// ── (c) the export: RFC-4180, header-only when empty, the caller's rows only ──

const row = (over: Partial<PipelineExportRow> = {}): PipelineExportRow => ({
  bid_id: 1,
  title: "Roof Replacement",
  agency: "GSA",
  set_aside: "SDVOSB",
  category: "Construction",
  location: "Richmond, VA",
  estimated_value: "$1,200,000",
  due_date: "2026-10-01",
  status: "saved",
  saved_at: "2026-09-20T12:00:00.000Z",
  source_url: "https://sam.gov/opp/abc",
  ...over,
});

describe("pipeline CSV export", () => {
  test("RFC-4180 quoting: commas, quotes, CR and LF", () => {
    expect(csvCell("plain")).toBe("plain");
    expect(csvCell("a,b")).toBe('"a,b"');
    expect(csvCell('say "hi"')).toBe('"say ""hi"""');
    expect(csvCell("line1\nline2")).toBe('"line1\nline2"');
    expect(csvCell("line1\r\nline2")).toBe('"line1\r\nline2"');
    // Missing values are EMPTY cells — never an invented "unknown".
    for (const empty of [null, undefined, ""]) expect(csvCell(empty)).toBe("");
    expect(csvCell(0)).toBe("0");
  });

  test("an empty pipeline is a header-only file (never a fake row)", () => {
    const csv = toPipelineCsv([]);
    expect(csv).toBe(PIPELINE_CSV_COLUMNS.join(",") + "\r\n");
    expect(csv.split("\r\n").filter(Boolean)).toHaveLength(1);
    expect(csv.endsWith("\r\n")).toBe(true); // RFC 4180 CRLF line endings
  });

  test("the header order IS the column order, and every row keeps it", () => {
    const csv = toPipelineCsv([row()]);
    const [header, first] = csv.split("\r\n");
    expect(header.split(",")).toEqual([...PIPELINE_CSV_COLUMNS]);
    expect(first.startsWith("1,Roof Replacement,GSA,SDVOSB,Construction,")).toBe(true);
    expect(first).toContain('"Richmond, VA"');
    expect(first.endsWith("2026-09-20T12:00:00.000Z,https://sam.gov/opp/abc")).toBe(true);
  });

  test("a hostile cell can never break out of its column", () => {
    const csv = toPipelineCsv([row({ title: 'Bid, "urgent"\nsecond line' })]);
    const lines = csv.split("\r\n");
    // The embedded newline stays INSIDE the quoted cell: header + 1 record + "".
    expect(lines).toHaveLength(3);
    expect(lines[1]).toBe(
      '1,"Bid, ""urgent""\nsecond line",GSA,SDVOSB,Construction,"Richmond, VA","$1,200,000",2026-10-01,saved,2026-09-20T12:00:00.000Z,https://sam.gov/opp/abc',
    );
  });

  test("the filename is date-stamped (the user's own data, one file)", () => {
    expect(pipelineCsvFilename(new Date("2026-09-26T18:00:00Z"))).toBe("contrax-pipeline-2026-09-26.csv");
  });

  test("SCOPE: the export asks for the CALLER's rows and can only contain those", async () => {
    const asked: number[] = [];
    const store: PipelineExportStore = {
      async listSavedRows(userId) {
        asked.push(userId);
        // A hostile store: another user's rows are present in the table.
        if (userId === 7) return [row({ bid_id: 7, title: "Mine" })];
        return [row({ bid_id: 999, title: "Someone else's bid" })];
      },
    };
    const mine = await loadPipelineRows(7, store);
    expect(asked).toEqual([7]);
    const csv = toPipelineCsv(mine);
    expect(csv).toContain("Mine");
    expect(csv).not.toContain("Someone else's bid");
    // The store is asked for the caller's id every time — never a global read.
    const theirs = await loadPipelineRows(8, store);
    expect(asked).toEqual([7, 8]);
    expect(toPipelineCsv(theirs)).not.toContain("Mine");
  });
});

// ── (e) the API boundary ────────────────────────────────────────────────────

describe("API gates: the attempt is answered with the sentinel, and no trial starts", () => {
  const analyze = readFileSync(join(SRC, "routes", "api", "bids.$bidId.analyze.ts"), "utf8");
  const draft = read("routes", "api", "bids-draft.ts");

  test("analyze returns GATE_REQUIRED:radar_pro for an attempted brief", () => {
    expect(gateErrorCode("ai_brief")).toBe("GATE_REQUIRED:radar_pro");
    expect(draft).toContain('error: gateErrorCode("draft")');
    expect(analyze).toContain('error: gateErrorCode("ai_brief")');
    expect(analyze).toContain('gateLockedPayload("ai_brief", AI_BRIEF_LOCKED_PREVIEW)');
    expect(analyze).toContain("hasRadarProAccess(user.id, user)");
    // The payload the client type-guards is a real gate payload.
    const payload = { ...gateLockedPayload("ai_brief"), error: gateErrorCode("ai_brief") };
    expect(payload.upgrade_required).toBe("radar_pro");
    expect(isGateLockedPayload(payload)).toBe(true);
    expect(isGateError(payload.error, "ai_brief")).toBe(true);
  });

  test("the gate returns BEFORE the lazy trial start (no silent ensureTrialStarted)", () => {
    const gateAt = analyze.indexOf("hasRadarProAccess(user.id, user)");
    const trialAt = analyze.indexOf("await ensureTrialStarted(user.id)");
    const cacheAt = analyze.indexOf("if (hasSummary && !wantsRegenerate) return serveCached();");
    expect(gateAt).toBeGreaterThan(-1);
    expect(trialAt).toBeGreaterThan(-1);
    expect(cacheAt).toBeGreaterThan(-1);
    // Deny first: before the lazy trial start AND before any cached paid brief.
    expect(gateAt).toBeLessThan(trialAt);
    expect(gateAt).toBeLessThan(cacheAt);
    // …and the gate module itself can never start a trial (see plan-gates.test.ts).
    expect(read("lib", "plan-gates.server.ts")).not.toContain("ensureTrialStarted");
  });

  test("bids-draft answers a non-Bid-Scout attempt with 402 + the Bid Scout sentinel", () => {
    expect(gateErrorCode("draft")).toBe("GATE_REQUIRED:bid_scout");
    const gateAt = draft.indexOf("hasBidScoutAccess(user.id, user)");
    expect(gateAt).toBeGreaterThan(-1);
    const branch = draft.slice(gateAt, gateAt + 400);
    expect(branch).toContain("{ status: 402 }");
    expect(branch).toContain("gateLockedPayload(\"draft\")");
    // The removed per-trial draft cap is GONE (a paying Bid Scout customer can
    // never be blocked by a leftover trial counter).
    expect(draft).not.toContain("checkTrialCap");
    expect(draft).toContain('consumeTrial(user.id, "drafts")');
    // The gate runs before the cached-draft read, so no paid draft leaks.
    const cacheReadAt = draft.indexOf("SELECT draft_text, generated_at FROM proposal_drafts");
    expect(cacheReadAt).toBeGreaterThan(gateAt);
  });

  test("the export route is the same contract (401 · 402 · 200)", () => {
    const src = read("routes", "api", "pipeline-export.ts");
    expect(src).toContain('Response.json({ error: "Not authenticated" }, { status: 401 })');
    expect(src).toContain("hasBidScoutAccess(user.id, user)");
    expect(src).toContain('gateLockedPayload("export")');
    expect(src).toContain("{ status: 402 }");
    expect(src).toContain('"content-type": "text/csv; charset=utf-8"');
    expect(src).toContain('"cache-control": "no-store"');
  });
});
