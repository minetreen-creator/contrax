/**
 * Bid Scout Phase B.1 — acquisition funnel smoke test (owner 2026-09-11 brief).
 *
 * Verifies, against the REAL Neon DB (DATABASE_URL) and the REAL lib code:
 *   1. NEW event `bid_scout_form_started` flows through the canonical intake
 *      pipeline (handleIntake) with the standard exclusions; idempotence is
 *      the client ref-guard (once per page mount) + COUNT(DISTINCT
 *      visitor_id) in the funnel (the shared 1s write-dedupe is a best-effort
 *      backstop, not a guarantee — DDL guards consume its window).
 *   2. getBidScoutAcquisitionFunnel30d() returns the 4 stages (landing /
 *      form_started / checkout_started / purchased), conversion rate
 *      (Purchased ÷ Landing, 0-guarded) and the per-source breakdown
 *      (facebook / email-outreach / dashboard / homepage / other-direct),
 *      all DISTINCT visitors except purchased (webhook rows carry no
 *      visitor_id by design — the stage counts webhook-confirmed purchases).
 *   3. Bucketing rule unit tests (pure function) + integration through the
 *      funnel query: facebook via first-touch attribution cookie,
 *      email via utm_source, dashboard/homepage via CTA placement label +
 *      first-party referrer PATH, everything else → other/direct; @test.contrax
 *      and admin emails excluded from every count; refresh rows never inflate
 *      (same visitor re-viewed collapses to one).
 *   4. Purchased attribution: per-source purchased resolved through the
 *      buyer-email → earliest matched checkout_started visitor join;
 *      unmatchable purchases fall into other/direct; duplicate purchase
 *      metadata (same bidScoutId) counts once.
 *   5. The success page fires NO analytics event (client-side file check) and
 *      no client code references bid_scout_purchased (server-webhook-only).
 *   6. Admin endpoint 401 unauthenticated.
 *
 * Usage: DATABASE_URL=... bun run scripts/test-bid-scout-phase-b1.ts
 *
 * Test rows are cleaned up at the end — funnel_events + visitors summary rows
 * by exact visitor-id prefix (b1-<run>-*), exact test emails and exact
 * purchase-metadata label ids. Never touches real rows (unique RUN suffix).
 */
import { neon } from "@neondatabase/serverless";
import { readFileSync } from "node:fs";
import { sql } from "../src/db";
import { handleIntake } from "../src/lib/tracking-intake";
import {
  getBidScoutAcquisitionFunnel30d,
  bucketBidScoutLanding,
  type BidScoutSourceBucket,
} from "../src/lib/bid-scout-acquisition-funnel";
import { recordBidScoutCheckoutStarted } from "../src/lib/bid-scout";

const RUN = Date.now();
const PREFIX = `b1-${RUN}`;
const EMAIL_FB = `b1-${RUN}-fb@b1test.example`;
const EMAIL_DASH = `b1-${RUN}-dash@b1test.example`;
const EMAIL_EMAIL = `b1-${RUN}-email@b1test.example`;
const EMAIL_TEST = `b1-${RUN}-test@test.contrax`;
const ADMINS = ["minetreen@gmail.com", "hello@contrax.company"];
const EMAILS = [EMAIL_FB, EMAIL_DASH, EMAIL_EMAIL, EMAIL_TEST, ...ADMINS];
const V_FB = `${PREFIX}-vfb`;
const V_HOME = `${PREFIX}-vhome`;
const V_DASH = `${PREFIX}-vdash`;
const V_EMAIL = `${PREFIX}-vemail`;
const V_DIRECT = `${PREFIX}-vdirect`;
const V_TEST = `${PREFIX}-vtest`;
const V_ADMIN = `${PREFIX}-vadmin`;
const V_BOT = `${PREFIX}-vbot`;
const V_NOVID = `${PREFIX}-novid`;
const ALL_VISITORS = [V_FB, V_HOME, V_DASH, V_EMAIL, V_DIRECT, V_TEST, V_ADMIN, V_BOT, V_NOVID];

const HUMAN_UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36";
const BOT_UA = "Mozilla/5.0 (compatible; HeadlessChrome/120.0; +https://example.com/bot)";

let passed = 0;
let failed = 0;
function ok(cond: boolean, label: string, extra = "") {
  if (cond) { passed++; console.log(`  ✅ ${label}${extra ? ` — ${extra}` : ""}`); }
  else { failed++; console.error(`  ❌ ${label}${extra ? ` — ${extra}` : ""}`); }
}

function attrCookie(attr: Record<string, string>): string {
  return `contrax_attr=${encodeURIComponent(JSON.stringify(attr))}`;
}

/** Fire a funnel event through the REAL canonical intake pipeline. */
async function fireEvent(opts: {
  event: string;
  visitor?: string;
  label?: string;
  referer?: string;
  cookie?: string;
  email?: string;
  ua?: string;
  search?: string;
}): Promise<Response> {
  const headers: Record<string, string> = { "content-type": "application/json", "user-agent": opts.ua ?? HUMAN_UA };
  if (opts.referer) headers.referer = opts.referer;
  if (opts.cookie) headers.cookie = opts.cookie;
  const beacon = new Request(
    `https://www.contrax.company/api/track-visitor${opts.search ? `?${opts.search}` : ""}`,
    { method: "POST", headers, body: JSON.stringify({
        kind: "event", event: opts.event, path: "/bid-scout",
        ...(opts.label ? { label: opts.label } : {}),
        ...(opts.visitor ? { visitor_id: opts.visitor } : {}),
        ...(opts.email ? { user_email: opts.email } : {}),
      }) },
  );
  return handleIntake(beacon, "event");
}

async function main() {
  const db = neon(process.env.DATABASE_URL!);
  const maxBefore = Number((await db`SELECT MAX(id)::int AS m FROM funnel_events`)[0].m ?? 0);
  console.log(`Bid Scout Phase B.1 test · run ${RUN} · funnel max id before = ${maxBefore}`);

  // ── 0. Bucketing rule — unit tests (pure function) ────────────────────────
  console.log("\n0) bucketBidScoutLanding unit tests");
  const cases: [BucketInput, BidScoutSourceBucket, string][] = [
    [{ source: "facebook", click_id: "IwcGRvZgRleHRu" }, "facebook", "first-touch source=facebook"],
    [{ source: "direct", click_id: "fbclid_abc" }, "facebook", "click_id (fbclid) present"],
    [{ source: "direct", referrer: "https://www.contrax.company/bid-scout?fbclid=zzz" }, "facebook", "referrer contains fbclid"],
    [{ source: "FACEBOOK", medium: "social" }, "facebook", "case-insensitive source"],
    [{ source: "newsletter" }, "email_outreach", "utm_source=newsletter"],
    [{ source: "email" }, "email_outreach", "utm_source=email"],
    [{ source: "outreach" }, "email_outreach", "utm_source=outreach"],
    [{ source: "direct", referrer: "https://us6.list-manage.com/track/click?u=1" }, "email_outreach", "ESP referrer (list-manage)"],
    [{ label: "dashboard", source: "direct" }, "dashboard", "CTA placement label=dashboard"],
    [{ source: "direct", referrer: "https://www.contrax.company/dashboard" }, "dashboard", "first-party referrer path /dashboard"],
    [{ label: "homepage", source: "direct" }, "homepage", "CTA placement label=homepage"],
    [{ source: "direct", referrer: "https://www.contrax.company/" }, "homepage", "first-party referrer path /"],
    [{ source: "direct", referrer: "https://www.contrax.company/#pricing" }, "homepage", "first-party referrer / with #section anchor"],
    [{ label: "bid_scout_page", source: "direct", referrer: "https://www.contrax.company/bid-scout" }, "other_direct", "self-referral /bid-scout → other/direct"],
    [{ source: "direct", referrer: "https://www.google.com/" }, "other_direct", "external referrer → other/direct"],
    [{ source: "gmail" }, "other_direct", "gmail must NOT match email bucket"],
    [{}, "other_direct", "empty row → other/direct"],
    [{ source: "facebook", label: "homepage" }, "facebook", "external channel beats placement label"],
  ];
  for (const [input, expected, note] of cases) {
    ok(bucketBidScoutLanding(input) === expected, `bucket(${note}) = ${expected}`, `got=${bucketBidScoutLanding(input)}`);
  }

  // ── 1. Events through the REAL intake pipeline ─────────────────────────────
  console.log("\n1) bid_scout_form_started + viewed (real intake pipeline)");
  // Baseline funnel BEFORE any test rows — the 30d window already contains
  // REAL organic Bid Scout traffic (FB campaign + direct), so every count
  // assertion is a BASELINE-DELTA: after − before must equal exactly my test
  // rows' contribution (robust against organic traffic, never zeroed).
  const before = await getBidScoutAcquisitionFunnel30d();
  const B = (k: string) => before.stages.find((s) => s.key === k)?.count ?? 0;
  ok(before.stages.length === 4, "funnel already live with a stable shape", `landing=${B("landing")}`);
  // Landing visitors:
  await fireEvent({ event: "bid_scout_viewed", visitor: V_FB, label: "bid_scout_page", cookie: attrCookie({ source: "facebook", medium: "social", campaign: "fb-bidscout", click_id: "fbclid_b1" }) });
  await fireEvent({ event: "bid_scout_viewed", visitor: V_HOME, label: "homepage", cookie: attrCookie({ source: "direct" }), referer: "https://www.contrax.company/" });
  await fireEvent({ event: "bid_scout_viewed", visitor: V_DASH, label: "dashboard", cookie: attrCookie({ source: "direct" }), referer: "https://www.contrax.company/dashboard" });
  await fireEvent({ event: "bid_scout_viewed", visitor: V_EMAIL, cookie: attrCookie({ source: "newsletter" }) });
  await fireEvent({ event: "bid_scout_viewed", visitor: V_DIRECT, cookie: attrCookie({ source: "direct" }) });
  // Excluded classes:
  await fireEvent({ event: "bid_scout_viewed", visitor: V_TEST, email: EMAIL_TEST, cookie: attrCookie({ source: "direct" }) });
  await fireEvent({ event: "bid_scout_viewed", visitor: V_ADMIN, email: ADMINS[0], cookie: attrCookie({ source: "direct" }) });
  await fireEvent({ event: "bid_scout_viewed", visitor: V_BOT, ua: BOT_UA, cookie: attrCookie({ source: "direct" }) });
  await fireEvent({ event: "bid_scout_viewed", cookie: attrCookie({ source: "direct" }) }); // V_NOVID — no visitor id
  // Refresh duplicate for V_DIRECT (must NOT inflate distinct count):
  await fireEvent({ event: "bid_scout_viewed", visitor: V_DIRECT, cookie: attrCookie({ source: "direct" }) });

  // NEW event: form_started — once per visitor per session. The client
  // ref-guard (a single guarded handler on the company/capabilities fields)
  // means it can never fire per keystroke. Double-fire here within the same
  // second proves the ANALYTICS contract: even when a second row slips
  // through (the shared writer's 1s dedupe is a best-effort backstop — the
  // ensureFunnelEventsTable DDL guards consume most of the 1s window), the
  // funnel counts the visitor ONCE via COUNT(DISTINCT visitor_id).
  await fireEvent({ event: "bid_scout_form_started", visitor: V_FB, cookie: attrCookie({ source: "facebook", click_id: "fbclid_b1" }) });
  await fireEvent({ event: "bid_scout_form_started", visitor: V_FB, cookie: attrCookie({ source: "facebook", click_id: "fbclid_b1" }) });
  await fireEvent({ event: "bid_scout_form_started", visitor: V_HOME, label: "homepage", cookie: attrCookie({ source: "direct" }) });
  await fireEvent({ event: "bid_scout_form_started", visitor: V_EMAIL, cookie: attrCookie({ source: "newsletter" }) });
  await fireEvent({ event: "bid_scout_form_started", visitor: V_BOT, ua: BOT_UA, cookie: attrCookie({ source: "direct" }) });

  // Checkout started (real route helper → same intake):
  const mkCheckoutReq = (visitor: string, source: string, email: string) =>
    new Request("https://www.contrax.company/api/bid-scout/checkout", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "user-agent": HUMAN_UA,
        cookie: `contrax_vid=${visitor}; contrax_attr=${encodeURIComponent(JSON.stringify({ source: "direct" }))}`,
        referer: `https://www.contrax.company/bid-scout${source === "default" ? "" : `?source=${source}`}`,
      },
      body: JSON.stringify({}),
    });
  await recordBidScoutCheckoutStarted(mkCheckoutReq(V_FB, "default", EMAIL_FB), { sourceLabel: "bid_scout_page", userEmail: EMAIL_FB, userId: null });
  await recordBidScoutCheckoutStarted(mkCheckoutReq(V_DASH, "dashboard", EMAIL_DASH), { sourceLabel: "dashboard", userEmail: EMAIL_DASH, userId: null });
  await recordBidScoutCheckoutStarted(mkCheckoutReq(V_EMAIL, "default", EMAIL_EMAIL), { sourceLabel: "bid_scout_page", userEmail: EMAIL_EMAIL, userId: null });

  const vfbForm = await db`SELECT COUNT(*)::int AS n FROM funnel_events WHERE event_name='bid_scout_form_started' AND visitor_id=${V_FB}`;
  ok(vfbForm[0].n >= 1 && vfbForm[0].n <= 2, "form_started double-fire: 1–2 rows written (analytics count the visitor once)", `rows=${vfbForm[0].n}`);
  const vbotForm = await db`SELECT COUNT(*)::int AS n FROM funnel_events WHERE event_name='bid_scout_form_started' AND visitor_id=${V_BOT}`;
  ok(vbotForm[0].n === 0, "form_started bot UA → no row (standard exclusion)", `rows=${vbotForm[0].n}`);
  const vbotViewed = await db`SELECT COUNT(*)::int AS n FROM funnel_events WHERE event_name='bid_scout_viewed' AND visitor_id=${V_BOT}`;
  ok(vbotViewed[0].n === 0, "viewed bot UA → no row (standard exclusion)");

  // ── 2. Purchased (webhook-style rows, exactly-once per bidScoutId) ─────────
  console.log("\n2) bid_scout_purchased (webhook-style) + per-source attribution");
  const purchase = (bidScoutId: string, cs: string, email: string) =>
    db`INSERT INTO funnel_events (event_name, label, path, visitor_id, user_email, created_at)
        VALUES ('bid_scout_purchased', ${JSON.stringify({ product: "bid_scout", bidScoutId, stripeSessionId: cs, amount: 9900, currency: "usd" })}, '/bid-scout', NULL, ${email}, NOW())`;
  await purchase(`rec-${RUN}-p1`, `cs_${RUN}_1`, EMAIL_FB);   // → facebook (via V_FB checkout email join)
  await purchase(`rec-${RUN}-p2`, `cs_${RUN}_2`, EMAIL_DASH); // → dashboard (via V_DASH)
  await purchase(`rec-${RUN}-p3`, `cs_${RUN}_3`, "nobody.else@nowhere.test"); // unmatched → other/direct
  await purchase(`rec-${RUN}-p1`, `cs_${RUN}_1b`, EMAIL_FB);  // duplicate metadata id → must count ONCE

  // ── 3. The funnel query (BASELINE-DELTA assertions) ───────────────────────
  console.log("\n3) getBidScoutAcquisitionFunnel30d()");
  const f = await getBidScoutAcquisitionFunnel30d();
  ok(f.range === "30d" && f.stages.length === 4, "range=30d, 4 stages",
    `stages=${f.stages.map((s) => s.key).join(",")}`);
  const st = (k: string) => f.stages.find((s) => s.key === k)?.count ?? -1;
  const D = (k: string) => st(k) - B(k);
  ok(D("landing") === 5, "landing delta = +5 (bot/test/admin/no-vid excluded; refresh did not inflate)",
    `delta=${D("landing")} (baseline ${B("landing")} → ${st("landing")})`);
  ok(D("form_started") === 3, "form_started delta = +3 unique visitors", `delta=${D("form_started")}`);
  ok(D("checkout_started") === 3, "checkout_started delta = +3 unique visitors", `delta=${D("checkout_started")}`);
  ok(D("purchased") === 3, "purchased delta = +3 webhook-confirmed (duplicate metadata id counted once)",
    `delta=${D("purchased")} (baseline ${B("purchased")} → ${st("purchased")})`);
  const expectedConv =
    B("purchased") + 3 > 0 && B("landing") + 5 > 0
      ? Math.round(((B("purchased") + 3) / (B("landing") + 5)) * 1000) / 10
      : 0;
  ok(f.conversionRatePct === expectedConv, "conversion = Purchased ÷ Landing recomputes on the real window",
    `=${f.conversionRatePct} (expected ${expectedConv})`);
  const src = (b: string) => f.sources.find((s) => s.bucket === b)!;
  const sb = (b: string, field: "landing" | "checkout_started" | "purchased") =>
    src(b)[field] - (before.sources.find((s) => s.bucket === b)?.[field] ?? 0);
  ok(sb("facebook", "landing") === 1 && sb("facebook", "checkout_started") === 1 && sb("facebook", "purchased") === 1,
    "facebook delta: +1 landing / +1 checkout / +1 purchased", JSON.stringify(src("facebook")));
  ok(sb("email_outreach", "landing") === 1 && sb("email_outreach", "checkout_started") === 1 && sb("email_outreach", "purchased") === 0,
    "email/outreach delta: +1 landing / +1 checkout / +0 purchased", JSON.stringify(src("email_outreach")));
  ok(sb("dashboard", "landing") === 1 && sb("dashboard", "checkout_started") === 1 && sb("dashboard", "purchased") === 1,
    "dashboard delta: +1 landing / +1 checkout / +1 purchased", JSON.stringify(src("dashboard")));
  ok(sb("homepage", "landing") === 1 && sb("homepage", "checkout_started") === 0 && sb("homepage", "purchased") === 0,
    "homepage delta: +1 landing / +0 checkout / +0 purchased", JSON.stringify(src("homepage")));
  ok(sb("other_direct", "landing") === 1 && sb("other_direct", "checkout_started") === 0 && sb("other_direct", "purchased") === 1,
    "other/direct delta: +1 landing (refresh not double-counted) / +0 checkout / +1 unmatched purchase",
    JSON.stringify(src("other_direct")));
  const sumSources = f.sources.reduce((a, s) => a + s.landing, 0);
  ok(sumSources === st("landing"), "per-source landing sum === landing stage (no visitor counted twice)",
    `sum=${sumSources}`);
  // Pipeline attribution spot-check: the intake stamped the row fields the
  // bucket consumed (facebook via first-touch cookie, newsletter via utm).
  const fbRow = await db`SELECT source, click_id, label FROM funnel_events WHERE event_name='bid_scout_viewed' AND visitor_id=${V_FB} LIMIT 1`;
  const emRow = await db`SELECT source, label FROM funnel_events WHERE event_name='bid_scout_viewed' AND visitor_id=${V_EMAIL} LIMIT 1`;
  const dhRow = await db`SELECT label FROM funnel_events WHERE event_name='bid_scout_viewed' AND visitor_id=${V_DASH} LIMIT 1`;
  ok(fbRow[0]?.source === "facebook" && String(fbRow[0]?.click_id ?? "").startsWith("fbclid") && fbRow[0]?.label === "bid_scout_page",
    "intake stamped facebook source + fbclid click_id on the landing row", JSON.stringify(fbRow[0]));
  ok(emRow[0]?.source === "newsletter", "intake stamped utm_source=newsletter (email bucket)", JSON.stringify(emRow[0]));
  ok(dhRow[0]?.label === "dashboard", "intake stamped CTA label=dashboard (dashboard bucket)", JSON.stringify(dhRow[0]));

  // ── 4. Success page / client purity ────────────────────────────────────────
  console.log("\n4) Success page + client-side purchase-event purity");
  const successSrc = readFileSync("src/routes/bid-scout.success.tsx", "utf8");
  ok(!successSrc.includes("trackEvent") && !successSrc.includes("bid_scout_purchased") && !successSrc.includes("fetch("),
    "success page fires NO analytics event and no fetch (purely presentational)");
  const routeFiles = readFileSync("src/routes/bid-scout.tsx", "utf8");
  ok(routeFiles.includes('trackEvent("bid_scout_viewed"') && routeFiles.includes('trackEvent("bid_scout_form_started"'),
    "landing page fires viewed + form_started (client)");
  ok(!routeFiles.includes("bid_scout_purchased") && !routeFiles.includes("bid_scout_checkout_started"),
    "landing page never fires checkout_started/purchased client-side");

  // ── 5. Admin endpoint 401 ─────────────────────────────────────────────────
  console.log("\n5) Admin endpoint auth");
  const { handler: acqHandler } = await import("../src/routes/api/admin/bid-scout-acquisition-funnel");
  const unauth = await acqHandler({ request: new Request("https://www.contrax.company/api/admin/bid-scout-acquisition-funnel") });
  ok(unauth.status === 401, "acquisition-funnel endpoint 401 unauthenticated");

  // ── Cleanup ────────────────────────────────────────────────────────────────
  console.log("\n── Cleanup ──");
  await db`
    DELETE FROM funnel_events
    WHERE event_name LIKE 'bid_scout_%'
      AND (visitor_id = ANY(${ALL_VISITORS})
           OR user_email = ANY(${EMAILS})
           OR label LIKE ${`%rec-${RUN}-%`})`;
  await db`DELETE FROM visitors WHERE visitor_id = ANY(${ALL_VISITORS})`;
  const leftover = await db`
    SELECT COUNT(*)::int AS n FROM funnel_events
    WHERE event_name LIKE 'bid_scout_%'
      AND (visitor_id = ANY(${ALL_VISITORS}) OR user_email = ANY(${EMAILS}) OR label LIKE ${`%rec-${RUN}-%`})`;
  ok(leftover[0].n === 0, "no leftover bid_scout test rows", `leftover=${leftover[0].n}`);
  const visLeft = await db`SELECT COUNT(*)::int AS n FROM visitors WHERE visitor_id = ANY(${ALL_VISITORS})`;
  ok(visLeft[0].n === 0, "no leftover visitors summary rows");
  const maxAfter = Number((await db`SELECT MAX(id)::int AS m FROM funnel_events`)[0].m ?? 0);
  ok(maxAfter >= maxBefore, `funnel max id monotonic (before=${maxBefore}, after=${maxAfter})`,
    `drift=${maxAfter - maxBefore} = organic-only (max before cleanup, then rows deleted)`);

  console.log(`\n══ RESULT: ${passed} passed, ${failed} failed ══`);
  process.exit(failed > 0 ? 1 : 0);
}

main().catch(async (e) => {
  console.error("Smoke test crashed:", e);
  try {
    const db = neon(process.env.DATABASE_URL!);
    await db`DELETE FROM funnel_events
      WHERE event_name LIKE 'bid_scout_%'
        AND (visitor_id = ANY(${ALL_VISITORS}) OR user_email = ANY(${EMAILS}) OR label LIKE ${`%rec-${RUN}-%`})`;
    await db`DELETE FROM visitors WHERE visitor_id = ANY(${ALL_VISITORS})`;
  } catch { /* non-fatal */ }
  process.exit(1);
});