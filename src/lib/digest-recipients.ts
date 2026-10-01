/**
 * BID DIGEST RECIPIENTS — who gets the new-bid email after each sync.
 *
 * The digest is the "email alerts" feature, which is a PAID feature (Starter and
 * up on /pricing). Until 2026-10-01 the sync mailed it to EVERY account,
 * including free Basic users, which gave away the main reason to upgrade.
 *
 * A user receives the digest when ANY of these hold:
 *   - they are an admin (ADMIN_EMAILS or users.is_admin);
 *   - they have an ACTIVE Bid Scout subscription;
 *   - they hold an active per-user access grant (access_expires_at in the
 *     future) with full_access or a Starter+ tier;
 *   - their plan_tier is Starter or above and their access has not expired,
 *     using the same rules as computeTrialStatus (src/lib/trial.ts): a paying
 *     subscription is never expired, and a 14-day trial counts while it runs.
 *
 * Free Basic users, expired trials and the internal demo/seed tiers do not.
 *
 * PURE (no DB, no server imports) so the sync runner can use it and the rule is
 * unit-tested; tests/digest-recipients.test.ts pins it against computeTrialStatus.
 */
import { isAdminEmail } from "./admin";

/** Mirrors TIER_ORDER in src/lib/trial.ts (pinned by the test). */
export const DIGEST_TIER_ORDER: Record<string, number> = { basic: 0, starter: 1, professional: 2, agency: 3 };
/** Mirrors TRIAL_DAYS in src/lib/trial.ts (pinned by the test). */
export const DIGEST_TRIAL_DAYS = 14;
const DAY_MS = 24 * 60 * 60 * 1000;

/** Most bids listed in one digest email; the rest are summarised with a link. */
export const DIGEST_MAX_BIDS = 50;

/** The user columns the rule reads (one row per user from the sync query). */
export interface DigestUserRow {
  email: string;
  is_admin?: boolean | null;
  plan_tier?: string | null;
  trial_started_at?: string | Date | null;
  subscription_status?: string | null;
  access_expires_at?: string | Date | null;
  full_access?: boolean | null;
  has_bid_scout?: boolean | null;
}

function time(value: string | Date | null | undefined): number | null {
  if (value === null || value === undefined) return null;
  const t = new Date(value).getTime();
  return Number.isNaN(t) ? null : t;
}

/** True when this user should receive the paid new-bid digest. */
export function isDigestEligible(row: DigestUserRow, now: number = Date.now()): boolean {
  const email = String(row.email ?? "").trim();
  if (!email) return false;
  if (row.is_admin || isAdminEmail(email)) return true;
  if (row.has_bid_scout) return true;

  const rank = DIGEST_TIER_ORDER[String(row.plan_tier ?? "")] ?? 0;

  // A per-user access grant is the single source of truth while it is set.
  const grantEnds = time(row.access_expires_at);
  if (grantEnds !== null) {
    return now < grantEnds && (!!row.full_access || rank >= DIGEST_TIER_ORDER.starter);
  }

  if (rank < DIGEST_TIER_ORDER.starter) return false;
  if (row.subscription_status === "active") return true;
  const started = time(row.trial_started_at);
  if (started === null) return true; // not in a trial and not expired (computeTrialStatus)
  return now < started + DIGEST_TRIAL_DAYS * DAY_MS;
}

/** The de-duplicated email list for the digest. */
export function digestRecipients(rows: readonly DigestUserRow[], now: number = Date.now()): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const row of rows) {
    if (!isDigestEligible(row, now)) continue;
    const email = row.email.trim();
    const key = email.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(email);
  }
  return out;
}

/**
 * The bids one digest lists: soonest deadline first (no deadline last), at most
 * DIGEST_MAX_BIDS. A sync that adds hundreds of bids (e.g. a new source's first
 * run) would otherwise produce an email too long to read or to render.
 */
export function digestBidsToList<T extends { due_date: string | null }>(bids: readonly T[], max: number = DIGEST_MAX_BIDS): T[] {
  const due = (b: T) => {
    const t = b.due_date ? Date.parse(b.due_date) : NaN;
    return Number.isNaN(t) ? Number.POSITIVE_INFINITY : t;
  };
  return [...bids].sort((a, b) => due(a) - due(b)).slice(0, max);
}
