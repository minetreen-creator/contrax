/**
 * Bid Scout ACQUISITION funnel — Phase B.1 (owner 2026-09-11).
 *
 * EXTENDS the Phase B Bid Scout funnels with a 4-stage acquisition view +
 * traffic-source breakdown:
 *
 *   Landing visitors (bid_scout_viewed)
 *   → Form started (bid_scout_form_started, NEW in B.1 — first focus/input
 *     into the intake form's company/capabilities fields, ref-guarded client-
 *     side so it fires at most once per page mount, never per keystroke)
 *   → Checkout started (bid_scout_checkout_started)
 *   → Purchased (bid_scout_purchased — WEBHOOK-ONLY, see below)
 *
 * TRAFFIC-SOURCE RULE (unambiguous, from what is actually stored on each
 * `funnel_events` row written by the canonical intake pipeline):
 *
 *   For every visitor who landed on /bid-scout (has a bid_scout_viewed row),
 *   a single bucket is derived from that view's stored fields in precedence
 *   order (first match wins):
 *
 *   1. facebook     — `source` = 'facebook' (the intake writer stamps this from
 *                     the first-touch contrax_attr cookie / fbclid query, see
 *                     resolveAttribution) OR `click_id` is present (fbclid /
 *                     gclid) OR the referrer contains facebook/fb.com/fbclid.
 *   2. email/outreach — `source` carries an email-ish utm_source
 *                     (email/newsletter/outreach/mail/mailing/mailer/blast
 *                     patterns) OR the referrer names an email-client/ESP host
 *                     (list-manage, mailchi.mp, sendgrid, mailgun, postmark,
 *                     customer.io, constantcontact, hubspot, mail.google.,
 *                     mail.yahoo., outlook., icloud.com/mail, mailto:) OR the
 *                     CTA/placement `label` is an owner-outreach campaign slug:
 *                     the outreach emails' `?source=` token is ROT13-obfuscated
 *                     before intake, so the raw AND ROT13-decoded label are
 *                     tested against the outreach campaign family (see
 *                     OUTREACH_LABEL_PATTERNS / rot13Label; observed live
 *                     2026-09-11 label 'gehdxvat_bhgefbdu' → 'truqking_outrsoqh').
 *   3. dashboard    — CTA placement `label` = 'dashboard' (the dashboard's
 *                     `?source=dashboard` link) OR a first-party referrer whose
 *                     PATH is an authenticated app route (/dashboard, /app,
 *                     /onboarding, /settings …). First-party referrers are
 *                     distinguished from the homepage BY PATH.
 *   4. homepage     — CTA placement `label` = 'homepage' OR a first-party
 *                     referrer whose PATH is '/' (including /#section anchors,
 *                     whose pathname is still '/'). The homepage's `?source=
 *                     homepage` link stamps this label on the view.
 *   5. other/direct — everything else (direct entry, search, unknown
 *                     referrers, self-referrals to /bid-scout …).
 *
 *   Buckets are computed per VISITOR (distinct, converted at the visitor
 *   level) — refreshes / repeat views never inflate. The label placement is
 *   only consulted when no external channel signal (facebook / email) matched,
 *   so a visitor whose first-touch attribution is facebook stays in facebook
 *   even when they later click a homepage CTA.
 *
 * PURCHASED (stage + per-source): counts the webhook's exactly-once
 * `bid_scout_purchased` event rows (written server-side only by
 * recordBidScoutPurchasedEvent inside the pending→active transition guard).
 * Success-page views never write events. Those rows have NO visitor_id by
 * design (a Stripe webhook carries no browser session), so the stage count is
 * PURCHASES (one per webhook-confirmed subscription), not distinct visitors —
 * and the per-source purchased attribution joins each purchase back through
 * the buyer's email to the earliest matched bid_scout_checkout_started event
 * (which does carry visitor_id + the form email); unmatchable purchases
 * (checkout beacon lost) fall into other/direct.
 *
 * READ-ONLY: SELECTs only. No migration, no writes. Same rolling now−30×24h
 * window and the same bot/QA/admin exclusions every admin funnel applies.
 */
import { sql } from "~/db";
import { BOT_EXCLUSION_SQL } from "~/lib/bot-exclusion";
import { qaFunnelExclusionSQL, adminFunnelExclusionSQL } from "~/lib/qa-exclusion";
import { bidScoutFunnelWindow } from "~/lib/bid-scout-funnel";

export const BID_SCOUT_LANDING_EVENT = "bid_scout_viewed";
export const BID_SCOUT_FORM_STARTED_EVENT = "bid_scout_form_started";
export const BID_SCOUT_CHECKOUT_STARTED_EVENT = "bid_scout_checkout_started";
export const BID_SCOUT_PURCHASED_EVENT = "bid_scout_purchased";

export const BID_SCOUT_ACQUISITION_EVENTS = [
  BID_SCOUT_LANDING_EVENT,
  BID_SCOUT_FORM_STARTED_EVENT,
  BID_SCOUT_CHECKOUT_STARTED_EVENT,
  BID_SCOUT_PURCHASED_EVENT,
] as const;

export type BidScoutSourceBucket =
  | "facebook"
  | "email_outreach"
  | "dashboard"
  | "homepage"
  | "other_direct";

export const BID_SCOUT_SOURCE_BUCKETS: readonly BidScoutSourceBucket[] = [
  "facebook",
  "email_outreach",
  "dashboard",
  "homepage",
  "other_direct",
];

export interface BidScoutStageCount {
  key: string;
  label: string;
  count: number;
}

export interface BidScoutSourceBreakdown {
  bucket: BidScoutSourceBucket;
  label: string;
  landing: number; // unique landing visitors in this bucket
  checkout_started: number; // unique checkout_started visitors in this bucket
  purchased: number; // webhook-confirmed purchases attributed to this bucket
}

export interface BidScoutAcquisitionFunnelResult {
  range: "30d";
  fromIso: string;
  toIso: string;
  stages: BidScoutStageCount[]; // landing / form_started / checkout_started / purchased
  conversionRatePct: number | null; // purchased ÷ unique landing visitors; null when landing = 0
  sources: BidScoutSourceBreakdown[];
}

// ── Bucketing ────────────────────────────────────────────────────────────────

interface BucketInput {
  label?: string | null;
  referrer?: string | null;
  source?: string | null;
  click_id?: string | null;
}
export type { BucketInput };

const EMAIL_SOURCE_PATTERNS =
  /^(email|newsletter|outreach|mail|mailing|mailer|mailinglist|maillist|emailblast|email-campaign|newsletter2go)$|email|newsletter|outreach|mailing|blast/i;

const EMAIL_REFERRER_PATTERNS =
  /list-manage|mailchi\.mp|mailto:|mail\.google\.|mail\.yahoo\.|outlook\.|icloud\.com\/mail|sendgrid|mailgun|postmark|customer\.io|constantcontact|hubspot|eml\//i;

/**
 * ROT13 — the owner's outreach emails obfuscate the `?source=` campaign token
 * with ROT13 before it reaches the intake, so the stored `label` is the
 * encoded bytes (observed 2026-09-11: today's live trucking-outreach campaign
 * stored label 'gehdxvat_bhgefbdu' — ROT13 of 'truqking_outrsoqh', i.e. the
 * link generator mangles c→q / e→s / a→o vs. a clean 'trucking_outreach').
 * ROT13 is an involution: decoding a plaintext label is a safe no-op for
 * matching purposes, and decoding the encoded form recovers the campaign slug.
 */
export function rot13Label(s: string): string {
  return s.replace(/[a-z]/gi, (ch) => {
    const code = ch.charCodeAt(0);
    const base = code <= 90 ? 65 : 97;
    return String.fromCharCode(((code - base + 13) % 26) + base);
  });
}

/** Outreach campaign labels — the owner's email/outreach campaign slugs.
 * Tested against BOTH the raw label (plaintext campaign, e.g. 'trucking_
 * outreach', 'email') and the ROT13-decoded label (as stored for today's
 * live campaign). 'truqk…' / 'outrs…' cover the link generator's observed
 * mangled family (decoded 'truqking_outrsoqh'). */
const OUTREACH_LABEL_PATTERNS =
  /(outreach|trucking|email|newsletter|mailing|mailer|blast|campaign|truqk|outrs)/i;

/** Authenticated app paths — an internal referrer under any of these is a
 *  "dashboard" source (distinguished from the homepage by PATH). */
const APP_PATH_PREFIXES = ["/dashboard", "/app", "/onboarding", "/settings"];

function isOwnHost(hostname: string): boolean {
  const h = hostname.toLowerCase();
  return (
    h === "contrax.company" ||
    h.endsWith(".contrax.company") ||
    h.endsWith(".ctonew.app") ||
    h === "localhost" ||
    h === "127.0.0.1"
  );
}

function referrerPath(ref: string | null | undefined): string | null {
  if (!ref) return null;
  try {
    const u = new URL(ref);
    if (!isOwnHost(u.hostname)) return null; // external referrer — path not meaningful
    return u.pathname || "/";
  } catch {
    return null;
  }
}

function referrerMatches(ref: string | null | undefined, pattern: RegExp): boolean {
  if (!ref) return false;
  try {
    return pattern.test(new URL(ref).hostname) || pattern.test(ref);
  } catch {
    return pattern.test(ref);
  }
}

/**
 * Map ONE funnel_events row (the bid_scout_viewed landing row of a visitor)
 * to a traffic-source bucket. Documented precedence: facebook → email → 
 * dashboard → homepage → other/direct. Pure + deterministic (unit-tested).
 */
export function bucketBidScoutLanding(row: BucketInput): BidScoutSourceBucket {
  const source = (row.source ?? "").toLowerCase();
  const label = (row.label ?? "").toLowerCase();
  const clickId = (row.click_id ?? "").trim();
  const ref = row.referrer ?? null;

  // 1. facebook — first-touch stamped source/click_id is authoritative.
  if (source === "facebook" || clickId.length > 0 || referrerMatches(ref, /facebook|fb\.com|fbclid/i)) {
    return "facebook";
  }
  // 2. email/outreach — utm_source email-style values, an email-client/ESP
  //    referrer, or an owner-outreach campaign label. The outreach emails'
  //    ?source= token is ROT13-obfuscated before it reaches the intake, so
  //    test the DECODED label too (see rot13Label / OUTREACH_LABEL_PATTERNS).
  if (
    EMAIL_SOURCE_PATTERNS.test(source) ||
    referrerMatches(ref, EMAIL_REFERRER_PATTERNS) ||
    OUTREACH_LABEL_PATTERNS.test(label) ||
    OUTREACH_LABEL_PATTERNS.test(rot13Label(label))
  ) {
    return "email_outreach";
  }
  // 3. dashboard — explicit placement label, or a first-party app-path referrer.
  if (label === "dashboard") return "dashboard";
  const path = referrerPath(ref);
  if (path && APP_PATH_PREFIXES.some((p) => path === p || path.startsWith(p + "/"))) {
    return "dashboard";
  }
  // 4. homepage — explicit placement label, or first-party referrer path "/"
  //    (including /#section anchors — pathname is still "/").
  if (label === "homepage") return "homepage";
  if (path === "/") return "homepage";
  // 5. everything else.
  return "other_direct";
}

// ── Funnel query ─────────────────────────────────────────────────────────────

interface RawEventRow {
  event_name: string;
  visitor_id: string | null;
  user_email: string | null;
  label: string | null;
  referrer: string | null;
  source: string | null;
  click_id: string | null;
  created_at: string | null;
}

/**
 * 30-day Bid Scout ACQUISITION funnel with traffic-source breakdown.
 * READ-ONLY. Never throws on a stage failure (stage falls back to 0 like the
 * Phase B funnel) — the shape is stable and forward-compatible.
 */
export async function getBidScoutAcquisitionFunnel30d(): Promise<BidScoutAcquisitionFunnelResult> {
  const { fromIso, toIso } = bidScoutFunnelWindow();
  const humanFilter = `NOT COALESCE((${BOT_EXCLUSION_SQL}), false)`;
  const qaFilter = qaFunnelExclusionSQL("");
  const adminFilter = adminFunnelExclusionSQL("");

  let rows: RawEventRow[] = [];
  try {
    rows = (await sql()`
      SELECT event_name, visitor_id, user_email, label, referrer, source, click_id, created_at
      FROM funnel_events
      WHERE event_name = ANY(${BID_SCOUT_ACQUISITION_EVENTS})
        AND created_at >= ${fromIso}
        AND ${sql().unsafe(humanFilter)}
        AND ${sql().unsafe(qaFilter)} AND ${sql().unsafe(adminFilter)}
    `) as unknown as RawEventRow[];
  } catch (err) {
    console.error("[bid-scout-acquisition] funnel_events read failed:", err);
  }

  // Split rows by event.
  const viewed: RawEventRow[] = [];
  const formStarted: RawEventRow[] = [];
  const checkoutStarted: RawEventRow[] = [];
  const purchased: RawEventRow[] = [];
  for (const r of rows) {
    if (r.event_name === BID_SCOUT_LANDING_EVENT) viewed.push(r);
    else if (r.event_name === BID_SCOUT_FORM_STARTED_EVENT) formStarted.push(r);
    else if (r.event_name === BID_SCOUT_CHECKOUT_STARTED_EVENT) checkoutStarted.push(r);
    else if (r.event_name === BID_SCOUT_PURCHASED_EVENT) purchased.push(r);
  }

  const hasVid = (r: RawEventRow): r is RawEventRow & { visitor_id: string } =>
    !!r.visitor_id && r.visitor_id !== "";
  const distinct = (items: string[]): Set<string> => new Set(items.filter(Boolean));

  const landingVids = distinct(viewed.filter(hasVid).map((r) => r.visitor_id!));
  const formVids = distinct(formStarted.filter(hasVid).map((r) => r.visitor_id!));
  const checkoutVids = distinct(checkoutStarted.filter(hasVid).map((r) => r.visitor_id!));

  // Bucket every landing visitor from their EARLIEST bid_scout_viewed row
  // (deterministic — refreshes never re-bucket).
  const seen = new Set<string>();
  const visitorBucket = new Map<string, BidScoutSourceBucket>();
  for (const r of viewed.sort((a, b) => String(a.created_at).localeCompare(String(b.created_at)))) {
    if (!hasVid(r) || seen.has(r.visitor_id)) continue;
    seen.add(r.visitor_id);
    visitorBucket.set(r.visitor_id, bucketBidScoutLanding(r));
  }

  // Purchased — webhook-only event rows. Each row = one webhook-confirmed
  // purchase (exactly-once by transition guard + label-idempotence). No
  // visitor_id on these rows by design; count distinct metadata bidScoutId
  // when parseable (fall back to row count).
  let purchasedTotal = 0;
  const purchasedMeta: { email: string | null; bidScoutId: string | null }[] = [];
  const seenPurchase = new Set<string>();
  for (const r of purchased) {
    let bidScoutId: string | null = null;
    if (r.label && r.label.trim().startsWith("{")) {
      try {
        const meta = JSON.parse(r.label) as { bidScoutId?: unknown };
        if (typeof meta.bidScoutId === "string") bidScoutId = meta.bidScoutId;
      } catch {
        bidScoutId = null;
      }
    }
    const dedupeKey = bidScoutId ?? `row-${Math.random()}`;
    if (seenPurchase.has(dedupeKey)) continue;
    seenPurchase.add(dedupeKey);
    purchasedTotal += 1;
    purchasedMeta.push({ email: r.user_email, bidScoutId });
  }

  // Per-source breakdown.
  const sourceBreakdown: BidScoutSourceBreakdown[] = BID_SCOUT_SOURCE_BUCKETS.map(
    (bucket) => ({
      bucket,
      label: bucketLabel(bucket),
      landing: 0,
      checkout_started: 0,
      purchased: 0,
    }),
  );
  const byBucket = new Map<BidScoutSourceBucket, BidScoutSourceBreakdown>();
  for (const b of sourceBreakdown) byBucket.set(b.bucket, b);

  for (const [vid, bucket] of visitorBucket) {
    if (landingVids.has(vid)) byBucket.get(bucket)!.landing += 1;
    if (checkoutVids.has(vid)) byBucket.get(bucket)!.checkout_started += 1;
  }

  // Attribute purchases to buckets via buyer email → earliest matched
  // checkout_started visitor (which carries visitor_id + form email).
  const emailCheckout: Map<string, string> = new Map(); // lower email → visitor_id
  for (const r of checkoutStarted.sort((a, b) => String(a.created_at).localeCompare(String(b.created_at)))) {
    if (!hasVid(r) || !r.user_email) continue;
    const key = r.user_email.trim().toLowerCase();
    if (!emailCheckout.has(key)) emailCheckout.set(key, r.visitor_id);
  }
  for (const p of purchasedMeta) {
    let bucket: BidScoutSourceBucket = "other_direct";
    if (p.email) {
      const vid = emailCheckout.get(p.email.trim().toLowerCase());
      if (vid && visitorBucket.has(vid)) bucket = visitorBucket.get(vid)!;
    }
    byBucket.get(bucket)!.purchased += 1;
  }

  const landingCount = landingVids.size;
  const conversionRatePct =
    landingCount > 0 ? Math.round((purchasedTotal / landingCount) * 1000) / 10 : null;

  return {
    range: "30d",
    fromIso,
    toIso,
    stages: [
      { key: "landing", label: "Landing visitors", count: landingCount },
      { key: "form_started", label: "Form started", count: formVids.size },
      { key: "checkout_started", label: "Checkout started", count: checkoutVids.size },
      { key: "purchased", label: "Purchased", count: purchasedTotal },
    ],
    conversionRatePct,
    sources: sourceBreakdown,
  };
}

function bucketLabel(bucket: BidScoutSourceBucket): string {
  switch (bucket) {
    case "facebook":
      return "Facebook";
    case "email_outreach":
      return "Email / outreach";
    case "dashboard":
      return "Dashboard";
    case "homepage":
      return "Homepage";
    default:
      return "Other / direct";
  }
}